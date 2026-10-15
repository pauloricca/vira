import type { Plugin } from 'vite';
/** Annotate native audio-input operations without modifying Teia's frozen snapshot. */
export function teiaInputsPlugin(): Plugin {
  return { name: 'vira-teia-input-bindings', enforce: 'pre', transform(source, id) {
    if (!id.includes('teia-hosted') || !source.includes('function compileNodeOutput(')) return;
    const marker = '  if (node.type === "AudioInput") {\n    const output = nextRegister(context);';
    if (!source.includes(marker)) throw new Error('Teia AudioInput compiler changed; review VIRA input bindings');
    return source.replace(marker, `${marker}\n    context.inputBindings.push({ nodeId: node.runtimeSpread?.originalNodeId ?? node.id, register: output });`)
      .replace('    outputCache: ', '    inputBindings: [],\n    outputCache: ')
      .replaceAll('    monitorIds: context.monitorIds,', '    inputBindings: context.inputBindings,\n    monitorIds: context.monitorIds,');
  } };
}
