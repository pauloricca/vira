import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'vendor/teia-hosted/dist';
const manifest = JSON.parse(await readFile(`${root}/compatibility.json`, 'utf8'));
for (const artifact of manifest.artifacts) {
  const bytes = await readFile(`${root}/${artifact.path}`);
  if (bytes.byteLength !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error(`Teia snapshot checksum mismatch: ${artifact.path}`);
  if (artifact.path.startsWith('native/teia-kernel/')) {
    const copied = await readFile(`vendor/teia-kernel/${artifact.path.slice('native/teia-kernel/'.length)}`);
    if (!bytes.equals(copied)) throw new Error(`Native Teia source differs: ${artifact.path}`);
  }
}
console.log(`Verified Teia hosted artifacts + native source: ${manifest.sourceCommit}, dirty snapshot=${manifest.sourceDirty}`);
const receipt = JSON.parse(await readFile('vendor/teia-review/hosted-artifact-hashes.json', 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha(await readFile(`${root}/compatibility.json`)) !== receipt.hashes['hosted/dist/compatibility.json']) throw new Error('Teia handover receipt does not match imported artifacts');
if (sha(await readFile('vendor/teia-review/hosted-native-tests.rs')) !== receipt.hashes['rust/teia-kernel/tests/hosted.rs']) throw new Error('Teia native conformance test differs from receipt');
console.log('Verified bridge-v2 receipt and archived native conformance harness');
