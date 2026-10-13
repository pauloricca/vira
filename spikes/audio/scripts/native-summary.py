import json, pathlib
rows=[]
for f in sorted(pathlib.Path('results').glob('native-r*.json')):
    d=json.loads(f.read_text()); e=d['engine'];c=d['callback']
    rows.append(dict(file=f.name,completed=d['completed'],requested_buffer=d['requested_buffer_frames'],
                     observed_callback_frames=[c['actual_callback_frames_min'],c['actual_callback_frames_max']],
                     queue_frames=d['queue_capacity_frames'],starved_frames=c['starved_frames'],
                     callback_deadline_misses=c['deadline_misses'],device_errors=c['device_errors'],
                     callback_max_us=c['execution']['max_us'],producer_max_us=e['producer_blocks']['max_us'],
                     peak_cpu_percent=e['peak_process_cpu_percent_one_second_windows'],peak_rss_bytes=d['resources']['peak_rss_bytes']))
pathlib.Path('results/native-summary.json').write_text(json.dumps(rows,indent=2))
print(json.dumps(rows,indent=2))
