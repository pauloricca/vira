import { useState } from 'react';

export function DeviceRefresh({ label, refresh }: { label: string; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" className="device-refresh" aria-label={label} title={label} disabled={busy} aria-busy={busy} onClick={async () => {
    setBusy(true);
    try { await refresh(); } finally { setBusy(false); }
  }}><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .4 5M16 3v4h-4" /></svg></button>;
}
