# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded HTTP/NDJSON I/O for a caller-owned loopback endpoint.

There is deliberately no live-inference CLI or worker launcher. Tests own fake
HTTP endpoints. A future controller must supply reviewed law bounds, ownership,
model/context proofs and fresh admission before calling this transport.
"""
import errno
import http.client
import json
import math
import selectors
import socket
import threading
import time
import urllib.parse


class StreamFault(Exception):
    """A labelled framing/transport observation, not an answer-quality score."""


def strict_json(raw, max_depth):
    depth = 0
    quoted = False
    escaped = False
    for character in raw:
        if quoted:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quoted = False
        elif character == '"':
            quoted = True
        elif character in '[{':
            depth += 1
            if depth > max_depth:
                raise StreamFault('json-depth-limit')
        elif character in ']}':
            depth -= 1

    def constant(_value):
        raise StreamFault('nonfinite-json')

    def finite_float(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise StreamFault('nonfinite-json')
        return parsed

    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise StreamFault('duplicate-json-key')
            result[key] = value
        return result

    return json.loads(raw, parse_constant=constant, parse_float=finite_float, object_pairs_hook=pairs)


def validate_inputs(url, body, bounds):
    required = ('deadline-ms', 'max-request-bytes', 'max-response-bytes',
                'max-line-bytes', 'max-events', 'max-visible-bytes', 'max-json-depth')
    if any(type(bounds.get(key)) is not int or bounds[key] <= 0 for key in required):
        raise ValueError('Positive integer transport bounds are required')
    if not isinstance(body, bytes) or len(body) > bounds['max-request-bytes']:
        raise ValueError('Request bytes exceed the supplied bound')
    endpoint = urllib.parse.urlsplit(url)
    if (endpoint.scheme != 'http' or endpoint.hostname != bounds.get('host')
            or endpoint.hostname != '127.0.0.1' or endpoint.port is None
            or endpoint.port == 11434 or endpoint.port in bounds.get('forbidden-ports', [])
            or endpoint.username is not None or endpoint.password is not None
            or endpoint.path != '/api/chat' or endpoint.path != bounds.get('path')
            or endpoint.query or endpoint.fragment):
        raise ValueError('Only the supplied loopback endpoint contract is permitted')
    return endpoint


def consume(url, body, bounds, cancel=None):
    """Return bounded stream facts. This function never grades model answers."""
    endpoint = validate_inputs(url, body, bounds)
    cancel = cancel if cancel is not None else threading.Event()
    start = time.monotonic()
    deadline = start + bounds['deadline-ms'] / 1000
    stop = threading.Event()
    lock = threading.Lock()
    state = {'reason': None, 'finished': False}
    network = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    connection = http.client.HTTPConnection(endpoint.hostname, endpoint.port)
    response = None
    monitor = None
    text = ''
    visible_bytes = 0
    visible = None
    done = False
    status = 'failed'
    failure = None
    bytes_read = 0
    events = 0
    provider = {}
    completed_at = None
    parsed_response = None
    parse_error = False
    close_errors = []

    def reason():
        with lock:
            if not state['finished'] and state['reason'] is None:
                if cancel.is_set():
                    state['reason'] = 'cancelled'
                elif time.monotonic() >= deadline:
                    state['reason'] = 'timeout'
            return state['reason']

    def check():
        current = reason()
        if current is not None:
            raise StreamFault(current)

    def watchdog():
        while not stop.wait(min(.01, max(.0001, deadline - time.monotonic()))):
            if reason() is not None:
                # Finalization takes this lock before closing the descriptor.
                # A stale timeout must not act after close/descriptor reuse.
                with lock:
                    if state['finished']:
                        return
                    try:
                        network.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                return

    try:
        check()
        network.setblocking(False)
        pending = network.connect_ex((endpoint.hostname, endpoint.port))
        if pending not in (0, errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY):
            raise OSError(pending, 'loopback connection failed')
        if pending:
            with selectors.DefaultSelector() as selector:
                selector.register(network, selectors.EVENT_WRITE)
                while True:
                    check()
                    if selector.select(min(.01, max(.0001, deadline - time.monotonic()))):
                        error = network.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                        if error:
                            raise OSError(error, 'loopback connection failed')
                        break
        check()
        network.setblocking(True)
        network.settimeout(max(.0001, deadline - time.monotonic()))
        connection.sock = network
        monitor = threading.Thread(target=watchdog, name='quote-stream-watchdog', daemon=True)
        monitor.start()
        connection.request('POST', endpoint.path, body=body,
                           headers={'Content-Type': 'application/json', 'Connection': 'close'})
        response = connection.getresponse()
        check()
        if response.status != 200:
            raise StreamFault('http-status-' + str(response.status))
        while True:
            check()
            remaining = bounds['max-response-bytes'] - bytes_read
            line = response.readline(min(bounds['max-line-bytes'], remaining) + 1)
            check()
            if not line:
                raise StreamFault('eof-before-done')
            bytes_read += len(line)
            events += 1
            if bytes_read > bounds['max-response-bytes']:
                raise StreamFault('response-byte-limit')
            if len(line) > bounds['max-line-bytes']:
                raise StreamFault('line-byte-limit')
            if events > bounds['max-events']:
                raise StreamFault('event-limit')
            if not line.strip():
                continue
            frame = strict_json(line.decode('utf8'), bounds['max-json-depth'])
            if not isinstance(frame, dict):
                raise StreamFault('non-object-frame')
            if 'error' in frame:
                raise StreamFault('provider-error')
            if type(frame.get('done')) is not bool:
                raise StreamFault('invalid-done-flag')
            message = frame.get('message', {})
            if not isinstance(message, dict) or not isinstance(message.get('content', ''), str):
                raise StreamFault('invalid-content')
            fragment = message.get('content', '')
            if fragment and visible is None:
                visible = (time.monotonic() - start) * 1000
            fragment_bytes = len(fragment.encode('utf8'))
            if visible_bytes + fragment_bytes > bounds['max-visible-bytes']:
                raise StreamFault('visible-byte-limit')
            text += fragment
            visible_bytes += fragment_bytes
            if frame['done']:
                done = True
                try:
                    parsed_response = strict_json(text, bounds['max-json-depth'])
                except (ValueError, StreamFault, RecursionError):
                    parse_error = True
                check()
                with lock:
                    if state['reason'] is not None or cancel.is_set() or time.monotonic() >= deadline:
                        state['reason'] = state['reason'] or ('cancelled' if cancel.is_set() else 'timeout')
                        raise StreamFault(state['reason'])
                    completed_at = time.monotonic()
                    state['finished'] = True
                    stop.set()
                status = 'completed'
                provider = {key: frame[key] for key in ('load_duration', 'prompt_eval_count',
                            'prompt_eval_duration', 'eval_count', 'eval_duration') if key in frame}
                break
    except (StreamFault, OSError, ValueError, RecursionError, http.client.HTTPException) as error:
        failure = str(error) if isinstance(error, StreamFault) else type(error).__name__
        current = reason()
        status = current if current is not None else 'failed'
        failure = current if current is not None else failure
    finally:
        with lock:
            state['finished'] = True
        stop.set()
        try:
            network.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        closers = ([response.close] if response is not None else []) + [connection.close, network.close]
        for close in closers:
            try:
                close()
            except (OSError, http.client.HTTPException) as error:
                close_errors.append(type(error).__name__)
        if monitor is not None:
            monitor.join(timeout=.5)
    end = completed_at if completed_at is not None else time.monotonic()
    result = {'status': status, 'done': done, 'elapsed-ms': (end - start) * 1000,
              'first-visible-ms': visible, 'partial-output': text,
              'bytes-read': bytes_read, 'events': events, 'provider-timing': provider,
              'cleanup-complete': not close_errors and network.fileno() == -1
              and (monitor is None or not monitor.is_alive())}
    if not result['cleanup-complete']:
        result['status'] = 'cleanup-failed'
    if failure is not None:
        result['failure'] = failure
    if done and status == 'completed':
        result['response'] = parsed_response
        if parse_error:
            result['response-parse-error'] = True
    return result
