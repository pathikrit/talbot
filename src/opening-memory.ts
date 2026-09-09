import type { RecentOpening } from './engine/protocol';

export const MAX_RECENT_OPENINGS = 12;
const STORAGE_KEY = 'talbot.recent-openings.v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | undefined {
  try { return globalThis.localStorage; }
  catch { return undefined; }
}

function valid(entry: unknown): entry is RecentOpening {
  if (!entry || typeof entry !== 'object') return false;
  const value = entry as Partial<RecentOpening>;
  return typeof value.lineId === 'string' && value.lineId.length > 0 && value.lineId.length <= 160
    && typeof value.move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value.move);
}

/** Tiny, best-effort opening memory. Storage failures never affect chess. */
export class OpeningMemory {
  private entries: RecentOpening[] = [];

  constructor(private storage: Store | undefined = browserStorage()) {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(parsed)) this.entries = parsed.filter(valid).slice(-MAX_RECENT_OPENINGS);
    } catch { /* Private browsing and malformed old data fall back to memory. */ }
  }

  recent(): RecentOpening[] { return this.entries.map(entry => ({ ...entry })); }

  remember(entry: RecentOpening): void {
    if (!valid(entry)) return;
    this.entries = [...this.entries, { ...entry }].slice(-MAX_RECENT_OPENINGS);
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries)); }
    catch { /* The in-memory bounded history still works for this page. */ }
  }
}
