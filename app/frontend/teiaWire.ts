import type { HostCommand, HostReply } from '@pauloricca/teia-hosted';
/** Tauri JSON carries plain sample arrays; Teia's presentation API uses Float32Array. */
export function encodeTeiaCommand(command: HostCommand): unknown {
  return command.type === 'restore buffer' ? {...command, snapshot: {...command.snapshot, samples: Array.from(command.snapshot.samples)}} : command;
}
export function decodeTeiaReply(reply: HostReply): HostReply {
  if (reply.bufferSnapshot) reply.bufferSnapshot.samples = new Float32Array(reply.bufferSnapshot.samples);
  return reply;
}
