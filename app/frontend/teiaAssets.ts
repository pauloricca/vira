import { invoke } from '@tauri-apps/api/core';
import type { EditorAssetAdapter } from '@pauloricca/teia-hosted';
function selectFile(kind: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = kind === 'image' ? 'image/*' : 'audio/*';
    input.style.display = 'none'; document.body.append(input);
    const finish = (file: File | null) => { input.remove(); resolve(file); };
    input.onchange = () => finish(input.files?.[0] ?? null);
    input.oncancel = () => finish(null);
    input.click();
  });
}
export const assets: EditorAssetAdapter = {
  selectMedia: async ({ kind }) => {
    const file = await selectFile(kind);
    if (!file) return null;
    if (file.size > 64 * 1024 * 1024) throw new Error('Media exceeds 64 MiB');
    let bytes: Uint8Array, width = 0, height = 0;
    if (kind === 'image') {
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        width = Math.max(1, Math.round(bitmap.width * scale)); height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d'); if (!context) throw new Error('Image decoding is unavailable');
        context.drawImage(bitmap, 0, 0, width, height);
        bytes = new Uint8Array(context.getImageData(0, 0, width, height).data);
      } finally { bitmap.close(); }
    } else bytes = new Uint8Array(await file.arrayBuffer());
    return invoke('teia_import_media', { kind, name: file.name, bytes: Array.from(bytes), width, height });
  },
  waveform: async (reference, signal) => {
    if (signal.aborted) return null;
    const data = await invoke<{ duration: number; bins: { min: number; max: number }[] }>('teia_media_preview', { reference });
    return signal.aborted ? null : data;
  },
  imagePreview: async (reference, signal) => {
    if (signal.aborted) return null;
    const data = await invoke<{ width: number; height: number; rgba: number[] }>('teia_media_preview', { reference });
    if (signal.aborted) return null;
    const canvas = document.createElement('canvas'); canvas.width = data.width; canvas.height = data.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(data.rgba), data.width, data.height), 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  },
};
