import { SettingsCard } from './SettingsSearch';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
type Locations = { music: string; musicFolders?: string[] | null; patches: string };
type Settings = { selected: Locations; active: Locations; restartRequired: boolean };
export const folderName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path;
const musicFolders = (locations: Locations) => locations.musicFolders ?? [locations.music];
export function FolderSettings({ onMusicChange }: { onMusicChange?: (folders: string[]) => Promise<void> }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState('music');
  useEffect(() => {
    let active = true;
    void invoke<Settings>('get_path_settings').then(value => { if (active) setSettings(value); }, error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, []);
  async function update(command: string, args: Record<string, string>) {
    setBusy(true); setError(''); setErrorKind(args.kind === 'patches' ? 'patches' : 'music');
    try {
      const value = await invoke<Settings | null>(command, args);
      if (value) {
        setSettings(value);
        if (args.kind !== 'patches') await onMusicChange?.(musicFolders(value.selected));
      }
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <><SettingsCard className="settings-card" aria-label="Music collections settings"><h3>Music collections</h3>
    <p className="settings-hint">Each music folder becomes a collection named after that folder. Changes apply immediately. Existing files stay in their current folders.</p>
    <div className="settings-row"><strong>Music folders</strong><button disabled={busy || !settings} onClick={() => void update('choose_library_folder', { kind: 'music' })}>Add music folder…</button></div>
    {settings ? musicFolders(settings.selected).map(path => <div className="settings-row" key={path}><div><strong>{folderName(path)}</strong><p className="settings-path">{path}</p></div><button disabled={busy} aria-label={`Remove music folder ${path}`} onClick={() => void update('remove_music_folder', { path })}>Remove</button></div>) : <p className="settings-path">Loading…</p>}
    {settings && musicFolders(settings.selected).length === 0 && <p className="settings-hint">No music folders. Add a folder to create a collection.</p>}
    {error && errorKind === 'music' && <p className="settings-error" role="alert">{error}</p>}
  </SettingsCard><SettingsCard className="settings-card" aria-label="Teia patch folder settings"><h3>Teia patches</h3>
    <p className="settings-hint">Choose where Teia patches are stored. Patch folder changes apply when VIRA reopens.</p>
    <div className="settings-row"><div><strong>Teia patch folder</strong><p className="settings-path">{settings?.selected.patches ?? 'Loading…'}</p>
    </div><button disabled={busy || !settings} aria-label="Choose Teia patch folder" onClick={() => void update('choose_library_folder', { kind: 'patches' })}>Choose…</button></div>
    {settings?.restartRequired && <p role="status">Patch folder saved. Quit and reopen VIRA to use it.</p>}
    {error && errorKind === 'patches' && <p className="settings-error" role="alert">{error}</p>}
  </SettingsCard></>;
}
