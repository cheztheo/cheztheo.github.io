(function (global) {
  'use strict';
  const timing = Object.freeze({ day: 120000, dusk: 60000, night: 120000, dawn: 60000 });
  const duration = timing.day + timing.dusk + timing.night + timing.dawn;
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const smooth = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };

  function cycleAt(milliseconds) {
    const elapsed = ((milliseconds % duration) + duration) % duration;
    let phase = '白天';
    let strength = 0;
    let shadowProgress = 0;
    let nightElapsed = -1;
    if (elapsed >= timing.day && elapsed < timing.day + timing.dusk) {
      phase = '黄昏';
      strength = smooth((elapsed - timing.day) / timing.dusk);
    } else if (elapsed >= timing.day + timing.dusk && elapsed < timing.day + timing.dusk + timing.night) {
      phase = '夜晚';
      nightElapsed = elapsed - timing.day - timing.dusk;
      strength = 1;
      shadowProgress = smooth(nightElapsed / timing.night);
    } else if (elapsed >= timing.day + timing.dusk + timing.night) {
      phase = '黎明';
      const dawnElapsed = elapsed - timing.day - timing.dusk - timing.night;
      strength = 1 - smooth(dawnElapsed / timing.dawn);
      shadowProgress = 1;
      nightElapsed = timing.night + dawnElapsed;
    }
    const light = (delay) => nightElapsed < delay ? 0 : smooth((nightElapsed - delay) / 800) * strength;
    return { phase, strength, shadowProgress, floor: light(0), candle: light(1000), chandelier: light(2000) };
  }
  const api = { timing, duration, cycleAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChezTheoCycle = api;
})(globalThis);
