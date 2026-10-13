#!/usr/bin/env python3
"""Generate explicit, reproducible manifests. Runs only inside the dev container."""
import argparse, hashlib, json, pathlib, subprocess
p = argparse.ArgumentParser()
p.add_argument('--seconds', type=int, default=10)
p.add_argument('--sources', nargs='+', default=['media/tone.wav', 'media/texture.wav'])
p.add_argument('--run', action='store_true', help='Run unpaced container diagnostics, NOT real-time acceptance')
a = p.parse_args()
assert 1 <= a.seconds <= 3600
out = pathlib.Path('output'); out.mkdir(exist_ok=True)
manifest_dir = out / 'manifests'; manifest_dir.mkdir(exist_ok=True)
sources = a.sources
inventory = [{'path': s, 'sha256': hashlib.sha256(pathlib.Path(s).read_bytes()).hexdigest()} for s in sources]
(out / 'source-inventory.json').write_text(json.dumps(inventory, indent=2))
for engine in (2, 3):
    for snippets in (0, 4, 8, 16):
        for block in (128, 256, 512):
            voices, events = [], []
            for i in range(2 + snippets):
                pos = i * 173 % 8000
                voices.append(dict(source=i % len(sources), position=pos,
                                   speed=(0.8, 0.9, 1., 1.1, 1.25)[i % 5],
                                   pitch=(0., -3., 3.)[i % 3], gain=0.5/(2+snippets)))
                events.append(dict(frame=0, voice=i, action='start', position=pos))
                if i >= 2:
                    # Steady maximum overlap plus a separate short stop/start, seeks,
                    # rapid retriggers and ratio changes every two seconds.
                    for base in range(48000, a.seconds*48000-12000, 96000):
                        events += [dict(frame=base+17, voice=i, action='seek', position=12001+i*97),
                                   dict(frame=base+6001, voice=i, action='start', position=24001+i*97),
                                   dict(frame=base+7001, voice=i, action='start', position=24001+i*97),
                                   dict(frame=base+8001, voice=i, action='stop'),
                                   dict(frame=base+9001, voice=i, action='start', position=6001+i*97)]
                for base in range(72000, a.seconds*48000, 96000):
                    events.append(dict(frame=base,voice=i,action='ratios',speed=1.1,pitch=0. if i<2 else 3.))
            m = dict(sources=sources, engine=engine,duration_frames=a.seconds*48000,
                     block_frames=block,queue_frames=block*4,voices=voices,
                     events=sorted(events,key=lambda e:e['frame']))
            name=f'r{engine}-snippets{snippets}-buffer{block}'
            path=manifest_dir/f'{name}.json'; path.write_text(json.dumps(m,indent=2))
            if a.run:
                print(name, flush=True)
                subprocess.run(['target/release/vira-audio-spike','bench',str(path),str(out/f'{name}.json')],check=True)
