// Synthesized end-of-session chime using the Web Audio API. Deliberately
// does NOT reference any bundled/external audio file — the tones are
// generated purely in code to avoid any audio-licensing questions.

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) {
    sharedContext = new Ctor();
  }
  return sharedContext;
}

interface Tone {
  frequency: number;
  startOffset: number; // seconds from chime start
  duration: number; // seconds
  gain: number; // 0-1 peak gain
}

/**
 * Plays a short, pleasant three-tone chime (ascending major-ish interval)
 * to signal a phase transition. `volume` scales the whole chime, 0-1.
 */
export function playChime(volume = 0.5): void {
  const ctx = getContext();
  if (!ctx) return;

  // Resume if the context was suspended (e.g. before first user gesture).
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const peak = Math.max(0, Math.min(1, volume)) * 0.3; // keep headroom, avoid clipping

  const tones: Tone[] = [
    { frequency: 587.33, startOffset: 0, duration: 0.18, gain: peak }, // D5
    { frequency: 739.99, startOffset: 0.15, duration: 0.18, gain: peak }, // F#5
    { frequency: 880.0, startOffset: 0.3, duration: 0.35, gain: peak }, // A5
  ];

  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = tone.frequency;

    const startAt = now + tone.startOffset;
    const endAt = startAt + tone.duration;

    // Smooth attack/decay envelope to avoid audible clicks.
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(tone.gain, startAt + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, endAt);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }
}
