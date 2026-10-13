import json, pathlib, shutil
root=pathlib.Path('output')
rows=[]
dest=pathlib.Path('results/container');dest.mkdir(parents=True,exist_ok=True)
for p in sorted(root.glob('r*-snippets*-buffer*.json')):
    d=json.loads(p.read_text()); e=d['engine'];m=e['manifest']
    rows.append(dict(engine=m['engine'],snippets=len(m['voices'])-2,buffer=m['block_frames'],
                     wall_to_audio=d['wall_to_audio_ratio'],max_block_us=e['producer_blocks']['max_us'],
                     nominal_block_overruns=d['producer_blocks_over_nominal_device_deadline'],
                     peak_rss_bytes=d['resources']['peak_rss_bytes'],
                     native_process_seconds=sum(v['native_process']['mean_us']*v['native_process']['count']/1e6 for v in e['voices'])))
    shutil.copyfile(p,dest/p.name)
assert len(rows)==24
for p in ['source-inventory.json','boundary-probe.json']:
    shutil.copyfile(root/p,dest/p)
shutil.copyfile('manifests/synthetic-audition.json',dest/'audition-manifest.json')
shutil.copyfile(root/'auditions/settings-key.json',dest/'synthetic-settings-key.json')
(dest/'summary.json').write_text(json.dumps(rows,indent=2))
for engine in (2,3):
    for snippets in (0,4,8,16):
        r=[r for r in rows if r['engine']==engine and r['snippets']==snippets]
        print(engine,snippets,'wall/audio',round(min(x['wall_to_audio'] for x in r),3),round(max(x['wall_to_audio'] for x in r),3),'peak MiB',round(max(x['peak_rss_bytes'] for x in r)/2**20,1))
