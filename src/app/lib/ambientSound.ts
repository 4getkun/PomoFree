// Procedurally synthesized ambient/focus sounds, Web Audio API only — no
// bundled or CDN-hosted audio files (same licensing rationale as the chime
// in sound.ts). Every texture is built by filtering a looping noise buffer
// and/or modulating gain with slow LFOs; nothing here is a recording.
//
// Usage:
//   const engine = createAmbientSoundEngine();
//   engine.play("rain", 0.5);   // fades in over ~300ms
//   engine.setVolume(0.8);      // live update while playing
//   engine.stop();              // fades out over ~300ms, then disconnects
//   engine.dispose();           // closes the AudioContext entirely

import type { AmbientSoundId } from "./types";

const FADE_SECONDS = 0.35;
const NOISE_BUFFER_SECONDS = 4;

interface ActiveGraph {
  nodes: AudioNode[];
  masterGain: GainNode;
  stopSources: () => void;
}

export interface AmbientSoundEngine {
  play: (soundId: AmbientSoundId, volume: number) => void;
  stop: () => void;
  setVolume: (volume: number) => void;
  dispose: () => void;
  isPlaying: () => boolean;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function makeNoiseSource(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

/** A slow sine LFO driving a target AudioParam, used for amplitude swells. */
function addLFO(ctx: AudioContext, target: AudioParam, frequencyHz: number, depth: number, center: number): OscillatorNode {
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = frequencyHz;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = depth;
  lfo.connect(lfoGain);
  lfoGain.connect(target);
  target.value = center;
  lfo.start();
  return lfo;
}

/** Schedules sparse, soft random "pop"/"crackle" transients (rain droplets,
 * cafe murmur, forest twigs) by briefly nudging a gain node's value. */
function scheduleTransients(
  ctx: AudioContext,
  gain: GainNode,
  opts: { minIntervalS: number; maxIntervalS: number; peak: number; attackS: number; releaseS: number },
): () => void {
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = () => {
    if (cancelled) return;
    const delayMs =
      (opts.minIntervalS + Math.random() * (opts.maxIntervalS - opts.minIntervalS)) * 1000;
    timeoutId = setTimeout(() => {
      if (cancelled) return;
      const now = ctx.currentTime;
      const peak = opts.peak * (0.5 + Math.random() * 0.5);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(gain.gain.value + peak, now + opts.attackS);
      gain.gain.linearRampToValueAtTime(gain.gain.value, now + opts.attackS + opts.releaseS);
      scheduleNext();
    }, delayMs);
  };

  scheduleNext();
  return () => {
    cancelled = true;
    if (timeoutId != null) clearTimeout(timeoutId);
  };
}

/** Builds the audio graph for one sound. Returns the graph plus a cleanup fn. */
function buildGraph(ctx: AudioContext, soundId: AmbientSoundId, masterGain: GainNode): ActiveGraph {
  const noiseBuffer = makeNoiseBuffer(ctx);
  const nodes: AudioNode[] = [];
  const cleanupFns: (() => void)[] = [];
  let sources: AudioBufferSourceNode[] = [];

  const startSource = (): AudioBufferSourceNode => {
    const src = makeNoiseSource(ctx, noiseBuffer);
    sources.push(src);
    src.start(); 
    return src;
  };

  switch (soundId) {
    case "white-noise": {
      // Plain broadband noise, no filtering.
      const src = startSource();
      src.connect(masterGain);
      src.start();
      break;
    }
    case "rain": {
      // High-passed noise (the "hiss" of rain) plus sparse bright
      // high-frequency gain spikes standing in for droplet crackle.
      const src = startSource();
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 1200;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 7000;
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.6;
      src.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(bedGain);
      bedGain.connect(masterGain);
      nodes.push(highpass, lowpass, bedGain);

      const crackleGain = ctx.createGain();
      crackleGain.gain.value = 0;
      const crackleFilter = ctx.createBiquadFilter();
      crackleFilter.type = "bandpass";
      crackleFilter.frequency.value = 5000;
      crackleFilter.Q.value = 0.7;
      const crackleSrc = startSource();
      crackleSrc.connect(crackleFilter);
      crackleFilter.connect(crackleGain);
      crackleGain.connect(masterGain);
      nodes.push(crackleFilter, crackleGain);
      const stopTransients = scheduleTransients(ctx, crackleGain, {
        minIntervalS: 0.03,
        maxIntervalS: 0.18,
        peak: 0.35,
        attackS: 0.005,
        releaseS: 0.05,
      });
      cleanupFns.push(stopTransients);
      break;
    }
    case "waves": {
      // Low-passed noise with a slow sinusoidal amplitude swell to mimic
      // surf rising and falling.
      const src = startSource();
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 900;
      const swellGain = ctx.createGain();
      src.connect(lowpass);
      lowpass.connect(swellGain);
      swellGain.connect(masterGain);
      nodes.push(lowpass, swellGain);
      const lfo = addLFO(ctx, swellGain.gain, 0.09, 0.35, 0.55);
      nodes.push(lfo);
      break;
    }
    case "forest": {
      // Gentle band-passed noise bed (wind through leaves) plus very
      // sparse, soft high chirps standing in for distant birds/twigs.
      const src = startSource();
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 700;
      bandpass.Q.value = 0.5;
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.5;
      src.connect(bandpass);
      bandpass.connect(bedGain);
      bedGain.connect(masterGain);
      nodes.push(bandpass, bedGain);

      const chirpGain = ctx.createGain();
      chirpGain.gain.value = 0;
      const chirpFilter = ctx.createBiquadFilter();
      chirpFilter.type = "bandpass";
      chirpFilter.frequency.value = 3200;
      chirpFilter.Q.value = 4;
      const chirpSrc = startSource();
      chirpSrc.connect(chirpFilter);
      chirpFilter.connect(chirpGain);
      chirpGain.connect(masterGain);
      nodes.push(chirpFilter, chirpGain);
      const stopTransients = scheduleTransients(ctx, chirpGain, {
        minIntervalS: 1.5,
        maxIntervalS: 5,
        peak: 0.25,
        attackS: 0.02,
        releaseS: 0.15,
      });
      cleanupFns.push(stopTransients);
      break;
    }
    case "cafe": {
      // Low-passed "room murmur" noise bed plus occasional soft mid-range
      // pops standing in for cups/chatter, both quieter and duller than
      // the rain crackle so it reads as indoor ambience.
      const src = startSource();
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 2200;
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 200;
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.45;
      src.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(bedGain);
      bedGain.connect(masterGain);
      nodes.push(highpass, lowpass, bedGain);

      const popGain = ctx.createGain();
      popGain.gain.value = 0;
      const popFilter = ctx.createBiquadFilter();
      popFilter.type = "bandpass";
      popFilter.frequency.value = 900;
      popFilter.Q.value = 1.2;
      const popSrc = startSource();
      popSrc.connect(popFilter);
      popFilter.connect(popGain);
      popGain.connect(masterGain);
      nodes.push(popFilter, popGain);
      const stopTransients = scheduleTransients(ctx, popGain, {
        minIntervalS: 0.8,
        maxIntervalS: 2.5,
        peak: 0.3,
        attackS: 0.01,
        releaseS: 0.12,
      });
      cleanupFns.push(stopTransients);
      break;
    }
  }

  return {
    nodes,
    masterGain,
    stopSources: () => {
      for (const fn of cleanupFns) fn();
      for (const src of sources) {
        try {
          src.stop();
        } catch {
          // already stopped
        }
      }
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // already disconnected
        }
      }
    },
  };
}

