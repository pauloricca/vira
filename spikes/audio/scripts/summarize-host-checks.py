"""Run in Docker after native runs. Never count errors/missing cases as passes."""
import json
from pathlib import Path
root = Path('results/host')
rows = []
expected = [f'steady-{mode}-{i}' for mode in ('headless','idle','busy') for i in (1,2,3)]
expected += [f'stress-{mode}' for mode in ('headless','idle','busy')] + ['reopen-busy']
for name in expected:
    path = root / f'{name}.json'
    if not path.exists():
        rows.append({'case': name, 'passed': False, 'error': 'missing report'})
        continue
    r = json.loads(path.read_text())
    attempts = r.get('attempts', [{'playback': r}])
    plays = [a['playback'] for a in attempts]
    hosted = r.get('mode') == 'tauri_in_process'
    clean = all(p.get('completed') and p.get('callback', {}).get('starved_frames') == 0
        and p.get('callback', {}).get('deadline_misses') == 0
        and p.get('callback', {}).get('device_errors') == 0 for p in plays)
    ui_alive = not hosted or r.get('ui_animation_frames', 0) > 10
    background_ok = not r.get('busy') or (len(r.get('background', [])) == 2
        and all(w.get('decode_waveform_passes', 0) > 0 for w in r['background']))
    if name == 'reopen-busy':
        clean = len(plays) == 2 and plays[0].get('stop_reason') == 'requested_stop' and plays[-1].get('completed') is True
    rows.append({'case':name, 'passed': bool(clean and ui_alive and background_ok),
        'attempts': len(plays), 'starved_frames': sum(p.get('callback', {}).get('starved_frames', 0) for p in plays),
        'callback_misses': sum(p.get('callback', {}).get('deadline_misses', 0) for p in plays),
        'device_errors': sum(p.get('callback', {}).get('device_errors', 0) for p in plays),
        'max_callback_interval_ms': max(p.get('max_callback_interval_us', 0)/1000 for p in plays),
        'ui_frames': r.get('ui_animation_frames'), 'background': r.get('background'),
        'stop_reasons': [p.get('stop_reason', p.get('error')) for p in plays]})
(root/'summary.json').write_text(json.dumps({'cases':rows,
    'pending':['physical audio-device switch/unplug', 'sample-rate change', 'actual sleep/wake', 'long soak'],
    'limits':'Synthetic 10-second runs; restart probe is controlled cancellation, not physical device recovery. Callback intervals are not loopback or hardware xrun measurements.'},indent=2)+'\n')
for r in rows:
    print(r['case'], 'PASS' if r['passed'] else 'FAIL', r.get('starved_frames'), r.get('stop_reasons', r.get('error')))
