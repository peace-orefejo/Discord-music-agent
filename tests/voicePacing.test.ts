import { describe, it, expect } from 'vitest';
import type { AudioPlayer } from '@discordjs/voice';
import { paceAudioPlayer, FRAME_MS, MAX_FRAME_CREDIT } from '../src/utils/voicePacing';

function fakePlayer() {
  const sent: number[] = [];
  let prepared = 0;
  let nextFrame = 0;
  const player = {
    _stepDispatch() {
      if (prepared > 0) sent.push(prepared);
    },
    _stepPrepare() {
      prepared = ++nextFrame;
    },
  };
  return { player, sent };
}

function cycle(p: { _stepDispatch(): void; _stepPrepare(): void }) {
  p._stepDispatch();
  p._stepPrepare();
}

describe('paceAudioPlayer', () => {
  it('sends every frame when the timer keeps time', () => {
    const { player, sent } = fakePlayer();
    let t = 0;
    paceAudioPlayer(player as unknown as AudioPlayer, () => t);
    for (let i = 0; i < 10; i++) {
      cycle(player);
      t += 20;
    }
    expect(sent).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('tolerates ordinary timer jitter', () => {
    const { player, sent } = fakePlayer();
    let t = 0;
    paceAudioPlayer(player as unknown as AudioPlayer, () => t);
    for (const gap of [20, 28, 12, 20, 25, 15, 20]) {
      cycle(player);
      t += gap;
    }
    cycle(player);
    expect(sent).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('holds back the catch-up burst after a stall instead of fast-forwarding', () => {
    const { player, sent } = fakePlayer();
    let t = 0;
    paceAudioPlayer(player as unknown as AudioPlayer, () => t);

    for (let i = 0; i < 5; i++) {
      cycle(player);
      t += 20;
    }
    t += 2_000;
    const burstStart = sent.length;
    for (let i = 0; i < 100; i++) {
      cycle(player);
      t += 1;
    }
    const burstSent = sent.length - burstStart;
    expect(burstSent).toBeGreaterThan(0);
    expect(burstSent).toBeLessThanOrEqual(100 / FRAME_MS + MAX_FRAME_CREDIT);

    for (let i = 0; i < 10; i++) {
      t += 20;
      cycle(player);
    }
    expect(sent).toEqual(Array.from({ length: sent.length }, (_, i) => i + 1));
  });
});
