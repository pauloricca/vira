"""Run in Docker. Reuse spike 1 inputs, with a short matched host comparison."""
import json
from pathlib import Path
out = Path('results/host')
(out / 'manifests').mkdir(parents=True, exist_ok=True)
for kind in ('six-steady', 'six-stress'):
    m = json.loads(Path(f'results/worker-scheduling/manifests/{kind}.json').read_text())
    (out / 'manifests' / f'{kind}.json').write_text(json.dumps(m, indent=2) + '\n')
