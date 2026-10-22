import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function FolderLink({ path }: { path: string }) {
  const [error, setError] = useState('');
  async function open() {
    setError('');
    try { await invoke('open_settings_folder', { path }); }
    catch (error) { setError(String(error)); }
  }
  return <div><button type="button" className="settings-path settings-folder-link" title="Open in Finder" aria-label={`Open ${path} in Finder`} onClick={() => void open()}>{path}</button>
    {error && <p className="settings-error" role="alert">{error}</p>}
  </div>;
}
