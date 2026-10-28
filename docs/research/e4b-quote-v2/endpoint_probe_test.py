# SPDX-License-Identifier: GPL-3.0-or-later
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from types import SimpleNamespace

import endpoint_probe as probe

BOUNDS = {'max-file-bytes': 1048576, 'max-fds': 256}


class EndpointProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.process = self.root / '1234'
        for name in ['fd', 'net', 'ns']:
            (self.process / name).mkdir(parents=True)
        (self.root / 'self/ns').mkdir(parents=True)
        (self.root / 'self/ns/net').symlink_to('net:[456]')
        (self.process / 'ns/net').symlink_to('net:[456]')
        (self.process / 'stat').write_text('1234 (name ) with spaces) ' + ' '.join(['S'] + ['0'] * 18 + ['100']) + '\n')
        (self.process / 'status').write_text('Uid:\t1000\t1000\t1000\t1000\n')
        (self.process / 'cgroup').write_text('0::/test\n')
        (self.process / 'fd/3').symlink_to('socket:[789]')
        self.row = ' 0: 0100007F:5BA0 00000000:0000 0A 0:0 0:0 0 1000 0 789\n'
        (self.process / 'net/tcp').write_text('header\n' + self.row)

    def observe(self, bounds=None):
        return probe.observe(1234, 23456, bounds or BOUNDS, str(self.root))

    def test_fixture_observation_retains_provenance_and_listener_inode(self):
        result = self.observe()
        self.assertEqual(result['source'], 'fixture')
        self.assertEqual(result['pid'], 1234)
        self.assertEqual(result['start-ticks'], 100)
        self.assertEqual(result['socket-inodes'], [789])
        self.assertEqual(result['listeners'], [{'address': '127.0.0.1', 'port': 23456, 'state': 'LISTEN', 'inode': 789}])

    def test_nonlistener_and_other_port_are_not_credited(self):
        (self.process / 'net/tcp').write_text('header\n' + self.row.replace(' 0A ', ' 01 ') + self.row.replace(':5BA0', ':5BA1'))
        self.assertEqual(self.observe()['listeners'], [])

    def test_wildcard_listener_is_reported_without_relabeling(self):
        (self.process / 'net/tcp').write_text('header\n' + self.row.replace('0100007F', '00000000'))
        self.assertEqual(self.observe()['listeners'][0]['address'], '0.0.0.0')

    def test_foreign_listener_does_not_become_an_owned_descriptor(self):
        (self.process / 'fd/3').unlink()
        self.assertEqual(self.observe()['socket-inodes'], [])
        self.assertEqual(len(self.observe()['listeners']), 1)

    def test_process_reuse_or_identity_change_is_rejected(self):
        first = probe._identity(self.process, BOUNDS['max-file-bytes'])
        second = {**first, 'start-ticks': 101}
        with mock.patch.object(probe, '_identity', side_effect=[first, second]):
            with self.assertRaises(probe.ProbeError):
                self.observe()

    def test_oversized_file_and_descriptor_table_fail_closed(self):
        with self.assertRaises(probe.ProbeError):
            self.observe({'max-file-bytes': 3, 'max-fds': 256})
        (self.process / 'fd/4').symlink_to('socket:[790]')
        with self.assertRaises(probe.ProbeError):
            self.observe({'max-file-bytes': 1048576, 'max-fds': 1})

    def test_missing_duplicate_and_invalid_metadata_raise(self):
        for text in ['Name: x\n', 'Uid: 1 2 3 4\nUid: 1 2 3 4\n', 'Uid: 1 2\n']:
            (self.process / 'status').write_text(text)
            with self.assertRaises(probe.ProbeError):
                self.observe()

    def test_invalid_targets_and_bounds_do_not_read(self):
        for pid, port in [(True, 23456), (0, 23456), (1234, 0), (1234, True)]:
            with self.assertRaises(probe.ProbeError):
                probe.observe(pid, port, BOUNDS, str(self.root))
        for bounds in [{'max-file-bytes': 1048577, 'max-fds': 256},
                       {'max-file-bytes': 1048576, 'max-fds': 257}]:
            with self.assertRaises(probe.ProbeError):
                self.observe(bounds)

    def test_descriptor_change_during_capture_fails_closed(self):
        real_identity = probe._identity
        def identity(directory, maximum):
            value = real_identity(directory, maximum)
            if identity.calls:
                (self.process / 'fd/4').symlink_to('socket:[790]')
            identity.calls += 1
            return value
        identity.calls = 0
        with mock.patch.object(probe, '_identity', side_effect=identity):
            with self.assertRaisesRegex(probe.ProbeError, 'descriptors changed'):
                self.observe()

    def test_controller_join_retains_both_snapshots_and_pinned_lease(self):
        lease = SimpleNamespace(nonce='a' * 32, invocation='b' * 32, unit='fixture.service')
        worker = SimpleNamespace(lease=lease, reconcile=mock.Mock(side_effect=[{'MainPID': '1234'}, {'MainPID': '5678'}]))
        with mock.patch.object(probe, 'observe', return_value={'pid': 1234}):
            result = probe.observe_worker(worker, 23456, BOUNDS)
        self.assertEqual(result['before']['MainPID'], 1234)
        self.assertEqual(result['after']['MainPID'], 5678)
        self.assertEqual(result['before']['query-unit'], lease.unit)
        self.assertEqual(result['lease']['invocation'], lease.invocation)
        self.assertEqual(worker.reconcile.call_count, 2)

    def test_unpinned_controller_never_reconciles_or_observes(self):
        worker = SimpleNamespace(lease=SimpleNamespace(invocation=''), reconcile=mock.Mock())
        with self.assertRaises(probe.ProbeError):
            probe.observe_worker(worker, 23456, BOUNDS)
        worker.reconcile.assert_not_called()

    def test_live_owned_child_observation_and_cleanup_without_unit_or_model_claim(self):
        code = ('import socket,time,json,os; s=socket.socket();'
                's.bind(("127.0.0.1",0));s.listen(1);'
                'print(json.dumps({"pid":os.getpid(),"port":s.getsockname()[1]}),flush=True);time.sleep(3)')
        child = subprocess.Popen([sys.executable, '-B', '-u', '-c', code], stdout=subprocess.PIPE, text=True)
        self.addCleanup(child.stdout.close)
        try:
            target = json.loads(child.stdout.readline())
            observed = probe.observe(target['pid'], target['port'], BOUNDS)
            self.assertEqual(observed['source'], '/proc')
            listener = observed['listeners'][0]
            self.assertEqual(listener['address'], '127.0.0.1')
            self.assertIn(listener['inode'], observed['socket-inodes'])
            self.assertEqual(observed['network-namespace'], observed['requester-network-namespace'])
            self.assertEqual(observed['uids'], [os.getuid()] * 4)
        finally:
            child.terminate()
            child.wait(timeout=5)
        self.assertFalse(pathlib.Path('/proc', str(child.pid)).exists())


if __name__ == '__main__':
    unittest.main()
