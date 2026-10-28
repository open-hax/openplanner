# SPDX-License-Identifier: GPL-3.0-or-later
"""Real managed synthetic listener only; never uses a model or shared endpoint."""
import dataclasses
import http.client
import json
import os
import pathlib
import socket
import threading
import time
import unittest
from unittest import mock

import managed_fixture
from endpoint_probe import ProbeError, observe_worker
from worker_adapter import OwnershipError, Worker

ROOT = pathlib.Path(os.environ['E4B_LISTENER_EVIDENCE']).resolve()
ROOT.mkdir(mode=0o700, parents=False, exist_ok=False)


class ManagedListenerTests(unittest.TestCase):
    def start(self):
        worker = Worker(ROOT / self._testMethodName, 'listener')
        self.addCleanup(worker.stop)
        state = worker.start()
        ready = worker.wait_ready(threading.Event())
        self.assertEqual(int(state['MainPID']), ready['pid'])
        self.assertEqual(state['RuntimeMaxUSec'], '2s')
        self.assertEqual(state['MemoryMax'], str(64 * 1024 * 1024))
        return worker, ready, state

    def save(self, worker, value):
        (worker.directory / 'observed.json').write_text(json.dumps(value, indent=2) + '\n')

    def test_real_manager_process_socket_join_and_fixed_request(self):
        worker, ready, state = self.start()
        result = managed_fixture.consume_fixture(worker, ready['port'])
        self.save(worker, {'state': state, 'ready': ready, 'joined': result})
        self.assertEqual(result['initial'], result['current'])
        self.assertEqual(result['initial']['process']['pid'], ready['pid'])
        self.assertTrue(result['decision']['fixture-request-allowed'])
        self.assertFalse(result['decision']['model-execution'])
        self.assertFalse(result['decision']['atomic-connect-ownership'])
        self.assertEqual(result['transport']['status'], 'completed')
        self.assertTrue(result['transport']['cleanup-complete'])
        self.assertEqual(result['transport']['response'], {'fixture': 'e4b-managed-listener-v1'})
        self.assertEqual(json.loads((worker.directory / 'request.json').read_text())['pid'], ready['pid'])
        self.assertEqual(worker.stop()['LoadState'], 'not-found')

    def test_real_stop_between_proofs_prevents_transport(self):
        worker, ready, _ = self.start()
        calls = []
        original_observe = managed_fixture.observe_worker
        def stop_after_first(current, port, bounds):
            facts = original_observe(current, port, bounds)
            calls.append(facts)
            if len(calls) == 1:
                worker.stop()
            return facts
        with mock.patch.object(managed_fixture, 'observe_worker', side_effect=stop_after_first), \
                mock.patch.object(managed_fixture, 'consume') as consume:
            with self.assertRaises(ProbeError):
                managed_fixture.consume_fixture(worker, ready['port'])
            consume.assert_not_called()
        self.assertFalse((worker.directory / 'request.json').exists())
        self.save(worker, {'initial-real-observation': calls[0], 'final': worker.reconcile()})

    def test_foreign_listener_port_has_no_owned_descriptor(self):
        worker, ready, _ = self.start()
        with socket.socket() as foreign:
            foreign.bind(('127.0.0.1', 0))
            foreign.listen(1)
            with mock.patch.object(managed_fixture, 'consume') as consume:
                with self.assertRaises(OwnershipError):
                    managed_fixture.consume_fixture(worker, foreign.getsockname()[1])
                consume.assert_not_called()
        self.assertFalse((worker.directory / 'request.json').exists())
        self.assertNotEqual(ready['port'], 11434)

    def test_stale_invocation_denied_before_transport(self):
        worker, ready, _ = self.start()
        original = worker.lease
        try:
            worker.lease = dataclasses.replace(original, invocation='0' * 32)
            with mock.patch.object(managed_fixture, 'consume') as consume:
                with self.assertRaises(OwnershipError):
                    managed_fixture.consume_fixture(worker, ready['port'])
                consume.assert_not_called()
        finally:
            worker.lease = original
        self.assertFalse((worker.directory / 'request.json').exists())

    def test_listener_rejects_arbitrary_body(self):
        worker, ready, _ = self.start()
        client = http.client.HTTPConnection('127.0.0.1', ready['port'], timeout=.5)
        try:
            client.request('POST', '/api/chat', body=b'{"arbitrary":true}',
                           headers={'Content-Type': 'application/json'})
            response = client.getresponse()
            self.assertEqual(response.status, 400)
            response.read()
        finally:
            client.close()
        self.assertFalse((worker.directory / 'request.json').exists())

    def test_listener_expires_without_controller_stop(self):
        worker, ready, _ = self.start()
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            state = worker.reconcile()
            if state.get('ActiveState') == 'failed':
                break
            time.sleep(.03)
        self.assertEqual(state['Result'], 'timeout')
        self.assertEqual(state['MainPID'], '0')
        self.assertFalse(pathlib.Path('/proc', str(ready['pid'])).exists())
        self.save(worker, {'expired': state, 'ready': ready})


if __name__ == '__main__':
    unittest.main()
