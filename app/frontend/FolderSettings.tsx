import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
type Locations = { music: string; patches: string };
type Settings = { selected: Locations; active: Locations; restartRequired: boolean };
export function FolderSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void invoke<Settings>('get_path_settings').then(value => { if (active) setSettings(value); }, error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, []);
  async function choose(kind: keyof Locations) {
    setBusy(true); setError('');
    try {
      const value = await invoke<Settings | null>('choose_library_folder', { kind });
      if (value) setSettings(value);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <section className="settings-card"><h3>Folders</h3>
    <p className="settings-hint">Folder changes apply when VIRA reopens. Existing files stay in their current folders.</p>
    {(['music', 'patches'] as const).map(kind => <div className="settings-row" key={kind}><div>
      <strong>{kind === 'music' ? 'Music folder' : 'Teia patch folder'}</strong>
      <p className="settings-path">{settings?.selected[kind] ?? 'Loading…'}</p>
      {settings && settings.selected[kind] !== settings.active[kind] && <p className="settings-path">Currently using: {settings.active[kind]}</p>}
    </div><button disabled={busy || !settings} aria-label={`Choose ${kind === 'music' ? 'music' : 'Teia patch'} folder`} onClick={() => void choose(kind)}>Choose…</button></div>)}
    {settings?.restartRequired && <p role="status">Folders saved. Quit and reopen VIRA to use them.</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </section>;
}
