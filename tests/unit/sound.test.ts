import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveSounds, soundForMove } from '../../src/sound';
import { Chess } from 'chess.js';

afterEach(() => vi.unstubAllGlobals());

describe('move sounds', () => {
  it('plays only after unlock, respects mute, and decodes all six clips once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    const start = vi.fn();
    const decode = vi.fn(async () => ({}));
    vi.stubGlobal('AudioContext', class {
      state = 'running'; sampleRate = 48000; destination = {};
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      decodeAudioData = decode;
      createBufferSource() { return { connect() {}, disconnect() {}, start }; }
    });
    const sounds = new MoveSounds();
    sounds.play('self'); expect(start).not.toHaveBeenCalled();
    sounds.unlock();
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(6));
    sounds.play('self'); sounds.play('opponent');
    expect(start).toHaveBeenCalledTimes(2);
    sounds.toggle(); sounds.play('capture');
    expect(start).toHaveBeenCalledTimes(2);
    sounds.toggle(); sounds.play('capture');
    expect(start).toHaveBeenCalledTimes(3);
    expect(decode).toHaveBeenCalledTimes(6);
  });
  it('does not throw when audio is unavailable or resume is denied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.stubGlobal('AudioContext', undefined);
    const unavailable = new MoveSounds();
    expect(() => { unavailable.unlock(); unavailable.play('self'); }).not.toThrow();
    const start = vi.fn();
    vi.stubGlobal('AudioContext', class {
      state = 'suspended'; destination = {};
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      resume() { return Promise.reject(new Error('blocked')); }
      createBufferSource() { return { start }; }
    });
    const blocked = new MoveSounds();
    blocked.unlock(); blocked.play('self');
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
  });
  it('maps legal chess moves to the correct clip, including special-move precedence', () => {
    const chess = new Chess();
    expect(soundForMove(chess.move('e4'), true)).toBe('self');
    expect(soundForMove(chess.move('d5'), false)).toBe('opponent');
    expect(soundForMove(chess.move('exd5'), true)).toBe('capture');
    for (const [fen, move, expected] of [
      ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'exd6', 'capture'],
      ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'O-O', 'castle'],
      ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'O-O-O', 'castle'],
      ['7k/P7/8/8/8/8/8/7K w - - 0 1', 'a8=N', 'promote'],
      ['7k/P7/8/8/8/8/8/7K w - - 0 1', 'a8=Q+', 'check'],
      ['7k/8/5KQ1/8/8/8/8/8 w - - 0 1', 'Qg7#', 'check'],
    ]) expect(soundForMove(new Chess(fen).move(move), true)).toBe(expected);
  });
});
