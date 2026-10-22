#!/usr/bin/env python3
"""Back up VIRA's saved user data, excluding source music and regenerable caches."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime
import zipfile


def main():
    project = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=project / 'backups')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    home = Path.home()
    support = home / 'Library/Application Support/uk.ricca.vira'
    settings_path = support / 'paths.json'
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
    roots = [support, home / 'Library/WebKit/uk.ricca.vira',
             home / 'Library/Preferences/uk.ricca.vira.plist',
             Path(settings.get('patches', support / 'patches')),
             project / 'patches']
    if os.environ.get('VIRA_TEIA_PATCH_DIR'):
        roots.append(Path(os.environ['VIRA_TEIA_PATCH_DIR']))
    generated = project / 'app/generated'
    # Analysis records also retain user approvals. Preserve them alongside grids,
    # metadata and legacy indexes needed to reconnect filename-keyed edits.
    for base in [generated, *sorted((generated / 'libraries').glob('*'))]:
        roots.extend(base / name for name in
                     ('timing', 'analysis', 'metadata.json', 'library-v1.json', 'library-v2.json'))
    roots.append(generated / 'content')
    excluded_dirs = {'cache', 'Caches', 'CacheStorage', 'NetworkCache',
                     'GPUCache', 'ShaderCache', '__pycache__', '.git'}
    missing, entries, seen = [], [], set()

    def collect(path):
        if path.is_symlink():
            # Archive linked media as real data; reject cyclic directory links.
            path = path.resolve(strict=True)
        path = path.absolute()
        if path == output or output in path.parents:
            return
        if path in seen:
            return
        seen.add(path)
        if path.is_dir():
            for child in sorted(path.iterdir()):
                if child.name not in excluded_dirs:
                    collect(child)
        elif path.is_file():
            if (path.name == '.DS_Store' or path.name.startswith('._')
                    or path.suffix in ('.log', '.tmp')
                    or path.name.startswith('plugin-cache-')
                    or path.name == 'collections.compose.yaml'):
                return
            entries.append(path)
        else:
            raise RuntimeError(f'Unsupported file: {path}')

    for root in roots:
        if root.exists():
            collect(root)
        else:
            missing.append(str(root))
    stamp = datetime.now().astimezone().strftime('%Y-%m-%d_%H-%M-%S_%f%z')
    target = output / f'vira-user-data_{stamp}.zip'
    manifest = {'created': datetime.now().astimezone().isoformat(),
                'roots': [str(p) for p in roots], 'missing_roots': missing,
                'music_folders_not_copied': settings.get('musicFolders', [settings.get('music', str(project / 'music'))]),
                'restore': 'Quit VIRA. Restore files/ paths to their original absolute locations (prefix /). Back up existing data first. Source music is excluded; patch assets are included. Restart VIRA to regenerate caches.',
                'consistency': 'For a fully consistent snapshot, quit VIRA before running this script.',
                'files': []}
    fd, temporary = tempfile.mkstemp(prefix='.vira-backup-', dir=output)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
            for path in entries:
                name = 'files/' + path.as_posix().lstrip('/')
                before = path.stat()
                digest = hashlib.sha256()
                with path.open('rb') as source, archive.open(name, 'w', force_zip64=True) as destination:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
                        destination.write(chunk)
                after = path.stat()
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise RuntimeError(f'File changed during backup; quit VIRA and retry: {path}')
                manifest['files'].append({'source': str(path), 'entry': name,
                                          'bytes': before.st_size, 'sha256': digest.hexdigest()})
            archive.writestr('manifest.json', json.dumps(manifest, indent=2))
        with zipfile.ZipFile(temporary) as archive:
            bad = archive.testzip()
            if bad:
                raise RuntimeError(f'ZIP verification failed: {bad}')
        os.chmod(temporary, 0o600)
        os.rename(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f'{target}\n{len(entries)} files; {target.stat().st_size:,} bytes; ZIP verified')
    if missing:
        print('Unavailable/unused locations recorded in manifest:\n' + '\n'.join(missing))


if __name__ == '__main__':
    main()
