"""Two explicit free-model calls using fictional RAG evidence in an isolated DB.

Never prints or copies credentials. No production records or user documents read.
"""
from pathlib import Path
import json
import os
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.start_demo import load_environment
from backend.model_adapter import ModelAdapter
from fastapi.testclient import TestClient
from backend.main import create_app


def main():
    load_environment()
    adapter = ModelAdapter()
    if adapter.mode == 'replay' or adapter.configuration_error():
        print('未配置可用的智谱免费模式，未调用外部服务。')
        return 1
    os.environ['DEMO_ACCESS_TOKEN'] = ''
    out = ROOT / 'tmp/rag-acceptance'
    out.mkdir(exist_ok=True, parents=True)
    report = {'model': adapter.info['model_name'], 'data': 'isolated fictional samples', 'checks': [], 'passed': False}
    with tempfile.TemporaryDirectory(prefix='live-', dir=out) as directory:
        with TestClient(create_app(directory)) as client:
            for space, query, task in [('kb-medical', '咨询预约流程和接待时间，整理内部答复', 'answer'), ('kb-live', '保温杯规格和直播讲解要求，整理内部脚本', 'script')]:
                docs = client.post(f'/api/knowledge/spaces/{space}/samples').json()
                for doc in docs:
                    response = client.post(f"/api/knowledge/documents/{doc['id']}/review", json={'status': 'approved', 'expected_version': 1})
                    response.raise_for_status()
                result = client.post('/api/knowledge/search', json={'space_id': space, 'query': query}).json()
                start = time.monotonic()
                response = client.post('/api/knowledge/drafts', json={'space_id': space, 'query': query, 'signature': result['signature'], 'task': task})
                item = {'space': space, 'status': response.status_code, 'seconds': round(time.monotonic() - start, 2)}
                if response.status_code != 200:
                    item['detail'] = response.json().get('detail')
                    report['checks'].append(item)
                    print(json.dumps(item, ensure_ascii=False), flush=True)
                    break
                draft = response.json()
                assert draft['source'] == 'model' and draft['status'] == 'draft'
                assert all(b['citation_ids'] for b in draft['blocks']) and draft['sources']
                item.update(draft=draft, citations=len(draft['sources']))
                report['checks'].append(item)
                print(json.dumps({k: v for k, v in item.items() if k != 'draft'}, ensure_ascii=False), flush=True)
            report['passed'] = len(report['checks']) == 2 and all(c['status'] == 200 for c in report['checks'])
    (out / 'live-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
