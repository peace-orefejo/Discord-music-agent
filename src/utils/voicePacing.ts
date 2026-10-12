import type { AudioPlayer } from '@discordjs/voice';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { childLogger } from './logger';

const log = childLogger({ module: 'voicePacing' });

export const FRAME_MS = 20;
export const MAX_FRAME_CREDIT = 3;

interface SteppablePlayer {
  _stepDispatch(): void;
  _stepPrepare(): void;
}

export function paceAudioPlayer(player: AudioPlayer, now: () => number = Date.now): AudioPlayer {
  const steppable = player as unknown as SteppablePlayer;
  const dispatch = steppable._stepDispatch.bind(player);
  const prepare = steppable._stepPrepare.bind(player);
  let lastStep: number | null = null;
  let credit = MAX_FRAME_CREDIT;
  let skipping = false;
  let skipped = 0;

  steppable._stepDispatch = () => {
    const t = now();
    if (lastStep !== null) {
      credit = Math.min(MAX_FRAME_CREDIT, credit + (t - lastStep) / FRAME_MS);
    }
    lastStep = t;
    skipping = credit < 1;
    if (skipping) {
      skipped++;
      return;
    }
    if (skipped > 0) {
      log.warn({ heldBackSteps: skipped }, 'Held back a burst of late audio frames');
      skipped = 0;
    }
    credit -= 1;
    dispatch();
  };

  steppable._stepPrepare = () => {
    if (skipping) return;
    prepare();
  };

  return player;
}

let stallMonitorStarted = false;

export function startEventLoopStallMonitor(thresholdMs = 100, intervalMs = 5_000): void {
  if (stallMonitorStarted) return;
  stallMonitorStarted = true;

  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const timer = setInterval(() => {
    const maxMs = histogram.max / 1e6;
    if (maxMs >= thresholdMs) {
      log.warn(
        { maxStallMs: Math.round(maxMs), p99Ms: Math.round(histogram.percentile(99) / 1e6) },
        'Event loop stalled — audio frames were delayed',
      );
    }
    histogram.reset();
  }, intervalMs);
  timer.unref();
}
