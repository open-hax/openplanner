# SPDX-License-Identifier: GPL-3.0-or-later
"""Foreign file/hash and BB adapter. Prints metadata only; never source text."""
import argparse
import hashlib
import json
import pathlib
import subprocess


def validate(path, expected_hash):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError('Frozen fixture identity mismatch')
    fixture = json.loads(raw)
    for case in fixture['cases']:
        for source in case['sources']:
            if hashlib.sha256(source['text'].encode()).hexdigest() != source['text-sha256']:
                raise ValueError('Source excerpt identity mismatch')
    fixture['hashes-verified'] = True
    cli = pathlib.Path(__file__).resolve().with_name('law_cli.clj')
    result = subprocess.run(['bb', str(cli)], input=json.dumps({'operation': 'fixture', 'fixture': fixture}),
                            capture_output=True, text=True, timeout=15, check=True)
    decision = json.loads(result.stdout)
    if decision.get('admit') is not True:
        raise ValueError('Frozen fixture failed portable admission')
    return {'fixture-sha256': expected_hash, 'cases': len(fixture['cases']),
            'gold-support-visible': sum(c['gold-support-visible'] for c in fixture['cases']),
            'admission': decision}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('fixture', type=pathlib.Path)
    parser.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    print(json.dumps(validate(args.fixture, args.expected_sha256)))
