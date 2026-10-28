# SPDX-License-Identifier: GPL-3.0-or-later
"""One fixed synthetic request after two existing-controller preflight joins.

There is no configurable body, host, model or arbitrary endpoint URL. This is
not a model admission controller or an atomic connection-ownership primitive.
"""
import json
import pathlib
import subprocess

from endpoint_probe import observe_worker
from stream_adapter import consume
from worker_adapter import OwnershipError

HERE = pathlib.Path(__file__).resolve().parent


def law(operation, **values):
    result = subprocess.run(['bb', str(HERE / 'law_cli.clj')],
                            input=json.dumps({'operation': operation, **values}),
                            capture_output=True, text=True, timeout=5, check=True)
    return json.loads(result.stdout)


def consume_fixture(worker, port):
    bounds = law('endpoint-bounds')
    initial = observe_worker(worker, port, bounds)
    if not law('endpoint-evidence', facts=initial)['ownership-evidence-consistent']:
        raise OwnershipError('Synthetic endpoint preflight denied')
    transport_bounds = law('transport-bounds')
    current = observe_worker(worker, port, bounds)
    decision = law('fixture-endpoint-request', facts={'initial': initial, 'current': current})
    if not decision['fixture-request-allowed']:
        raise OwnershipError('Synthetic endpoint changed before request')
    body = json.dumps(decision['body'], separators=(',', ':')).encode()
    transport = consume('http://127.0.0.1:' + str(port) + '/api/chat', body, transport_bounds)
    return {'initial': initial, 'current': current, 'decision': decision,
            'transport': transport, 'model-execution': False}
