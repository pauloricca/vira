import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SettingsCard } from './SettingsSearch';
import { useVsts } from './vstModel';
export function VstSettings({ active = true }: { active?: boolean }) {
  const catalog = useVsts(active);
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!active) return; void invoke<string[]>('vst_paths').then(value => {if (Array.isArray(value)) setPaths(value);}).catch(e => setError(String(e))); }, [active]);
  async function save(next: string[]) {
    setBusy(true); setError('');
    try { await invoke('vst_save_paths', { paths: next }); setPaths(next); setPath(''); }
    catch (e) {setError(String(e));} finally {setBusy(false);}
  }
  return <SettingsCard className="settings-card" aria-label="VST plugins settings"><h3>Plugins</h3>
    <p className="settings-hint">VST3 and CLAP folders are scanned recursively when VIRA starts. Standard macOS folders are always included; custom paths add to them. AUv2 plugins are discovered from the system registry. Add absolute folder paths, including folders on external drives. Unchanged plugins use a persistent cache. Failed scans are quarantined until their files change or you retry them. Changes apply on the next startup or with Scan now.</p>
    {paths.map(folder => <div className="settings-row" key={folder}><p className="settings-path">{folder}</p><button disabled={busy} aria-label={`Remove VST folder ${folder}`} onClick={() => void save(paths.filter(p => p !== folder))}>Remove</button></div>)}
    <form className="settings-row" onSubmit={e => {e.preventDefault(); const value = path.trim(); if (!value.startsWith('/')) {setError('Enter an absolute folder path starting with /.'); return;} if (paths.includes(value)) {setError('This folder is already added.'); return;} void save([...paths, value]);}}><label>VST scan folder <input aria-label="VST scan folder" placeholder="/Library/Audio/Plug-Ins/VST3" value={path} onChange={e => setPath(e.target.value)} /></label><button disabled={busy || !path.trim()}>Add folder</button></form>
    <div className="settings-row"><span role="status">{catalog.scanning ? 'Scanning plugins…' : `${catalog.plugins.length} plugins found`}</span><button disabled={busy || catalog.scanning} onClick={() => {setError('');void invoke('vst_rescan').catch(e => setError(String(e)));}}>Scan now</button><button disabled={busy || catalog.scanning} onClick={()=>{void invoke('vst_rescan',{retry:true}).catch(e=>setError(String(e)));}}>Retry failed scans</button></div>
    <p className="settings-hint">Declared categories and audio/event buses identify effects and instruments. A plugin can appear in both routing categories. Double-click an instance to open its editor. Route notes to the same instance in Patterns.</p>
    {error && <p role="alert" className="settings-error">{error}</p>}
    {!!catalog.errors.length && <details><summary>{catalog.errors.length} scan issues</summary>{catalog.errors.map((e,i) => <p className="settings-error" key={i}>{e}</p>)}</details>}
  </SettingsCard>;
}
