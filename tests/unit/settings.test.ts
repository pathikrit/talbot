import { expect, it } from 'vitest';
import { SEARCH_MULTIPV, settings, validateSettings } from '../../src/settings';
import config from '../../settings.json';

it('loads settings.json as immutable shared configuration', () => {
  expect(settings).toEqual(config);
  expect(Object.isFrozen(settings)).toBe(true);
  expect(settings.maxSacrificeLossCp).toBe(75);
  expect(SEARCH_MULTIPV).toBe(50);
});

it.each([-1, 0.5, Infinity])('rejects invalid centipawn budget %s', maxSacrificeLossCp => {
  expect(() => validateSettings({ ...config, maxSacrificeLossCp })).toThrow('maxSacrificeLossCp');
});

it('allows zero loss and exposes only the loss allowance', () => {
  expect(validateSettings({ maxSacrificeLossCp: 0 }).maxSacrificeLossCp).toBe(0);
  expect(Object.keys(settings)).toEqual(['maxSacrificeLossCp']);
});
