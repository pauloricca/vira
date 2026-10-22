import { expect, test } from 'vitest';
import { ArtworkCache } from './artworkCache';
test('evicts least recently used entries within byte and count budgets', () => {
  const cache = new ArtworkCache(150, 2);
  cache.set('a', '123'); cache.set('b', '123');
  expect(cache.get('a')).toBe('123');
  cache.set('c', '123');
  expect(cache.has('b')).toBe(false);
  expect(cache.has('a')).toBe(true);
  cache.set('large', 'x'.repeat(100));
  expect(cache.has('large')).toBe(false);
  cache.set('a', null);
  expect(cache.get('a')).toBe(null);
  cache.set('d', null);
  expect(cache.has('c')).toBe(false);
});
test('negative results are bounded too', () => {
  const cache = new ArtworkCache(10000, 2);
  for (const id of ['a', 'b', 'c']) cache.set(id, null);
  expect(cache.has('a')).toBe(false);
  expect(cache.has('c')).toBe(true);
});
