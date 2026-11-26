import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Analytics, type State } from '../api';
import type { Act } from '../domain';

export function useWorkspaceData() {
  const [state, setState] = useState<State | null>(null);
  const [campaignId, setCampaignId] = useState(() => new URLSearchParams(location.hash.split('?')[1] || '').get('campaign') || localStorage.getItem('campaign') || '');
  const [dataset, setDatasetRaw] = useState(localStorage.getItem('v2-dataset') || 'session');
  const [batchId, setBatchIdRaw] = useState(localStorage.getItem('v2-batch') || '');
  const [planId, setPlanId] = useState(localStorage.getItem('v2-plan') || '');
  const [dateFrom, setDateFrom] = useState(localStorage.getItem('v2-from') || '');
  const [dateTo, setDateTo] = useState(localStorage.getItem('v2-to') || '');
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [auth, setAuth] = useState(false);
  const [revision, setRevision] = useState(0);
  const [historyOptions, setHistoryOptions] = useState<{ id: string; name: string }[]>([]);
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    const next = await api<State>('/state');
    for (const key of ['insights', 'adjustments', 'batches', 'tasks', 'observations', 'reports', 'live_sessions'] as const) {
      if (!next[key]) (next as unknown as Record<string, unknown>)[key] = [];
    }
    setState(next);
    setAuth(false);
    setCampaignId(previous => next.campaigns.some(c => c.id === previous) ? previous : next.campaigns[0]?.id || '');
    setRevision(value => value + 1);
  }, []);
  const act: Act = async (operation, success) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await operation(); await refresh(); if (success) setToast(success); return true; }
    catch (failure) {
      const issue = failure as Error & { status?: number };
      setError(issue.message || '操作失败，请重试');
      if (issue.status === 401) setAuth(true);
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  const setDataset = (value: string) => {
    setDatasetRaw(value); setPlanId('');
    if (value !== 'session') { setDateFrom(''); setDateTo(''); }
  };
  const setBatchId = (value: string) => { setBatchIdRaw(value); setPlanId(''); };
  useEffect(() => { refresh().catch(issue => { if (issue.status === 401) setAuth(true); else setError(issue.message); }); }, [refresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    for (const [key, value] of Object.entries({ campaign: campaignId, 'v2-dataset': dataset, 'v2-batch': batchId, 'v2-plan': planId, 'v2-from': dateFrom, 'v2-to': dateTo })) localStorage.setItem(key, value);
  }, [campaignId, dataset, batchId, planId, dateFrom, dateTo]);
  useEffect(() => {
    if (!state || !campaignId) return;
    let cancelled = false;
    setAnalytics(null); setAnalyticsError('');
    if (dataset === 'batch' && !batchId) return;
    const query = new URLSearchParams({ campaign_id: campaignId, dataset });
    if (planId) query.set('plan_id', planId);
    if (dataset === 'batch') query.set('batch_id', batchId);
    if (dataset === 'session') {
      if (dateFrom) query.set('date_from', dateFrom);
      if (dateTo) query.set('date_to', dateTo);
    }
    api<Analytics>('/analytics?' + query).then(value => { if (!cancelled) setAnalytics(value); }).catch(issue => { if (!cancelled) setAnalyticsError(issue.message); });
    return () => { cancelled = true; };
  }, [campaignId, dataset, batchId, planId, dateFrom, dateTo, revision]);
  useEffect(() => {
    if (!campaignId || dataset !== 'history') return;
    let cancelled = false;
    setHistoryOptions([]);
    api<Analytics>('/analytics?dataset=history&campaign_id=' + encodeURIComponent(campaignId)).then(value => {
      if (!cancelled) setHistoryOptions(value.rows.filter(row => row.plan_id).map(row => ({ id: row.plan_id!, name: row.name })));
    }).catch(issue => { if (!cancelled) setError(issue.message); });
    return () => { cancelled = true; };
  }, [campaignId, dataset]);
  return { state, campaignId, setCampaignId, dataset, setDataset, batchId, setBatchId, planId, setPlanId, dateFrom, setDateFrom, dateTo, setDateTo,
    analytics, analyticsError, busy, error, setError, toast, setToast, auth, revision, refresh, act, historyOptions };
}
