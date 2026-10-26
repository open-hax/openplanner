# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned synthetic HTTP streams only. Never contacts a model or cloud service."""
import contextlib
import http.server
import json
import pathlib
import socket
import subprocess
import threading
import time
import unittest
from unittest import mock

import stream_adapter

HERE = pathlib.Path(__file__).resolve().parent
BOUNDS = json.loads(subprocess.run(['bb', str(HERE / 'law_cli.clj')],
                   input='{"operation":"transport-bounds"}', capture_output=True,
                   text=True, check=True, timeout=15).stdout)
ANSWER = json.dumps({'source_id': 's0', 'evidence': 'the same spine', 'answer': 'Supported'})


def frame(content='', done=False, **extra):
    return (json.dumps({'message': {'content': content}, 'done': done, **extra},
                       ensure_ascii=False) + '\n').encode()


def headers(handler, status=200, chunked=False):
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/x-ndjson')
    handler.send_header('Connection', 'close')
    if chunked:
        handler.send_header('Transfer-Encoding', 'chunked')
    handler.end_headers()


def send(handler, value):
    handler.wfile.write(value)
    handler.wfile.flush()


def wait_disconnect(handler):
    handler.connection.settimeout(.8)
    try:
        if handler.connection.recv(1) == b'':
            handler.server.disconnected.set()
    except (ConnectionResetError, BrokenPipeError):
        handler.server.disconnected.set()


@contextlib.contextmanager
def fake_server(script):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_args):
            pass

        def do_POST(self):
            self.server.requests.append((self.path, self.rfile.read(int(self.headers['Content-Length']))))
            self.server.accepted.set()
            try:
                script(self)
            except (BrokenPipeError, ConnectionResetError, OSError):
                self.server.disconnected.set()
            finally:
                self.server.handler_done.set()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    server.requests = []
    server.accepted = threading.Event()
    server.handler_done = threading.Event()
    server.disconnected = threading.Event()
    server.stop_script = threading.Event()
    worker = threading.Thread(target=lambda: server.serve_forever(poll_interval=.01), daemon=True)
    worker.start()
    server.url = f'http://127.0.0.1:{server.server_port}/api/chat'
    try:
        yield server
    finally:
        server.stop_script.set()
        server.shutdown()
        server.server_close()
        worker.join(timeout=1)
        if server.requests and not server.handler_done.wait(1):
            raise AssertionError('Owned fake handler failed to finish')
        if worker.is_alive():
            raise AssertionError('Owned fake server failed to stop')


