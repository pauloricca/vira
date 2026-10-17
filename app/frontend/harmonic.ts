export type CamelotKey = { number: number; letter: 'A' | 'B'; label: string };

const pitchClasses: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const majorWheel = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4];
const minorWheel = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1];

export function camelotKey(key: string | null | undefined): CamelotKey | null {
  const match = key?.trim().match(/^([A-G](?:#|b)?)\s*(major|minor|maj|min|m)?$/i);
  if (!match) return null;
  const root = `${match[1][0].toUpperCase()}${match[1].slice(1).replace('♯', '#').replace('♭', 'b')}`;
  const pitch = pitchClasses[root];
  if (pitch === undefined) return null;
  const minor = ['minor', 'min', 'm'].includes((match[2] ?? '').toLowerCase());
  const number = (minor ? minorWheel : majorWheel).indexOf(pitch) + 1;
  return { number, letter: minor ? 'A' : 'B', label: `${root}${minor ? 'min' : 'maj'}` };
}

export function compatibility(candidate: CamelotKey | null, deck: CamelotKey | null): number | null {
  if (!candidate || !deck) return null;
  const distance = Math.abs(candidate.number - deck.number);
  const wheelDistance = Math.min(distance, 12 - distance);
  // Same key, neighbouring wheel positions and relative major/minor are the strongest mixes.
  const sameMode = [1, .85, .55, .3, .15, .05, 0];
  const otherMode = [.9, .65, .35, .18, .08, .03, 0];
  return (candidate.letter === deck.letter ? sameMode : otherMode)[wheelDistance];
}

export const keyRoots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function shiftedKey(key: string | null | undefined, semitones = 0): string | null {
  const parsed = camelotKey(key);
  if (!parsed) return null;
  const wheel = parsed.letter === 'A' ? minorWheel : majorWheel;
  const root = (wheel[parsed.number - 1] + semitones + 12) % 12;
  return `${keyRoots[root]} ${parsed.letter === 'A' ? 'minor' : 'major'}`;
}

export function keyChoices(original: string | null | undefined, other: string | null | undefined) {
  const source = camelotKey(original);
  const reference = camelotKey(other);
  if (!source) return [];
  const wheel = source.letter === 'A' ? minorWheel : majorWheel;
  const root = wheel[source.number - 1];
  return keyRoots.map((name, note) => ({
    key: `${name} ${source.letter === 'A' ? 'minor' : 'major'}`,
    semitones: ((note - root + 18) % 12) - 6,
    original: note === root,
    recommended: reference !== null && note === wheel[reference.number - 1],
  }));
}

export function keyHarmony(key: string | null | undefined): { key: number; scale: number } | null {
  const parsed = camelotKey(key); if (!parsed) return null;
  return { key: (parsed.letter === 'A' ? minorWheel : majorWheel)[parsed.number - 1], scale: parsed.letter === 'A' ? 1 : 0 };
}
