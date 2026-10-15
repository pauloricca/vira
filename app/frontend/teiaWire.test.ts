import {expect,test} from 'vitest';
import type {HostCommand,HostReply} from '@pauloricca/teia-hosted';
import {encodeTeiaCommand,decodeTeiaReply} from './teiaWire';
test('JSON-only Tauri snapshots round trip as the typed Teia contract',()=>{
  const command:HostCommand={type:'restore buffer',version:1,nodeId:'buffer',requestId:'r',sessionId:'s',generation:'7',revision:2,snapshot:{samples:new Float32Array([0.25,-0.5]),sampleRate:48000}};
  expect(JSON.parse(JSON.stringify(encodeTeiaCommand(command))).snapshot.samples).toEqual([0.25,-0.5]);
  const reply=decodeTeiaReply(JSON.parse(JSON.stringify({...command,status:'captured',bufferSnapshot:{samples:[0.25,-0.5],sampleRate:48000}})) as HostReply);
  expect(reply.bufferSnapshot?.samples).toBeInstanceOf(Float32Array);expect(Array.from(reply.bufferSnapshot!.samples)).toEqual([0.25,-0.5]);
});
