"""Run in Docker after native runs finish; preserves individual measurements."""
import json,pathlib,statistics
root=pathlib.Path('results/worker-scheduling')
rows=[]
for p in sorted(root.glob('*-*.json')):
    d=json.loads(p.read_text())
    if 'worker_mode' not in d: continue
    mode=d['worker_mode'];c=d['callback'];w=d['engine']['worker']
    if mode == 'realtime':
        assert w['realtime_policy_verified_at_activation'] and w['realtime_policy_at_end'],p
        assert w['workgroup_interval_errors']==0,p
    assert d['completed'] and d['gap_trace_dropped']==0,p
    assert sum(g['frames'] for g in d['gaps'])==c['starved_frames'],p
    row=dict(file=p.name,mode=mode,scenario=p.name.rsplit('-'+mode+'-',1)[0],
             starved_frames=c['starved_frames'],starved_ms=c['starved_frames']/48,
             gaps=len(d['gaps']),longest_gap_ms=max((g['frames']/48 for g in d['gaps']),default=0),
             callback_overruns=c['deadline_misses'],device_errors=c['device_errors'],
             callback_max_us=c['execution']['max_us'],producer_max_us=d['engine']['producer_blocks']['max_us'],
             rss_mib=d['resources']['peak_rss_bytes']/2**20,cpu_percent=d['engine']['peak_process_cpu_percent_one_second_windows'],
             realtime_at_end=w['realtime_policy_at_end'],wake_errors=w['wake_wait_nonzero_returns'],
             signal_errors=d['wake_signal_errors'])
    rows.append(row)
(root/'summary.json').write_text(json.dumps(rows,indent=2))
for scenario in sorted(set(r['scenario'] for r in rows)):
    for mode in ['poll','signal','realtime']:
        cases=[r for r in rows if r['scenario']==scenario and r['mode']==mode]
        if not cases: continue
        print(scenario,mode,'missing ms:',[round(c['starved_ms'],2) for c in cases],
              'callback misses:',sum(c['callback_overruns'] for c in cases),
              'max RSS MiB:',round(max(c['rss_mib'] for c in cases),1))
