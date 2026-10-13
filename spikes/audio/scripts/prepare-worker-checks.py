"""Run in Docker. Preserve matching inputs and a balanced native experiment plan."""
import hashlib, json, pathlib, random
root=pathlib.Path('results/worker-scheduling')
(root/'manifests').mkdir(parents=True,exist_ok=True)
base=json.loads(pathlib.Path('output/manifests/r3-snippets4-buffer256.json').read_text())
for name in ['two-decks-steady','six-steady','six-stress']:
    m=json.loads(json.dumps(base))
    if name=='two-decks-steady':
        m['voices']=m['voices'][:2]
        m['events']=[e for e in m['events'] if e['frame']==0 and e['voice']<2]
    elif name=='six-steady':
        m['events']=[e for e in m['events'] if e['frame']==0]
    (root/'manifests'/f'{name}.json').write_text(json.dumps(m,indent=2))
plan=[]
for repeat in range(1,4):
    cases=[(scenario,mode) for scenario in ['two-decks-steady','six-steady','six-stress'] for mode in ['poll','signal','realtime']]
    random.Random(413+repeat).shuffle(cases)
    for scenario,mode in cases:
        plan.append(f'{root}/manifests/{scenario}.json {root}/{scenario}-{mode}-{repeat}.json {mode}')
(root/'plan.txt').write_text('\n'.join(plan)+'\n')
(root/'inputs.json').write_text(json.dumps([dict(path=p,sha256=hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()) for p in base['sources']],indent=2))
print(f'Prepared {len(plan)} ten-second native runs; original 1024-frame queue remains unchanged.')