class StreamContract(unittest.TestCase):
    def run_stream(self, server, **changes):
        result = stream_adapter.consume(server.url, b'{}', {**BOUNDS, **changes})
        self.assertTrue(result['cleanup-complete'])
        self.assertFalse(any(t.name == 'quote-stream-watchdog' for t in threading.enumerate()))
        return result

    def test_complete_fragmented_json_preserves_payload_and_timing(self):
        def script(handler):
            headers(handler)
            raw = frame(ANSWER[:23]) + frame(ANSWER[23:], True, load_duration=7000, prompt_eval_count=42)
            for offset in range(0, len(raw), 3):
                send(handler, raw[offset:offset + 3])
            wait_disconnect(handler)
        with fake_server(script) as server:
            result = self.run_stream(server)
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['response'], json.loads(ANSWER))
            self.assertLessEqual(result['first-visible-ms'], result['elapsed-ms'])
            self.assertEqual(result['provider-timing']['prompt_eval_count'], 42)
            self.assertEqual(server.requests, [('/api/chat', b'{}')])
            self.assertTrue(server.disconnected.wait(.5))

    def test_chunked_http_and_utf8_boundaries(self):
        text = json.dumps({'source_id': None, 'evidence': '', 'answer': 'Insufficient evidence 💡'}, ensure_ascii=False)
        def script(handler):
            headers(handler, chunked=True)
            raw = frame(text, True)
            for byte in raw:
                send(handler, b'1\r\n' + bytes([byte]) + b'\r\n')
            send(handler, b'0\r\n\r\n')
        with fake_server(script) as server:
            self.assertEqual(self.run_stream(server)['response']['answer'], 'Insufficient evidence 💡')

    def test_eof_before_done_is_not_completion(self):
        def script(handler):
            headers(handler)
            send(handler, frame('partial text'))
        with fake_server(script) as server:
            result = self.run_stream(server)
            self.assertNotEqual(result['status'], 'completed')
            self.assertFalse(result['done'])
            self.assertEqual(result['failure'], 'eof-before-done')
            self.assertEqual(result['partial-output'], 'partial text')

    def test_quiet_body_is_interrupted_at_absolute_deadline(self):
        def script(handler):
            headers(handler)
            wait_disconnect(handler)
        with fake_server(script) as server:
            start = time.monotonic()
            result = self.run_stream(server, **{'deadline-ms': 60})
            self.assertEqual(result['status'], 'timeout')
            self.assertLess(time.monotonic() - start, .8)
            self.assertTrue(server.disconnected.wait(.5))

    def test_quiet_headers_are_also_interrupted(self):
        with fake_server(wait_disconnect) as server:
            result = self.run_stream(server, **{'deadline-ms': 60})
            self.assertEqual(result['status'], 'timeout')
            self.assertTrue(server.disconnected.wait(.5))

    def test_continuous_trickle_does_not_extend_deadline(self):
        def script(handler):
            headers(handler)
            while not handler.server.stop_script.wait(.005):
                send(handler, b' ')
        with fake_server(script) as server:
            start = time.monotonic()
            result = self.run_stream(server, **{'deadline-ms': 60})
            self.assertEqual(result['status'], 'timeout')
            self.assertLess(time.monotonic() - start, .8)

    def test_external_cancellation_closes_the_request(self):
        def script(handler):
            headers(handler)
            wait_disconnect(handler)
        with fake_server(script) as server:
            cancel = threading.Event()
            def trigger():
                server.accepted.wait(.5)
                cancel.set()
            task = threading.Thread(target=trigger)
            task.start()
            result = stream_adapter.consume(server.url, b'{}', BOUNDS, cancel)
            task.join(timeout=1)
            self.assertEqual(result['status'], 'cancelled')
            self.assertTrue(result['cleanup-complete'])
            self.assertTrue(server.disconnected.wait(.5))
            self.assertFalse(task.is_alive())

    def test_cancelled_before_connect_never_posts(self):
        with fake_server(lambda _h: None) as server:
            cancel = threading.Event()
            cancel.set()
            result = stream_adapter.consume(server.url, b'{}', BOUNDS, cancel)
            self.assertEqual(result['status'], 'cancelled')
            self.assertEqual(server.requests, [])
            self.assertTrue(result['cleanup-complete'])

    def test_size_event_and_visible_caps(self):
        probes = [({'max-response-bytes': 20}, frame('x' * 30), 'response-byte-limit'),
                  ({'max-line-bytes': 20}, frame('x' * 30), 'line-byte-limit'),
                  ({'max-events': 1}, frame('x') + frame('y', True), 'event-limit'),
                  ({'max-visible-bytes': 3}, frame('💡'), 'visible-byte-limit'),
                  ({'max-visible-bytes': 4}, frame('xxx') + frame('yy'), 'visible-byte-limit')]
        for changes, raw, expected in probes:
            with self.subTest(expected=expected):
                def script(handler):
                    headers(handler)
                    send(handler, raw)
                with fake_server(script) as server:
                    result = self.run_stream(server, **changes)
                    self.assertEqual(result['failure'], expected)
                    self.assertLessEqual(len(result['partial-output'].encode('utf8')),
                                         changes.get('max-visible-bytes', BOUNDS['max-visible-bytes']))

    def test_invalid_framing_and_provider_failures(self):
        probes = [(b'{"done":false,"done":true}\n', 'duplicate-json-key'),
                  (b'{"done":false,"value":NaN}\n', 'nonfinite-json'),
                  (b'{"done":false,"value":1e400}\n', 'nonfinite-json'),
                  (b'[]\n', 'non-object-frame'),
                  (b'{"done":false,"nested":' + b'[' * 40 + b'0' + b']' * 40 + b'}\n', 'json-depth-limit'),
                  (b'{"done":1}\n', 'invalid-done-flag'),
                  (b'{"done":false,"message":{"content":5}}\n', 'invalid-content'),
                  (b'{"error":"synthetic provider failure"}\n', 'provider-error'),
                  (b'\xff\n', 'UnicodeDecodeError')]
        for raw, expected in probes:
            with self.subTest(expected=expected):
                def script(handler):
                    headers(handler)
                    send(handler, raw)
                with fake_server(script) as server:
                    result = self.run_stream(server)
                    self.assertEqual(result['failure'], expected)
                    self.assertNotEqual(result['status'], 'completed')

    def test_non_200_is_not_followed_or_graded(self):
        def script(handler):
            headers(handler, status=302)
        with fake_server(script) as server:
            result = self.run_stream(server)
            self.assertEqual(result['failure'], 'http-status-302')
            self.assertNotIn('response', result)

    def test_final_json_parse_is_inside_the_usable_deadline(self):
        original = stream_adapter.strict_json
        def delayed(raw, max_depth):
            if raw == ANSWER:
                time.sleep(.08)
            return original(raw, max_depth)
        def script(handler):
            headers(handler)
            send(handler, frame(ANSWER, True))
        with fake_server(script) as server, mock.patch.object(stream_adapter, 'strict_json', delayed):
            result = self.run_stream(server, **{'deadline-ms': 40})
            self.assertEqual(result['status'], 'timeout')
            self.assertNotIn('response', result)

    def test_malformed_final_json_is_retained_as_parse_failure(self):
        def script(handler):
            headers(handler)
            send(handler, frame('{', True))
        with fake_server(script) as server:
            result = self.run_stream(server)
            self.assertEqual(result['status'], 'completed')
            self.assertTrue(result['response-parse-error'])
            self.assertIsNone(result['response'])

    def test_deep_or_duplicate_final_json_is_not_a_valid_response(self):
        for text in ['[' * 1100 + '0' + ']' * 1100, '{"source_id":"s0","source_id":"s1"}',
                     '{"source_id":"s0","evidence":"same spine","answer":"ok","hidden":1e400}']:
            with self.subTest(length=len(text)):
                def script(handler):
                    headers(handler)
                    send(handler, frame(text, True))
                with fake_server(script) as server:
                    result = self.run_stream(server)
                    self.assertTrue(result['response-parse-error'])
                    self.assertIsNone(result['response'])

    def test_cleanup_errors_do_not_skip_remaining_closers(self):
        def script(handler):
            headers(handler)
            send(handler, frame(ANSWER, True))
        with fake_server(script) as server:
            with mock.patch.object(stream_adapter.http.client.HTTPConnection, 'close',
                                   side_effect=OSError('synthetic close failure')):
                result = stream_adapter.consume(server.url, b'{}', BOUNDS)
            self.assertEqual(result['status'], 'cleanup-failed')
            self.assertFalse(result['cleanup-complete'])
            self.assertFalse(any(t.name == 'quote-stream-watchdog' for t in threading.enumerate()))

    def test_shared_port_and_nonloopback_targets_are_rejected_without_network(self):
        for url in ['http://127.0.0.1:11434/api/chat', 'http://example.com:1234/api/chat',
                    'http://localhost:1234/api/chat', 'https://127.0.0.1:1234/api/chat',
                    'http://user:pass@127.0.0.1:1234/api/chat', 'http://127.0.0.1:1234/api/chat?x=1']:
            with self.subTest(url=url), mock.patch.object(socket, 'socket') as dial:
                with self.assertRaises(ValueError):
                    stream_adapter.consume(url, b'{}', {**BOUNDS, 'forbidden-ports': []})
                dial.assert_not_called()

        with mock.patch.object(socket, 'socket') as dial:
            with self.assertRaises(ValueError):
                stream_adapter.consume('http://127.0.0.1:1234/api/generate', b'{}',
                                       {**BOUNDS, 'path': '/api/generate'})
            dial.assert_not_called()

    def test_invalid_bounds_and_oversized_request_never_connect(self):
        with mock.patch.object(socket, 'socket') as dial:
            for change in [{'deadline-ms': 0}, {'deadline-ms': True}, {'max-events': float('inf')}]:
                with self.assertRaises(ValueError):
                    stream_adapter.consume('http://127.0.0.1:1234/api/chat', b'{}', {**BOUNDS, **change})
            with self.assertRaises(ValueError):
                stream_adapter.consume('http://127.0.0.1:1234/api/chat', b'x' * 65537, BOUNDS)
            dial.assert_not_called()

    def test_law_scores_complete_and_incomplete_facts_separately(self):
        case = {'id': 'synthetic', 'sources': [{'id': 's0', 'text': 'the same spine remains'}],
                'gold-parent-ids': ['s0'], 'gold-span': 'same spine'}
        for finished in [True, False]:
            def script(handler):
                headers(handler)
                send(handler, frame(ANSWER, finished))
            with fake_server(script) as server:
                facts = self.run_stream(server)
            output = subprocess.run(['bb', str(HERE / 'law_cli.clj')],
                                    input=json.dumps({'operation': 'score', 'case': case, 'transport': facts}),
                                    text=True, capture_output=True, check=True, timeout=15)
            score = json.loads(output.stdout)
            self.assertEqual(score['quality-scored'], finished)
            if finished:
                self.assertTrue(score['joint-grounded-quote'])
            else:
                self.assertNotIn('joint-grounded-quote', score)


if __name__ == '__main__':
    unittest.main(verbosity=2)
