import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { BRIDGE_VERSION, HostedSession, NATIVE_PROFILE, readDocument, type HostBridge, type HostCommand, type HostEvent, type HostReply, type Patch } from '@pauloricca/teia-hosted';
import { HostedNodeEditor } from '@pauloricca/teia-hosted/editor';
import '@pauloricca/teia-hosted/flow.css';
import '@pauloricca/teia-hosted/themes.css';
import '@pauloricca/teia-hosted/styles.css';
import './teia-editor.css';
import './text-inputs.css';
import { encodeTeiaCommand, decodeTeiaReply } from './teiaWire';
import { assets } from './teiaAssets';
import { hostNodeTypes } from './teiaModel';

type Initial = { bridgeVersion: number; sessionId: string; document: Patch; draft: Patch; generation: string; filename: string; needsApply?: boolean };
// Match HostedSession's saved baseline when reading documents back from JSON.
const editorDocument = (document: Patch): Patch => {
  const read = readDocument(document);
  return read.patch && !read.diagnostics.some(d => d.severity === 'error' || d.code === 'discarded-content') ? read.patch : document;
};
export function Editor() {
  const [session, setSession] = useState<HostedSession | null>(null);
  const current = useRef<HostedSession | null>(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveAs, setSaveAs] = useState<{ name: string; resolve: (name: string | null) => void } | null>(null);
  const savingDialog = useRef<typeof saveAs>(null);
  const modal = useRef(false);
  const requestCloseRef = useRef<() => void>(() => {});
  const closingRequest = useRef(false);
  modal.current = closing || saveAs !== null;
  savingDialog.current = saveAs;
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>, unlisten: (() => void) | undefined;
    const listeners = new Set<(event: HostEvent) => void>();
    let scheduled: { command: HostCommand; resolve: (reply: HostReply) => void; timer: ReturnType<typeof setTimeout> } | null = null;
    const guardModal = (event: KeyboardEvent) => { if (modal.current) { event.stopImmediatePropagation(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') event.preventDefault(); } };
    window.addEventListener('keydown', guardModal, true);
    let controller: HostedSession | null = null;
    let gestures: Promise<unknown> = Promise.resolve();
    const send = async (command: HostCommand, saveName: string | null = null): Promise<HostReply> => {
      const wire = encodeTeiaCommand(command);
      const reply = await invoke<HostReply>('teia_request', {command: wire, saveName});
      if (reply.status === 'failed' && ['feedback', 'capture buffer', 'restore buffer', 'buffer'].includes(command.type)) setError(reply.diagnostics?.map(d => d.message).join('\n') ?? 'Scope subscription failed');
      if (reply.status === 'failed' && command.type === 'capture save') throw new Error(reply.diagnostics?.map(d => d.message).join('\n') || 'Buffer Save capture failed');
      return decodeTeiaReply(reply);
    };
    const initialize = async () => {
      const initial = await invoke<Initial>('teia_editor_init');
      if (initial.bridgeVersion !== BRIDGE_VERSION) throw new Error('Teia bridge version mismatch');
      if (disposed) return;
      setFilename(initial.filename);
      const bridge: HostBridge = {
        assets,
        subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        request: async (command: HostCommand) => {
          if (command.type === 'gesture' || command.type === 'release gestures') {
            const next = gestures.then(() => send(command)); gestures = next.catch(() => undefined); return next;
          }
          if (command.type === 'revision' && scheduled) {
            clearTimeout(scheduled.timer); scheduled.resolve({ ...scheduled.command, status: 'cancelled' }); scheduled = null;
          }
          if (command.type === 'apply' && command.change.kind === 'prepare') return new Promise<HostReply>(resolve => {
            if (scheduled) { clearTimeout(scheduled.timer); scheduled.resolve({ ...scheduled.command, status: 'cancelled' }); }
            const entry = { command, resolve, timer: setTimeout(() => {
              if (scheduled === entry) scheduled = null;
              void send(command).then(resolve, error => resolve({ ...command, status: 'failed', diagnostics: [{ severity: 'error', code: 'vira-ipc', message: String(error) }] }));
            }, 100) };
            scheduled = entry;
          });
          let saveName: string | null = null;
          if (command.type === 'save' && command.saveAs) {
            if (savingDialog.current) return { ...command, status: 'cancelled' };
            saveName = await new Promise<string | null>(resolve => { const dialog = { name: initial.filename.replace(/\.json$/, '') + ' copy.json', resolve }; savingDialog.current = dialog; setSaveAs(dialog); });
            if (saveName === null) return { ...command, status: 'cancelled' };
          }
          const reply = await send(command, saveName);
          if (command.type === 'save' && reply.status === 'saved') { const next = await invoke<Initial>('teia_editor_init'); setFilename(next.filename); }
          return reply;
        },
      };
      controller = new HostedSession(initial.sessionId, initial.document, {
        save: true, saveAs: true, bridgeVersion: 2, gestures: 1, bufferCapture: 1, bufferMutation: true, profile: NATIVE_PROFILE, transport: true, feedback: ['parameters', 'meters', 'scopes', 'playheads', 'buffers'], maxFeedbackHz: 20,
        nodeTypes: hostNodeTypes,
      }, bridge, initial.generation === '0' ? null : initial.generation);
      current.current = controller;
      if (initial.needsApply || JSON.stringify(initial.document) !== JSON.stringify(initial.draft)) await controller.edit(editorDocument(initial.draft), true);
      if (disposed) { controller.dispose(); return; }
      setSession(controller);
      const poll = async () => {
        try { const feedback = await invoke<HostEvent | null>('teia_feedback'); if (!disposed && feedback) {
            const snapshot = controller?.getSnapshot();
            if (snapshot && 'generation' in feedback && feedback.generation !== snapshot.generation && !snapshot.applying) await controller?.resync();
            else for (const listener of listeners) listener(feedback);
          } }
        catch (error) { if (!disposed) setError(String(error)); }
        if (!disposed) timer = setTimeout(poll, 50);
      };
      void poll();
      const stopListening = await getCurrentWindow().onCloseRequested(event => { event.preventDefault(); requestCloseRef.current(); });
      if (disposed) stopListening(); else unlisten = stopListening;
    };
    void initialize().catch(e => setError(String(e)));
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('keydown', guardModal, true); if (scheduled) { clearTimeout(scheduled.timer); scheduled.resolve({ ...scheduled.command, status: 'cancelled' }); } unlisten?.(); controller?.dispose(); savingDialog.current?.resolve(null); current.current = null; };
  }, []);
  const close = async (choice: 'keep' | 'save' | 'discard') => {
    if (!session) { await getCurrentWindow().destroy(); return; }
    setBusy(true); setError('');
    try {
      if (choice === 'save' && !await session.save()) throw new Error(session.getSnapshot().saveDiagnostics?.map(d => d.message).join('\n') || 'Save was not acknowledged');
      if (choice === 'discard') {
        const initial = await invoke<Initial>('teia_editor_init');
        // Discard must install the saved graph even when it is already the
        // working document: its earlier apply may still be pending or cancelled.
        await session.edit(editorDocument(initial.document), true);
        const snapshot = session.getSnapshot();
        if (snapshot.installedRevision !== snapshot.revision) throw new Error(snapshot.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('\n') || 'Saved document could not be restored to audio; keep the draft or cancel');
      }
      if (await session.close()) await getCurrentWindow().destroy();
      else throw new Error('The document changed while closing; review the latest edit');
    } catch (error) { setError(String(error)); setClosing(true); }
    finally { setBusy(false); }
  };
  const requestClose = async () => {
    if (modal.current || closingRequest.current) return;
    // Compare against the session's acknowledged saved document, including undo
    // and restored drafts, rather than treating every revision as unsaved.
    if (!current.current || current.current.getSnapshot().dirty) { setClosing(true); return; }
    closingRequest.current = true;
    try { await close('keep'); }
    finally { closingRequest.current = false; }
  };
  requestCloseRef.current = () => { void requestClose(); };
  return <div className="vira-teia-shell">
    <header className="vira-teia-header" inert={closing || saveAs !== null}>
      <div className="vira-teia-document"><strong title={filename}>{filename || 'Patch editor'}</strong><span>Save writes the patch and preserves captured buffers.</span></div>
      <span className="vira-teia-live">Live in routing</span>
      <button className="vira-teia-button" disabled={busy} onClick={() => void requestClose()}>Close editor</button>
    </header>
    {error && !closing && <p className="vira-teia-error" role="alert">{error}</p>}
    <div className="vira-teia-canvas" inert={closing || saveAs !== null}>{session ? <HostedNodeEditor session={session} theme="vira" /> : <p>Connecting to Vira…</p>}</div>
    {closing && <div className="vira-teia-overlay"><section className="vira-teia-modal" role="dialog" aria-modal="true" aria-labelledby="close-editor-title" aria-describedby="close-editor-description">
      <div className="vira-teia-modal-body"><h2 id="close-editor-title">Close editor</h2><p id="close-editor-description">Save your changes before closing, or keep a draft to continue later.</p>
        <p className="vira-teia-modal-note">Keeping a draft leaves the live effect running. Discarding changes restores the saved patch.</p>
        {error && <p className="vira-teia-error" role="alert">{error}</p>}
      </div>
      <div className="vira-teia-modal-actions">
        <div className="vira-teia-action-group"><button className="vira-teia-button" disabled={busy} onClick={() => void close('keep')}>Keep draft</button><button className="vira-teia-button vira-teia-button-discard" disabled={busy} onClick={() => void close('discard')}>Discard changes</button></div>
        <div className="vira-teia-action-group"><button className="vira-teia-button" disabled={busy} onClick={() => setClosing(false)}>Cancel</button><button className="vira-teia-button vira-teia-button-primary" disabled={busy} onClick={() => void close('save')}>Save and close</button></div>
      </div>
    </section></div>}
    {saveAs && <div className="vira-teia-overlay"><section className="vira-teia-modal vira-teia-save-as" role="dialog" aria-modal="true" aria-labelledby="save-patch-title">
      <div className="vira-teia-modal-body"><h2 id="save-patch-title">Save patch as</h2><label className="vira-teia-filename">Patch filename<input autoFocus value={saveAs.name} onChange={e => setSaveAs(current => current ? { ...current, name: e.target.value } : null)} /></label></div>
      <div className="vira-teia-modal-actions"><div className="vira-teia-action-group"><button className="vira-teia-button" onClick={() => { saveAs.resolve(null); setSaveAs(null); }}>Cancel</button><button className="vira-teia-button vira-teia-button-primary" disabled={!saveAs.name.endsWith('.json') || /[/\\]/.test(saveAs.name)} onClick={() => { saveAs.resolve(saveAs.name); setSaveAs(null); }}>Save</button></div></div>
    </section></div>}
  </div>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<Editor />);
