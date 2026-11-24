"""Explicit real-provider acceptance with fictional data in an isolated database.

At most one creative request plus one bounded Agent attempt (seven requests).
No publishing, approvals, spending actions, or daily database access.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description='DeepSeek 真实业务验收，使用虚构资料；会产生模型账户用量')
    parser.add_argument('--run', action='store_true', help='明确执行，最多8次请求，不自动重试整轮')
    args = parser.parse_args()
    if not args.run:
        print('未执行。获得真实调用授权后使用 --run；普通回归请用 mock/replay。')
        return 0
    from scripts.start_demo import load_environment
    for key in ('MODEL_PROVIDER', 'MODEL_NAME', 'MODEL_BASE_URL', 'MODEL_API_KEY'):
        os.environ.pop(key, None)
    load_environment()
    from backend.model_adapter import ModelAdapter
    adapter = ModelAdapter()
    if adapter.mode != 'deepseek' or adapter.configuration_error():
        print('官方 DeepSeek 配置未就绪，未发出请求。')
        return 1
    out = ROOT / 'tmp/deepseek-live-acceptance'
    out.mkdir(parents=True, exist_ok=True)
    directory = tempfile.mkdtemp(prefix='fictional-', dir=out)
    os.environ.update(DEMO_DATA_DIR=directory, DEMO_ACCESS_TOKEN='', KB_SEMANTIC_ENABLED='0',
                      HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    from backend.main import create_app
    from fastapi.testclient import TestClient
    report = {'provider': 'deepseek', 'model': adapter.model, 'data': 'isolated fictional fixtures',
              'checks': [], 'passed': False, 'request_budget': 8}
    app = create_app(directory)
    try:
        with TestClient(app) as client:
            initial = client.get('/api/state').json()
            assert initial['model']['mode'] == 'deepseek'
            before_count = initial['model']['call_count']
            body = {'tone': '简洁', 'angle': '规格', 'recipe': 'questions', 'request_id': 'real-deepseek-creative-once'}
            print('真实验收 1/2：生成虚构商品创意。', flush=True)
            response = client.post('/api/campaigns/campaign-demo/generate', json=body)
            if response.status_code != 200:
                report['failure'] = {'stage': 'creative', 'status': response.status_code, 'detail': response.json().get('detail')}
                return 1
            generated = response.json()
            assert len(generated) == 2
            assert all(c['source'] == 'model' and c['model_name'] == 'deepseek-flash' and c['status'] == 'draft' for c in generated)
            status = client.get('/api/model/status').json()
            assert status['call_count'] == before_count + 1
            assert status['recent_calls'][0]['provider_succeeded'] is True
            assert status['recent_calls'][0]['outcome'] == 'success'
            report['checks'].append('creative drafts saved from a real successful DeepSeek request')
            repeated = client.post('/api/campaigns/campaign-demo/generate', json=body)
            assert repeated.json() == generated
            assert client.get('/api/model/status').json()['call_count'] == status['call_count']
            report['checks'].append('idempotent repeat does not call the provider again')
            report['creative_examples'] = [{'title': c['title'], 'body': c['body'], 'source': c['source'], 'model': c['model_name']} for c in generated]
            print('创意已生成并保存，重复请求未再次调用模型。', flush=True)

            print('真实验收 2/2：Agent 检索虚构商品资料、生成并核对草稿。', flush=True)
            created = client.post('/api/agent/tasks', json={'scene': 'live', 'source_mode': 'demo', 'channel': 'internal',
                'goal': '根据已审核商品事实，整理保温杯的规格与使用说明，分开场、规格展示和收尾三段；不要增加未提供的性能或优惠。',
                'request_id': 'real-deepseek-agent-once'})
            assert created.status_code == 202
            task_id = created.json()['id']
            deadline = time.monotonic() + 280
            previous = None
            while time.monotonic() < deadline:
                task = client.get('/api/agent/tasks/' + task_id).json()
                progress = (task['status'], task['stage'], task['model_calls'])
                if progress != previous:
                    print(f"Agent：{task['status']} / {task['stage']} / 本轮请求 {task['model_calls']}", flush=True)
                    previous = progress
                if task['status'] not in {'queued', 'running'}:
                    break
                time.sleep(.5)
            else:
                client.post('/api/agent/tasks/' + task_id + '/cancel', json={'expected_attempt': task['attempt'], 'request_id': 'cancel-timeout'})
                report['failure'] = {'stage': 'agent', 'status': 'timeout'}
                return 1
            report['agent'] = {'id': task_id, 'status': task['status'], 'model': task['model_name'], 'model_calls': task['model_calls'],
                               'message': task['message'], 'events': [{'action': e['action'], 'status': e['status']} for e in task['events']]}
            if task['status'] != 'waiting_review' or not task.get('draft'):
                report['failure'] = {'stage': 'agent', 'status': task['status'], 'detail': task['message']}
                return 1
            assert task['source'] == 'model' and task['model_name'] == 'deepseek-flash'
            assert task['draft']['source'] == 'model' and task['draft']['model_name'] == 'deepseek-flash'
            assert task['draft']['status'] != 'confirmed'
            report['checks'].append('Agent produced a real model draft and stopped for human review')
            final = client.get('/api/state').json()
            assert len(final['orders']) == len(initial['orders']) and len(final['plans']) == len(initial['plans'])
            assert final['model']['call_count'] <= 8
            report['checks'].append('no approvals, publishing, plan creation or simulated purchasing')
            report['passed'] = True
            print('真实创意与Agent业务验收通过；全部产物留在隔离库，等待人工审核。', flush=True)
            return 0
    finally:
        # Only existing sanitized metadata and fictional output are persisted here.
        info = app.state.model_adapter.info
        report['remote_calls'] = info['call_count']
        report['calls'] = [{k: r.get(k) for k in ('operation', 'model', 'provider', 'outcome', 'remote_calls', 'provider_succeeded', 'usage')}
                           for r in info.get('recent_calls', [])]
        (out / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'passed': report['passed'], 'checks': len(report['checks']), 'remote_calls': info['call_count'],
                          'failure': report.get('failure'), 'report': str(out / 'result.json')}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        raise SystemExit(main())
    except Exception as error:
        print('验收未完成：' + type(error).__name__ + '。查看本地验收摘要，不输出底层响应或密钥。')
        raise SystemExit(1)
