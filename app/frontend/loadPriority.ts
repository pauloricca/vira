// Count requests, including overlapping replacements on the same deck.
let loads = 0;
let waiting: (() => void)[] = [];

export function beginDeckLoad() {
  loads++;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    if (--loads === 0) {
      const ready = waiting; waiting = [];
      ready.forEach(resolve => resolve());
    }
  };
}

export async function waitForDeckLoads() {
  while (loads) await new Promise<void>(resolve => waiting.push(resolve));
}
