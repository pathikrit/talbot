import type { Move } from 'chess.js';
import selfUrl from './assets/sound/move-self.mp3';
import opponentUrl from './assets/sound/move-opponent.mp3';
import captureUrl from './assets/sound/capture.mp3';
import castleUrl from './assets/sound/castle.mp3';
import checkUrl from './assets/sound/move-check.mp3';
import promoteUrl from './assets/sound/promote.mp3';

const clips = { self: selfUrl, opponent: opponentUrl, capture: captureUrl, castle: castleUrl, check: checkUrl, promote: promoteUrl };
export type MoveSound = keyof typeof clips;

/** One clip per committed move; special moves take precedence over ordinary moves. */
export function soundForMove(move: Pick<Move, 'san' | 'promotion' | 'captured' | 'flags'>, human: boolean): MoveSound {
  if (/[+#]$/.test(move.san)) return 'check';
  if (move.promotion) return 'promote';
  if (/[kq]/.test(move.flags)) return 'castle';
  if (move.captured) return 'capture';
  return human ? 'self' : 'opponent';
}

export class MoveSounds {
  enabled = true;
  private context?: AudioContext;
  private output?: GainNode;
  private buffers = new Map<MoveSound, AudioBuffer>();
  private files = Promise.all(Object.entries(clips).map(async ([name, url]) => {
    try {
      const response = await fetch(url);
      return response.ok ? { name: name as MoveSound, bytes: await response.arrayBuffer() } : undefined;
    } catch { return undefined; }
  }));

  private async decode(context: AudioContext): Promise<void> {
    const files = await this.files;
    await Promise.all(files.map(async file => {
      if (!file) return;
      try { this.buffers.set(file.name, await context.decodeAudioData(file.bytes)); }
      catch { /* Missing/unsupported audio does not affect chess. */ }
    }));
  }

  /** Called only by user gestures. Never queue old moves behind autoplay unlock. */
  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.output = this.context.createGain();
        this.output.gain.value = .55;
        this.output.connect(this.context.destination);
        void this.decode(this.context);
      }
      if (this.context.state !== 'running') void this.context.resume().catch(() => {});
    } catch { /* Audio unavailable: chess must still work. */ }
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (this.output) this.output.gain.value = this.enabled ? .55 : 0;
    if (this.enabled) this.unlock();
  }

  play(sound: MoveSound): void {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running' || !this.output) return;
    try {
      const buffer = this.buffers.get(sound);
      if (!buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.output);
      source.onended = () => source.disconnect();
      source.start();
    } catch { /* A blocked or unavailable audio device must not affect play. */ }
  }
}
