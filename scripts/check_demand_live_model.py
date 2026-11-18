"""Explicit live-model smoke test with fictional, isolated data (never daily DB)."""
import argparse
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live-model', action='store_true', help='Explicitly permit the two configured model requests')
    if not parser.parse_args().live_model:
        parser.error('Use --live-model to permit model calls with fictional test data.')
    from scripts.start_demo import load_environment
    load_environment()
    from backend.main import create_app
    from fastapi.testclient import TestClient
    folder = ROOT / 'tmp' / 'demand-live-acceptance' / str(time.time_ns())
    app = create_app(folder / 'data')
    if app.state.model_adapter.mode == 'replay' or app.state.model_adapter.configuration_error():
        raise SystemExit('Live model is not configured; no request sent.')
    import os
    token = os.environ.get('DEMO_ACCESS_TOKEN', '')
    with TestClient(app, headers={'X-Demo-Token': token}) as c:
        def call(url, data):
            r = c.post('/api' + url, json=data)
            if r.status_code not in (200, 202):
                raise RuntimeError(f'{url}: {r.status_code}: {r.json().get("detail", "request failed")}')
            return r.json()
        def wait(task):
            for _ in range(100):
                result = c.get('/api/demand/tasks/' + task['id']).json()
                if result['status'] not in {'queued', 'running'}:
                    return result
                time.sleep(.05)
            raise RuntimeError('Local processing timeout')
        def confirm(task):
            return call('/demand/tasks/' + task['id'] + '/review', {'action': 'confirm', 'selected': [
                {'id': r['id'], 'revision': r['revision']} for r in task['results']]})['task']
        space = call('/knowledge/spaces', {'name': '模型验收虚构空间', 'scene': 'medical'})
        source = call('/demand/batches', {'space_id': space['id'], 'title': '虚构预约问题', 'filename': '验收.csv',
            'sheet': '咨询', 'columns': [{'column': 0, 'label': '问题'}], 'rows': [{'row': 1, 'values': ['超声炮咨询预约需要登记哪两项信息？']}], 'has_header': False})
        plan = call('/demand/plan', {'space_id': space['id'], 'goal': '整理已导入的预约问题，等待人工确认，不限制关键词',
            'batch_id': source['id'], 'template_id': 'builtin-analyze'})
        assert plan['source'] == 'model' and plan['config']['space_id'] == space['id']
        print('PASS live model produced editable configuration; no task auto-started', flush=True)
        config = {**plan['config'], 'filters': {}}
        preview = call('/demand/preview', {'config': config})
        parent = confirm(wait(call('/demand/tasks', {'config': config, 'preview_signature': preview['signature']})))
        child = confirm(wait(call('/demand/tasks/' + parent['id'] + '/handoff', {'task_type': 'faq', 'selected': [
            {'id': r['id'], 'revision': r['revision']} for r in parent['results']]})))
        doc = call('/knowledge/documents', {'space_id': space['id'], 'title': '虚构预约流程用于软件验收', 'kind': 'facts',
            'pages': [{'text': '超声炮咨询预约由接待人员登记到店时间与咨询问题。这是软件验收使用的虚构服务流程，不代表真实机构。'}]})
        call('/knowledge/documents/' + doc['id'] + '/review', {'status': 'approved', 'expected_version': 1})
        result = call('/demand/tasks/' + child['id'] + '/generate', {'expected_revision': child['revision'], 'result_id': child['results'][0]['id']})
        if not result['draft_id']:
            raise RuntimeError('Live model did not select any evidence: ' + '；'.join(result['missing']))
        draft = result['draft']
        assert draft['source'] == 'model' and draft['sources'][0]['document_id'] == doc['id'] and draft['demand_origin']['parent_task_id'] == parent['id']
        assert all(b['citation_ids'] for b in draft['blocks'])
        assert draft['can_confirm'], 'Complete fictional evidence must produce a reviewable draft; inspect missing fields.'
        print('PASS live model selected original evidence; saved cited draft and immutable demand origin', flush=True)
        report = {'mode': app.state.model_adapter.mode, 'model': app.state.model_adapter.model, 'plan_source': plan['source'],
            'draft_source': draft['source'], 'writing_mode': draft['writing_mode'], 'block_count': len(draft['blocks']),
            'source_count': len(draft['sources']), 'can_confirm': draft['can_confirm'], 'daily_data_used': False}
        (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
