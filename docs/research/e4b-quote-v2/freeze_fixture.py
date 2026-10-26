# SPDX-License-Identifier: GPL-3.0-or-later
"""Freeze private contexts for two fixed prompts. No model/network/database calls."""
import argparse
import collections
import hashlib
import json
import os
import pathlib

CASE_HASH = '26e865c3ad83d20e0d9d3c480bfbfe91448c6bdb1ed7b755f395d10c7bacf065'
CORPUS_HASH = 'a68eed7a9f139456c84976db1e1dc4e1001dbb66c87d29a9f911a4add14b1bf1'
DIGEST = 'c6eb396dbd5992bbe3f5cdb947e8bbc0ee413d7c17e2beaae69f5d569cf982eb'
CONFIG = {'prefix': 'raw', 'dimensions': 512, 'fusion': 0.5}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def freeze(root, output):
    if output.exists():
        raise FileExistsError('A frozen fixture cannot be overwritten')
    if sha(root / 'cases-24.json') != CASE_HASH:
        raise ValueError('Case identity drift')
    if sha(root / 'corpus-snapshot.jsonl') != CORPUS_HASH:
        raise ValueError('Corpus identity drift')
    candidate_path = root / 'jobs/research-f51b6a967496/candidate.json'
    candidate = json.loads(candidate_path.read_text())
    if candidate['selected_config'] != CONFIG:
        raise ValueError('Retrieval configuration drift')
    selected = [row for row in candidate['matrix'] if row['config'] == CONFIG]
    if len(selected) != 1:
        raise ValueError('Fixed retrieval matrix row is not unique')
    case_labels = json.loads((root / 'cases-24.json').read_text())['cases']
    labels = sorted((c for c in case_labels if c['split'] in {'development', 'validation'}
                     and c['category'] in {'lyrics', 'lore'}), key=lambda c: c['id'])
    if len(labels) != 8:
        raise ValueError('Expected exactly eight non-locked text cases')
    rows = {row['case_id']: row for row in selected[0]['cases']}
    wanted = {hit['chunk_id'] for c in labels for hit in rows[c['id']]['top10'][:5]}
    records = {}
    with (root / 'corpus-snapshot.jsonl').open() as stream:
        for line in stream:
            record = json.loads(line)
            key = str(record.get('_id'))
            if key in wanted and record.get('embedding_model') == 'embeddinggemma-2' and record.get('normalized_format') == 'text':
                if key in records:
                    raise ValueError('Duplicate chunk identity in the selected model/format partition')
                records[key] = record
    if set(records) != wanted:
        raise ValueError('Missing frozen source chunk')
    order_index = collections.Counter()
    cases = []
    for c in labels:
        sources = []
        for hit in rows[c['id']]['top10'][:5]:
            record = records[hit['chunk_id']]
            if record['parent_id'] != hit['parent_id']:
                raise ValueError('Source parent identity mismatch')
            if record['source'] != 'creative-corpus' or record['project'] != 'workspace':
                raise ValueError('Source scope mismatch')
            text = record['text'][:1500]
            sources.append({'id': record['parent_id'], 'text': text,
                            'text-sha256': hashlib.sha256(text.encode()).hexdigest(),
                            'chunk-id': str(record['_id'])})
        order = ['baseline', 'extract-first']
        if order_index[c['split']] % 2:
            order.reverse()
        order_index[c['split']] += 1
        cases.append({'id': c['id'], 'split': c['split'], 'category': c['category'],
                      'query': c['query'], 'sources': sources,
                      'gold-parent-ids': c['gold_parent_ids'], 'gold-span': c['source_anchor'],
                      'condition-order': order,
                      'gold-support-visible': any(s['id'] in c['gold_parent_ids']
                                                  and c['source_anchor'] in s['text'] for s in sources)})
    fixture = {'schema': 'e4b-quote-v2.1', 'model-digest': DIGEST,
               'model-bytes': 9608350718, 'quantization': 'Q4_K_M',
               'retrieval-config': CONFIG, 'cases': cases,
               'smoke-case-ids': ['lyrics-04', 'lore-01'],
               'input-hashes': {'cases-24.json': CASE_HASH, 'corpus-snapshot.jsonl': CORPUS_HASH,
                                'candidate.json': sha(candidate_path)},
               'label-status': 'analyst-source-grounded-provisional',
               'frozen-before-model-output': True}
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf8') as stream:
        json.dump(fixture, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    return {'fixture-sha256': sha(output), 'cases': len(cases),
            'gold-support-visible': sum(c['gold-support-visible'] for c in cases),
            'splits': dict(collections.Counter(c['split'] for c in cases))}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('private_root', type=pathlib.Path)
    parser.add_argument('private_output', type=pathlib.Path)
    args = parser.parse_args()
    print(json.dumps(freeze(args.private_root, args.private_output)))
