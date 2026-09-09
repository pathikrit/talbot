import config from '../settings.json';

// Internal search breadth, not a user-facing style setting.
export const SEARCH_MULTIPV = 50;

export function validateSettings(value: { maxSacrificeLossCp: number }) {
  if (!Number.isSafeInteger(value.maxSacrificeLossCp) || value.maxSacrificeLossCp < 0) {
    throw new Error('settings.json: maxSacrificeLossCp must be a nonnegative integer.');
  }
  return Object.freeze({ maxSacrificeLossCp: value.maxSacrificeLossCp });
}

// Shared build-time configuration for the UI and worker; no runtime fetch.
export const settings = validateSettings(config);
