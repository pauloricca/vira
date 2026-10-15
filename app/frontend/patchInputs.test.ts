import { expect, test } from 'vitest';
import { type Patch } from '@pauloricca/teia-hosted';
import { prepare } from './teiaModel';
const source: Patch = { nodes: [
  { id: 'a', type: 'AudioInput', params: { gain: 1, level: 1 } },
  { id: 'b', type: 'AudioInput', params: { gain: 1, level: 1 } },
  { id: 'out', type: 'AudioOut', params: { level: 1 } },
], links: [
  { from: { node: 'a', port: 'left' }, to: { node: 'out', port: 'left' } },
  { from: { node: 'b', port: 'right' }, to: { node: 'out', port: 'right' } },
] };
test('the hosted compiler preserves an independent identity for every emitted Audio Input operation', () => {
  const compiled = prepare(source);
  const bindings = (compiled.program as unknown as { inputBindings: { nodeId: string; register: number }[] }).inputBindings;
  expect(bindings.map(b => b.nodeId).sort()).toEqual(['a', 'b']);
  expect(compiled.program.ops.filter(op => op.opcode === 11).map(op => op.out).sort()).toEqual(bindings.map(b => b.register).sort());
  expect(compiled.document.nodes.map(n => n.id)).toEqual(source.nodes.map(n => n.id));
});
test('group-scoped Audio Input identities match routing port identities', () => {
  const grouped: Patch = { nodes: [{ id: 'group', type: 'Group', params: {}, subpatch: source }], links: [] };
  // The group contains an AudioOut, so its inputs compile even without root links.
  const compiled = prepare(grouped);
  const bindings = (compiled.program as unknown as { inputBindings: { nodeId: string }[] }).inputBindings;
  expect(bindings.map(b => b.nodeId).sort()).toEqual(['group__a', 'group__b']);
});
