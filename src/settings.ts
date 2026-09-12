import config from '../settings.json';

// Internal search breadth, not a user-facing style setting.
export const SEARCH_MULTIPV = 100;

interface Settings {
  maxSacrificeLossCp: number;
  maxDrawAvoidanceLossCp: number;
}

export function validateSettings(value: Settings) {
  if (!Number.isSafeInteger(value.maxSacrificeLossCp) || value.maxSacrificeLossCp < 0) {
    throw new Error('settings.json: maxSacrificeLossCp must be a nonnegative integer.');
  }
  if (!Number.isSafeInteger(value.maxDrawAvoidanceLossCp) || value.maxDrawAvoidanceLossCp < 0) {
    throw new Error('settings.json: maxDrawAvoidanceLossCp must be a nonnegative integer.');
  }
  return Object.freeze({
    maxSacrificeLossCp: value.maxSacrificeLossCp,
    maxDrawAvoidanceLossCp: value.maxDrawAvoidanceLossCp,
  });
}

// Shared build-time configuration for the UI and worker; no runtime fetch.
export const settings = validateSettings(config);
