import { expect, it } from 'vitest';
import { SEARCH_MULTIPV, settings, validateSettings } from '../../src/settings';
import config from '../../settings.json';

it('loads settings.json as immutable shared configuration', () => {
  expect(settings).toEqual(config);
  expect(Object.isFrozen(settings)).toBe(true);
  expect(settings.maxSacrificeLossCp).toBe(100);
  expect(settings.maxDrawAvoidanceLossCp).toBe(1);
  expect(SEARCH_MULTIPV).toBe(100);
});

it.each([-1, 0.5, Infinity])('rejects invalid centipawn budget %s', maxSacrificeLossCp => {
  expect(() => validateSettings({ ...config, maxSacrificeLossCp })).toThrow('maxSacrificeLossCp');
});

it.each([-1, 0.5, Infinity])('rejects invalid draw-avoidance budget %s', maxDrawAvoidanceLossCp => {
  expect(() => validateSettings({ ...config, maxDrawAvoidanceLossCp })).toThrow('maxDrawAvoidanceLossCp');
});

it('allows zero loss and exposes both style allowances', () => {
  expect(validateSettings({ maxSacrificeLossCp: 0, maxDrawAvoidanceLossCp: 0 })).toEqual({
    maxSacrificeLossCp: 0, maxDrawAvoidanceLossCp: 0,
  });
  expect(Object.keys(settings)).toEqual(['maxSacrificeLossCp', 'maxDrawAvoidanceLossCp']);
});
