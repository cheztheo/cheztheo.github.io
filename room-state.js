(function (global) {
  'use strict';
  const timing = Object.freeze({ day: 120000, dusk: 60000, night: 120000, dawn: 60000 });
  const duration = timing.day + timing.dusk + timing.night + timing.dawn;
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const smooth = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };
  const lightDelays = Object.freeze({ floor: 0, chandelier: 1000, environment: 1000, candle: 1800 });
  const lightFadeDuration = 800;

  function lightsAtNight(milliseconds, strength = 1) {
    const light = (delay) => milliseconds < delay ? 0 : smooth((milliseconds - delay) / lightFadeDuration) * clamp(strength);
    const chandelier = light(lightDelays.chandelier);
    return { floor: light(lightDelays.floor), chandelier, environment: chandelier, candle: light(lightDelays.candle) };
  }

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
    return { phase, strength, shadowProgress, ...lightsAtNight(nightElapsed, strength) };
  }
  const api = { timing, duration, lightDelays, lightFadeDuration, lightsAtNight, cycleAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChezTheoCycle = api;
})(globalThis);
