// Call tones — ringback (outgoing) and ringtone (incoming).
// Generated with the Web Audio API so we don't ship any audio files.
//
// Note: browsers only allow audio after a user gesture. The outgoing ringback
// always works (it starts from a button press). The incoming ringtone works as
// long as the user has interacted with the page at least once this session.

let ctx: AudioContext | null = null;
let stop: (() => void) | null = null;

function audioCtx(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

// A pattern is a list of [frequencyHz (0 = silence), durationMs] steps that
// loops forever, with `gapMs` of silence between repeats.
function loopPattern(pattern: Array<[number, number]>, gapMs: number, volume: number) {
  stopTone();
  const ac = audioCtx();
  void ac.resume();

  const gain = ac.createGain();
  gain.gain.value = 0.0001;
  gain.connect(ac.destination);

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.connect(gain);
  osc.start();

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;

  const step = (i: number) => {
    if (cancelled) return;
    if (i >= pattern.length) {
      timer = setTimeout(() => step(0), gapMs);
      return;
    }
    const [freq, dur] = pattern[i];
    const now = ac.currentTime;
    if (freq > 0) {
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setTargetAtTime(volume, now, 0.015); // soft attack, no click
    } else {
      gain.gain.setTargetAtTime(0.0001, now, 0.015);
    }
    timer = setTimeout(() => step(i + 1), dur);
  };
  step(0);

  stop = () => {
    cancelled = true;
    clearTimeout(timer);
    try {
      gain.gain.setTargetAtTime(0.0001, ac.currentTime, 0.02);
    } catch {
      /* context may be closed */
    }
    setTimeout(() => {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      osc.disconnect();
      gain.disconnect();
    }, 60);
  };
}

// Outgoing: calm ringback — a single tone, long gap.
export function playRingback() {
  loopPattern([[440, 1200]], 3000, 0.05);
}

// Incoming: brighter, urgent double-pulse.
export function playRingtone() {
  loopPattern([[523, 350], [0, 180], [523, 350]], 1400, 0.07);
}

export function stopTone() {
  stop?.();
  stop = null;
}
