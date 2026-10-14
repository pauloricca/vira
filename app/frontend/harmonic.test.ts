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
