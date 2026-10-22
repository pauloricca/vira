import { vi } from 'vitest';

// Exercise the exact script evaluated by the native menu, not a second bridge.
export async function nativeHistory(redo = false) {
  const { readFileSync } = await vi.importActual<{readFileSync(path:string, encoding:'utf8'):string}>('node:fs');
  const source = readFileSync('src-tauri/src/history_menu.js', 'utf8');
  new Function(`${source}(${redo})`)();
}