export function createAmbientSoundEngine(): AmbientSoundEngine {
  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let currentGraph: ActiveGraph | null = null;
  let currentVolume = 0.5;
  let playing = false;

  const getContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    return ctx;
  };

  const stop = () => {
    if (!ctx || !masterGain || !currentGraph) {
      playing = false;
      return;
    }
    const now = ctx.currentTime;
    const graph = currentGraph;
    const gain = masterGain;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    playing = false;
    currentGraph = null;
    setTimeout(() => {
      graph.stopSources();
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
    }, FADE_SECONDS * 1000 + 50);
    masterGain = null;
  };

  const play = (soundId: AmbientSoundId, volume: number) => {
    const audioCtx = getContext();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }

    // Stop whatever's currently playing first (fresh graph per sound).
    if (currentGraph) stop();

    currentVolume = volume;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    gain.connect(audioCtx.destination);
    const graph = buildGraph(audioCtx, soundId, gain);

    const now = audioCtx.currentTime;
    const target = Math.max(0, Math.min(1, volume)) * 0.5; // headroom
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(target, now + FADE_SECONDS);

    masterGain = gain;
    currentGraph = graph;
    playing = true;
  };

  const setVolume = (volume: number) => {
    currentVolume = volume;
    if (!ctx || !masterGain || !playing) return;
    const target = Math.max(0, Math.min(1, volume)) * 0.5;
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.linearRampToValueAtTime(target, now + 0.1);
  };

  const dispose = () => {
    stop();
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
  };

  return { play, stop, setVolume, dispose, isPlaying: () => playing };
}
