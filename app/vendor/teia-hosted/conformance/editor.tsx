// Browser-only functional harness: build it, then run only with authorization.
// It deliberately traps standalone runtime, device, server and global-storage use.
import { createRoot } from 'react-dom/client';

import { HostedSession, type HostBridge, type HostReply } from '../../editor/src/hosted';
const violations: string[] = [];
const forbidden = (name: string) => { violations.push(name); throw new Error(`Hosted isolation violation: ${name}`); };
Object.defineProperty(window, 'AudioContext', { configurable: true, value: class { constructor() { forbidden('AudioContext'); } } });
Object.defineProperty(window, 'OfflineAudioContext', { configurable: true, value: class { constructor() { forbidden('OfflineAudioContext'); } } });
Object.defineProperty(window, 'webkitOfflineAudioContext', { configurable: true, value: class { constructor() { forbidden('webkitOfflineAudioContext'); } } });
Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: class { constructor() { forbidden('webkitAudioContext'); } } });
Object.defineProperty(window, 'localStorage', { configurable: true, get: () => forbidden('global localStorage') });
Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => forbidden('global sessionStorage') });
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => forbidden('media devices') });
Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: () => forbidden('MIDI access') });
window.fetch = () => { forbidden('fetch'); return Promise.reject(); };
const { HostedNodeEditor } = await import('../../editor/src/hosted/HostedNodeEditor');
const commands: unknown[] = [];
const bridge: HostBridge = { subscribe: () => () => undefined, request: async command => {
  commands.push(command);
  const reply: HostReply = { ...command, status: command.type === 'save' ? 'saved' : command.type === 'apply' && command.prepared ? 'installed' : 'cancelled', generation: 'harness-instance' };
  return reply;
} };
const session = new HostedSession('browser-conformance', { name: 'bridge-only editor', nodes: [{ id: 'sample', type: 'SamplePlayer', params: {}, sample: { name: 'host sample', url: '/must-not-fetch.mp4' } }, { id: 'image', type: 'Image', params: {}, image: { name: 'host image', url: '/must-not-fetch.png' } }], links: [] }, { save: true, nodeTypes: ['Constant', 'AudioInput', 'AudioOut', 'Params', 'SineOsc'] }, bridge, 'harness-instance');
createRoot(document.getElementById('root')!).render(<HostedNodeEditor session={session} />);
Object.assign(window, { hostedConformance: { session, commands, violations } });
