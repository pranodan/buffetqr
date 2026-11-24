/* Short audio cues for the buffet scanner. Generated locally, no audio files. */
let ctx = null;

export function beep(kind = "success") {
  try {
    if (typeof window === "undefined") return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ctx = ctx || new AudioCtx();
    if (ctx.state === "suspended") ctx.resume();

    const play = (freq, start, duration, volume = 0.22) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.02);
    };

    if (kind === "success") {
      play(880, 0, 0.12);
      play(1245, 0.12, 0.16);
    } else if (kind === "warn") {
      play(560, 0, 0.18);
    } else {
      play(240, 0, 0.26, 0.28);
    }
  } catch {
    /* audio is optional */
  }
}