import { describe, expect, it } from 'vitest';
import { MAX_RECENT_OPENINGS, OpeningMemory } from '../../src/opening-memory';

class MemoryStore {
  value: string | null = null;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { this.value = value; }
}

describe('bounded opening memory', () => {
  it('persists only the most recent valid entries', () => {
    const store = new MemoryStore();
    const memory = new OpeningMemory(store);
    for (let i = 0; i < MAX_RECENT_OPENINGS + 5; i++) {
      memory.remember({ lineId: `line-${i}`, move: i % 2 ? 'e2e4' : 'e7e5' });
    }
    expect(memory.recent()).toHaveLength(MAX_RECENT_OPENINGS);
    expect(memory.recent()[0].lineId).toBe('line-5');
    expect(new OpeningMemory(store).recent()).toEqual(memory.recent());
  });

  it('ignores malformed storage and keeps working when storage throws', () => {
    const broken = { getItem: () => '{bad', setItem: () => { throw new Error('blocked'); } };
    const memory = new OpeningMemory(broken);
    memory.remember({ lineId: 'stafford', move: 'e7e5' });
    memory.remember({ lineId: '', move: 'nope' });
    expect(memory.recent()).toEqual([{ lineId: 'stafford', move: 'e7e5' }]);
  });
});
