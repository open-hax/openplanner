# SPDX-License-Identifier: GPL-3.0-or-later
"""Synthetic-only transient worker lifecycle over the existing user manager.

No model launch CLI. Unique unit identities are never reused. This protects
cooperating callers against stale leases, not against another malicious same-UID
manager client. There is no atomic compare-and-stop operation in systemctl.
"""
import dataclasses
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import uuid

HERE = pathlib.Path(__file__).resolve().parent
PREFIX = "knoxx-e4b-fixture-"
PROPERTIES = ("LoadState", "ActiveState", "SubState", "InvocationID", "Description",
              "ControlGroup", "MainPID", "Result", "ExecMainCode", "ExecMainStatus",
              "RuntimeMaxUSec", "TimeoutStopUSec", "KillMode", "SendSIGKILL", "ExitType",
              "MemoryMax", "MemorySwapMax", "TasksMax", "CPUQuotaPerSecUSec", "Restart")


class OwnershipError(RuntimeError):
    pass


def command(argv):
    # Fixed systemctl/property output only, never child stdout or a model payload.
    result = subprocess.run(argv, capture_output=True, text=True, timeout=5, check=False)
    if result.returncode:
        raise RuntimeError("Manager command failed: " + result.stderr[:1000])
    return result.stdout


@dataclasses.dataclass(frozen=True)
class Lease:
    nonce: str
    invocation: str = ""
    attempted: bool = False

    def __post_init__(self):
        if not re.fullmatch(r"[0-9a-f]{32}", self.nonce):
            raise ValueError("Invalid lease nonce")
        if self.invocation and not re.fullmatch(r"[0-9a-f]{32}", self.invocation):
            raise ValueError("Invalid invocation")
        if not isinstance(self.attempted, bool):
            raise ValueError("Invalid submission state")

    @property
    def unit(self):
        return PREFIX + self.nonce + ".service"

    @property
    def description(self):
        return "Knoxx synthetic lifecycle fixture " + self.nonce


class Worker:
    def __init__(self, directory, mode, run=command):
        self.plan = json.loads(self._plan(mode))
        self.directory = pathlib.Path(directory).resolve()
        self.directory.mkdir(mode=0o700, parents=False, exist_ok=False)
        self.run = run
        self.lease = Lease(uuid.uuid4().hex)
        # Persist intent before submitting; a supervisor timeout does not mean
        # the manager rejected the job. Its independent runtime bound survives us.
        self.persist()

    @classmethod
    def recover(cls, directory, run=command):
        """Recover teardown authority only; never grant another start."""
        worker = cls.__new__(cls)
        worker.directory = pathlib.Path(directory).resolve(strict=True)
        if (worker.directory.stat().st_uid != os.getuid()
                or worker.directory.stat().st_mode & 0o777 != 0o700):
            raise OwnershipError("Recovery directory must be private and owned")
        path = worker.directory / "lease.json"
        if path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o777 != 0o600:
            raise OwnershipError("Recovery lease must be private and owned")
        worker.lease = Lease(**json.loads(path.read_text()))
        worker.run = run
        worker.plan = None
        worker.reconcile()
        return worker

    @staticmethod
    def _plan(mode):
        return subprocess.run(["bb", str(HERE / "law_cli.clj")],
                              input=json.dumps({"operation": "worker-test-plan", "mode": mode}),
                              text=True, capture_output=True, check=True, timeout=5).stdout

    def persist(self):
        target = self.directory / "lease.json"
        # Interrupted writes remain evidence; never let one fixed temporary
        # filename prevent a fresh controller from recovering teardown authority.
        temporary = self.directory / ("lease." + uuid.uuid4().hex + ".next")
        with open(temporary, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as handle:
            json.dump(dataclasses.asdict(self.lease), handle)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(target)
        descriptor = os.open(self.directory, os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def snapshot(self):
        output = self.run(["systemctl", "--user", "show", self.lease.unit,
                           "--property=" + ",".join(PROPERTIES)])
        return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)

    def reconcile(self):
        state = self.snapshot()
        if state.get("LoadState") == "not-found":
            return state
        if state.get("LoadState") != "loaded" or state.get("Description") != self.lease.description:
            raise OwnershipError("Unit identity mismatch; no action permitted")
        invocation = state.get("InvocationID", "")
        if not re.fullmatch(r"[0-9a-f]{32}", invocation):
            raise OwnershipError("Missing invocation; no action permitted")
        if self.lease.invocation and self.lease.invocation != invocation:
            raise OwnershipError("Stale invocation; no action permitted")
        if not self.lease.invocation:
            self.lease = dataclasses.replace(self.lease, invocation=invocation)
            self.persist()
        return state

    def start(self):
        if self.plan is None or self.lease.attempted or self.lease.invocation or self.snapshot().get("LoadState") != "not-found":
            raise OwnershipError("Unit names cannot be reused")
        self.lease = dataclasses.replace(self.lease, attempted=True)
        self.persist()
        argv = ["systemd-run", "--user", "--quiet", "--no-ask-password",
                "--unit=" + self.lease.unit, "--description=" + self.lease.description]
        for prop in self.plan["properties"]:
            argv.append("--property=" + prop)
        argv += ["--", sys.executable, "-B", str(HERE / "fake_worker.py"),
                 self.plan["mode"], str(self.directory)]
        try:
            self.run(argv)
            return self.reconcile()
        except Exception:
            # Attempt cleanup even if command completion was lost. Unknown
            # ownership is preserved as a failure, never claimed as cleaned.
            self.stop()
            raise

    def stop(self):
        state = self.reconcile()
        if state.get("LoadState") == "not-found":
            return state
        group = state.get("ControlGroup", "")
        if group and (not group.startswith("/user.slice/") or not group.endswith("/" + self.lease.unit)):
            raise OwnershipError("Unexpected owned cgroup; no stop permitted")
        self.run(["systemctl", "--user", "stop", self.lease.unit])
        state = self.reconcile()
        if state.get("LoadState") != "not-found":
            if state.get("ActiveState") not in ("inactive", "failed") or state.get("MainPID") != "0":
                raise RuntimeError("Owned unit did not stop")
            # RemainAfterExit retains invocation evidence until this point.
            self.run(["systemctl", "--user", "reset-failed", self.lease.unit])
        final = self.snapshot()
        if final.get("LoadState") != "not-found":
            raise RuntimeError("Owned unit still loaded")
        if group:
            path = pathlib.Path("/sys/fs/cgroup") / group.lstrip("/")
            try:
                events = (path / "cgroup.events").read_text()
            except FileNotFoundError:
                events = "populated 0"
            if "populated 0" not in events.splitlines():
                raise RuntimeError("Owned cgroup still populated")
        return final

    def wait_ready(self, cancel, seconds=1):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if cancel.is_set():
                raise InterruptedError("Fixture cancelled")
            state = self.reconcile()
            if state.get("ActiveState") not in ("active", "activating") or state.get("SubState") == "exited":
                raise RuntimeError("Fixture failed before readiness: " + state.get("Result", "unknown"))
            if (state.get("ActiveState") == "active" and state.get("SubState") == "running"
                    and (self.directory / "ready.json").exists()):
                return json.loads((self.directory / "ready.json").read_text())
            cancel.wait(0.01)
        raise TimeoutError("Fixture readiness timeout")
