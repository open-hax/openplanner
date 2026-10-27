# SPDX-License-Identifier: GPL-3.0-or-later
"""Real user-manager tests with small fake processes; no model/network jobs.

E4B_WORKER_EVIDENCE must name a new private directory: evidence is retained,
never automatically deleted. Tests stop only their own nonce-bound units.
"""
import dataclasses
import json
import os
import pathlib
import subprocess
import threading
import time
import unittest
from unittest.mock import patch

from worker_adapter import Lease, OwnershipError, Worker, command

ROOT = pathlib.Path(os.environ["E4B_WORKER_EVIDENCE"]).resolve()
ROOT.mkdir(mode=0o700, parents=False, exist_ok=False)


def cgroup_empty(state):
    group = state.get("ControlGroup", "")
    if not group.startswith("/user.slice/"):
        raise ValueError("Unexpected fixture cgroup")
    path = pathlib.Path("/sys/fs/cgroup") / group.lstrip("/")
    return not path.exists() or "populated 0" in (path / "cgroup.events").read_text()


class WorkerTest(unittest.TestCase):
    def worker(self, mode="graceful"):
        worker = Worker(ROOT / self._testMethodName, mode)
        self.addCleanup(worker.stop)
        return worker

    def start_ready(self, worker):
        state = worker.start()
        facts = worker.wait_ready(threading.Event())
        (worker.directory / "observed.json").write_text(json.dumps({"state": state, "process": facts}, indent=2))
        return state

    def test_graceful_teardown_and_enforced_properties(self):
        worker = self.worker()
        state = self.start_ready(worker)
        self.assertEqual(state["KillMode"], "control-group")
        self.assertEqual(state["ExitType"], "cgroup")
        self.assertEqual(state["Restart"], "no")
        self.assertEqual(state["RuntimeMaxUSec"], "2s")
        self.assertEqual(state["TimeoutStopUSec"], "200ms")
        self.assertEqual(state["SendSIGKILL"], "yes")
        self.assertEqual(state["MemoryMax"], str(64 * 1024 * 1024))
        self.assertEqual(state["MemorySwapMax"], "0")
        self.assertEqual(state["TasksMax"], "8")
        self.assertEqual(state["CPUQuotaPerSecUSec"], "250ms")
        self.assertEqual(worker.stop()["LoadState"], "not-found")
        self.assertTrue(cgroup_empty(state))
        self.assertEqual((worker.directory / "lease.json").stat().st_mode & 0o777, 0o600)

    def test_stubborn_forced_teardown(self):
        worker = self.worker("stubborn")
        state = self.start_ready(worker)
        began = time.monotonic()
        worker.stop()
        self.assertLess(time.monotonic() - began, 2)
        self.assertTrue(cgroup_empty(state))

    def test_child_in_other_process_group_is_removed(self):
        worker = self.worker("orphan")
        state = self.start_ready(worker)
        self.assertIsNotNone(json.loads((worker.directory / "ready.json").read_text())["child"])
        worker.stop()
        self.assertTrue(cgroup_empty(state))

    def test_nonzero_startup_exit(self):
        worker = self.worker("exit-error")
        worker.start()
        with self.assertRaises(RuntimeError):
            worker.wait_ready(threading.Event())
        state = worker.reconcile()
        self.assertEqual(state["ExecMainStatus"], "23")
        self.assertEqual(state["MainPID"], "0")
        self.assertEqual(worker.stop()["LoadState"], "not-found")

    def test_runtime_bound_survives_lost_controller(self):
        self.assert_manager_expiry(self.worker("stubborn"))

    def test_orphan_child_expires_without_controller_stop(self):
        self.assert_manager_expiry(self.worker("orphan"))

    def assert_manager_expiry(self, worker):
        state = self.start_ready(worker)
        # No controller watchdog or stop call: the existing manager owns expiry.
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            ended = worker.reconcile()
            if ended.get("ActiveState") == "failed":
                break
            time.sleep(0.03)
        self.assertEqual(ended.get("Result"), "timeout")
        self.assertEqual(ended.get("MainPID"), "0")
        self.assertTrue(cgroup_empty(state))
        with self.assertRaises(RuntimeError):
            worker.wait_ready(threading.Event())

    def test_cancellation_tears_down_in_finally(self):
        worker = self.worker()
        state = worker.start()
        cancel = threading.Event()
        cancel.set()
        try:
            with self.assertRaises(InterruptedError):
                worker.wait_ready(cancel)
        finally:
            worker.stop()
        self.assertTrue(cgroup_empty(state))

    def test_stale_lease_and_foreign_description_cannot_stop(self):
        worker = self.worker()
        state = self.start_ready(worker)
        original = worker.lease
        worker.lease = dataclasses.replace(original, invocation="0" * 32)
        with self.assertRaises(OwnershipError):
            worker.stop()
        worker.lease = original
        self.assertEqual(worker.reconcile()["ActiveState"], "active")
        real_run = worker.run
        def foreign(argv):
            return real_run(argv).replace(worker.lease.description, "somebody else's fixture")
        worker.run = foreign
        with self.assertRaises(OwnershipError):
            worker.stop()
        worker.run = real_run
        worker.stop()
        self.assertTrue(cgroup_empty(state))

    def test_submission_response_loss_reconciles_then_cleans(self):
        worker = self.worker()
        def lost(argv):
            result = command(argv)
            if argv[0] == "systemd-run":
                raise subprocess.TimeoutExpired(argv[:1], 5)
            return result
        worker.run = lost
        with self.assertRaises(subprocess.TimeoutExpired):
            worker.start()
        self.assertTrue(worker.lease.invocation)
        self.assertEqual(worker.snapshot()["LoadState"], "not-found")

    def test_invalid_identity_and_mode_rejected_before_submission(self):
        with self.assertRaises(ValueError):
            Lease("../other.service")
        with self.assertRaises(subprocess.CalledProcessError):
            Worker(ROOT / self._testMethodName, "gemma4:e4b")

    def test_fresh_controller_recovers_private_lease_for_teardown_only(self):
        worker = self.worker("stubborn")
        state = self.start_ready(worker)
        recovered = Worker.recover(worker.directory)
        self.assertEqual(recovered.lease, worker.lease)
        with self.assertRaises(OwnershipError):
            recovered.start()
        recovered.stop()
        self.assertTrue(cgroup_empty(state))
        with self.assertRaises(OwnershipError):
            worker.start()

    def test_failed_submission_without_invocation_cannot_reuse_nonce(self):
        worker = self.worker()
        submitted = []
        def rejected(argv):
            if argv[0] == "systemd-run":
                submitted.append(argv)
                raise RuntimeError("Synthetic submission rejection")
            return "LoadState=not-found\n"
        worker.run = rejected
        with self.assertRaises(RuntimeError):
            worker.start()
        self.assertTrue(worker.lease.attempted)
        self.assertTrue(json.loads((worker.directory / "lease.json").read_text())["attempted"])
        self.assertEqual(worker.lease.invocation, "")
        with self.assertRaises(OwnershipError):
            worker.start()
        self.assertEqual(len(submitted), 1)

    def test_interrupted_lease_write_does_not_block_recovery(self):
        worker = self.worker()
        interrupted = worker.directory / "lease.next"
        interrupted.write_text("Interrupted private write")
        def observed(argv):
            self.assertEqual(argv[0], "systemctl")
            return ("LoadState=loaded\nDescription=" + worker.lease.description
                    + "\nInvocationID=" + "a" * 32 + "\n")
        recovered = Worker.recover(worker.directory, run=observed)
        self.assertEqual(recovered.lease.invocation, "a" * 32)
        self.assertEqual(json.loads((worker.directory / "lease.json").read_text())["invocation"], "a" * 32)
        self.assertEqual(interrupted.read_text(), "Interrupted private write")

    def test_active_exited_unit_cannot_reuse_readiness_marker(self):
        worker = self.worker()
        (worker.directory / "ready.json").write_text('{"pid": 123}')
        with patch.object(worker, "reconcile", return_value={"ActiveState": "active", "SubState": "exited"}):
            with self.assertRaises(RuntimeError):
                worker.wait_ready(threading.Event())


if __name__ == "__main__":
    unittest.main(verbosity=2)
