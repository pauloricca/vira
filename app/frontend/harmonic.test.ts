import { expect, test } from 'vitest';
import { camelotKey, compatibility } from './harmonic';

test('maps major, minor and enharmonic analysis keys to Camelot', () => {
  expect(camelotKey('C major')).toEqual({ number: 8, letter: 'B', label: 'Cmaj' });
  expect(camelotKey('A minor')).toEqual({ number: 8, letter: 'A', label: 'Amin' });
  expect(camelotKey('D minor')).toEqual({ number: 7, letter: 'A', label: 'Dmin' });
  expect(camelotKey('Db major')?.number).toBe(camelotKey('C# major')?.number);
  expect(camelotKey('unknown')).toBeNull();
});

test('scores same, adjacent and relative keys above distant keys', () => {
  const c = camelotKey('C major');
  expect(compatibility(c, c)).toBe(1);
  expect(compatibility(camelotKey('A minor'), c)).toBe(.9);
  expect(compatibility(camelotKey('G major'), c)).toBe(.85);
  expect(compatibility(camelotKey('F# major'), c)).toBe(0);
  expect(compatibility(null, c)).toBeNull();
});

test('offers the source mode, recommends the same or relative key, and uses the shortest shift', async () => {
  const { keyChoices, shiftedKey } = await import('./harmonic');
  const major = keyChoices('A major', 'C major');
  expect(major).toHaveLength(12);
  expect(major.every(choice => choice.key.endsWith('major'))).toBe(true);
  expect(major.find(choice => choice.recommended)).toMatchObject({ key: 'C major', semitones: 3 });
  expect(keyChoices('A minor', 'C major').find(choice => choice.recommended)).toMatchObject({ key: 'A minor', original: true });
  expect(keyChoices('C major', 'D minor').find(choice => choice.recommended)?.key).toBe('F major');
  expect(keyChoices('B minor', 'C minor').find(choice => choice.recommended)?.semitones).toBe(1);
  expect(shiftedKey('Db major', -1)).toBe('C major');
  expect(shiftedKey('B minor', 1)).toBe('C minor');
  expect(keyChoices('unknown', 'C major')).toEqual([]);
  expect(keyChoices('C major', null).some(choice => choice.recommended)).toBe(false);
});

test('manual metadata keys override estimates and can explicitly mark a key unknown', async () => {
  const { metadataKey } = await import('./harmonic');
  const track = { analysis: { result: { keys: [{ key: 'C major' }] } } };
  expect(metadataKey(track)).toBe('C major');
  expect(metadataKey({ ...track, metadata_key: 'D minor' })).toBe('D minor');
  expect(metadataKey({ ...track, metadata_key: '' })).toBeUndefined();
  expect(metadataKey({ metadata_key: 'F# minor', analysis: { result: null } })).toBe('F# minor');
});
