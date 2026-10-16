// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BRIDGE_VERSION, type HostedSession, type HostCommand } from '@pauloricca/teia-hosted';
import { gainPatch } from './teiaModel';
import { emptyPatch } from './Patches';
import { Editor } from './TeiaEditor';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), destroy: vi.fn(), onCloseRequested: vi.fn(), session: null as HostedSession | null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ destroy: mocks.destroy, onCloseRequested: mocks.onCloseRequested }) }));
vi.mock('@pauloricca/teia-hosted/editor', () => ({ HostedNodeEditor: ({ session }: { session: HostedSession }) => { mocks.session = session; return <div>Patch canvas</div>; } }));
const editedPatch = () => ({ ...structuredClone(gainPatch), name: 'Edited gain' });
let initialDraft = structuredClone(gainPatch);
let failClose = false;
beforeEach(() => {
  initialDraft = structuredClone(gainPatch); failClose = false;
  mocks.destroy.mockResolvedValue(undefined);
  mocks.onCloseRequested.mockResolvedValue(() => {});
  mocks.invoke.mockImplementation(async (command: string, args?: { command: HostCommand }) => {
    if (command === 'teia_editor_init') return { bridgeVersion: BRIDGE_VERSION, sessionId: 'editor-test', document: gainPatch, draft: initialDraft, generation: '1', filename: 'Gain.json' };
    if (command === 'teia_feedback') return null;
    const request = args!.command;
    if (request.type === 'capture save') return { ...request, status: 'captured', capturedDocument: request.document };
    return { ...request, status: request.type === 'save' ? 'saved' : request.type === 'close' ? failClose ? 'failed' : 'closed' : 'installed' };
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.session = null; });
async function openEditor() {
  render(<Editor />);
  await screen.findByText('Patch canvas');
  await waitFor(() => expect(mocks.onCloseRequested).toHaveBeenCalled());
}
const closeButton = () => screen.getByRole('button', { name: 'Close editor' });

test('a newly created connected patch closes immediately without a save prompt', async () => {
  const initial = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, ...args: unknown[]) => command === 'teia_editor_init'
    ? { bridgeVersion: BRIDGE_VERSION, sessionId: 'editor-test', document: emptyPatch('New patch'), draft: emptyPatch('New patch'), generation: '1', filename: 'New patch.json' }
    : initial(command, ...args));
  await openEditor();
  fireEvent.click(closeButton());
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a host roundtrip with reordered JSON properties does not create unsaved changes', async () => {
  // Rust's JSON map order differs from the editor's parsed document order.
  initialDraft = JSON.parse(JSON.stringify(gainPatch, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
  await openEditor();
  expect(mocks.session!.getSnapshot().dirty).toBe(false);
  fireEvent.click(closeButton());
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('discard retries installing the saved document after an earlier apply was cancelled', async () => {
  await openEditor();
  await act(async () => { await mocks.session!.edit(editedPatch()); });
  fireEvent.click(closeButton());
  const original = mocks.invoke.getMockImplementation()!;
  let cancel = true;
  mocks.invoke.mockImplementation(async (command: string, args?: { command: HostCommand }) => {
    if (command === 'teia_request' && args?.command.type === 'apply' && cancel) {
      cancel = false;
      return { ...args.command, status: 'cancelled' };
    }
    return original(command, args);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await screen.findByRole('alert');
  expect(mocks.destroy).not.toHaveBeenCalled();
  expect(mocks.session!.getSnapshot().installedRevision).not.toBe(mocks.session!.getSnapshot().revision);
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(mocks.session!.getSnapshot().installedRevision).toBe(mocks.session!.getSnapshot().revision);
  expect(mocks.invoke.mock.calls.some(([command, args]) => command === 'teia_request' && args.command.type === 'save')).toBe(false);
});

test('discard restores an edited patch and closes without saving the changes', async () => {
  await openEditor();
  const saved = mocks.session!.getDocument();
  await act(async () => { await mocks.session!.edit(editedPatch()); });
  fireEvent.click(closeButton());
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(mocks.session!.getDocument()).toEqual(saved);
  expect(mocks.session!.getSnapshot().dirty).toBe(false);
  expect(mocks.session!.getSnapshot().installedRevision).toBe(mocks.session!.getSnapshot().revision);
  expect(mocks.invoke.mock.calls.some(([command, args]) => command === 'teia_request' && args.command.type === 'save')).toBe(false);
});

test('an unchanged saved patch closes directly through the header', async () => {
  await openEditor();
  fireEvent.click(closeButton());
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.invoke.mock.calls.some(([command, args]) => command === 'teia_request' && args.command.type === 'save')).toBe(false);
});

test('the native window close uses the same unchanged-patch policy', async () => {
  await openEditor();
  const event = { preventDefault: vi.fn() };
  act(() => mocks.onCloseRequested.mock.calls[0][0](event));
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a restored unsaved draft still asks how to close', async () => {
  initialDraft = editedPatch();
  await openEditor();
  fireEvent.click(closeButton());
  expect(screen.getByRole('dialog', { name: 'Close editor' })).toBeTruthy();
  expect(mocks.destroy).not.toHaveBeenCalled();
});

test('editing after saving shows the confirmation', async () => {
  await openEditor();
  await act(async () => { await mocks.session!.edit(editedPatch()); });
  fireEvent.click(closeButton());
  expect(screen.getByRole('dialog', { name: 'Close editor' })).toBeTruthy();
  expect(mocks.destroy).not.toHaveBeenCalled();
});

test('undoing to the saved document closes without prompting despite a newer revision', async () => {
  await openEditor();
  const savedDocument = mocks.session!.getDocument();
  await act(async () => { await mocks.session!.edit(editedPatch()); await mocks.session!.edit(savedDocument); });
  fireEvent.click(closeButton());
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('an acknowledged save allows immediate close', async () => {
  await openEditor();
  await act(async () => { await mocks.session!.edit(editedPatch()); expect(await mocks.session!.save()).toBe(true); });
  fireEvent.click(closeButton());
  await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a failed close keeps the window open and exposes the error in the dialog', async () => {
  await openEditor(); failClose = true;
  fireEvent.click(closeButton());
  await screen.findByRole('dialog', { name: 'Close editor' });
  expect(screen.getByRole('alert').textContent).toContain('changed while closing');
  expect(mocks.destroy).not.toHaveBeenCalled();
});
