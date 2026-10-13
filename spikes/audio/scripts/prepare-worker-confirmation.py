import json,pathlib
root=pathlib.Path('results/worker-scheduling')
base=json.loads((root/'manifests/six-stress.json').read_text())
long=json.loads(json.dumps(base));long['duration_frames']=60*48000
initial=[e for e in base['events'] if e['frame']==0]
long['events']=initial+[{**e,'frame':e['frame']+repeat*480000} for repeat in range(6) for e in base['events'] if e['frame']>0]
(root/'manifests/six-stress-60s.json').write_text(json.dumps(long,indent=2))
for block in [128,512]:
    m=json.loads(json.dumps(base));m['block_frames']=block
    # Keep queue capacity unchanged to isolate the device/producer block size.
    (root/'manifests'/f'six-stress-buffer{block}.json').write_text(json.dumps(m,indent=2))
