(function (global) {
  'use strict';
  const W = 2048, H = 1152;
  const clamp = value => Math.max(0, Math.min(1, value));

  // Keep the approved painting separate from the original animation layers.
  // Signed colour differences follow each animated object, rather than leaving
  // a second copy of that object behind in a flattened night-time screenshot.
  function install(renderer) {
    if (!renderer.images.approvedNight || renderer.approvedNight) return renderer;
    const create = (w, h) => renderer.newCanvas(w, h);
    const CW = renderer.images.approvedNight.width || W;
    const inset = (CW - W) / 2;
    const originalRender = renderer.render;
    const referenceImages = { ...renderer.images };
    delete referenceImages.brandLogo;
    delete referenceImages.approvedNight;
    const referenceCanvas = create(CW, H);
    const reference = new renderer.constructor(referenceCanvas, referenceImages, renderer.makeCanvas);
    reference.reducedMotion = true;
    reference.render(10000, { strength: 1, shadowProgress: 1, floor: 1, chandelier: 1, environment: 1, candle: 1 }, true);
    const baseline = reference.ctx.getImageData(0, 0, CW, H).data;
    const targetCanvas = create(CW, H);
    targetCanvas.getContext('2d').drawImage(renderer.images.approvedNight, 0, 0, CW, H);
    const target = targetCanvas.getContext('2d').getImageData(0, 0, CW, H).data;
    const moon = reference.viewportNight.getContext('2d').getImageData(0, 0, CW, H).data;
    const foregroundCanvas = create(CW, H);
    const foregroundContext = foregroundCanvas.getContext('2d');
    foregroundContext.drawImage(reference.staticCanvas, inset, 0);
    foregroundContext.save(); foregroundContext.translate(inset, 0);
    for (const leaf of reference.leaves) reference.draw(foregroundContext, leaf.sprite, { dx: leaf.dx, dy: leaf.dy });
    foregroundContext.restore();
    const foreground = foregroundCanvas.getContext('2d').getImageData(0, 0, CW, H).data;

    const groups = [];
    const add = (kind, extra = {}) => {
      const group = { kind, ...extra, left: W, top: H, right: 0, bottom: 0, count: 0 };
      groups.push(group);
      return groups.length - 1;
    };
    const staticGroup = add('static');
    const floorGroup = add('floor');
    const chandelierGroup = add('chandelier');
    const environmentGroup = add('environment');
    const moonGroup = add('moon');
    const objects = ['computer', 'diary', 'painting'].map(id => {
      const sprite = renderer.sprites[id];
      return { id, sprite, group: add('object', { id, pivot: { x: sprite.left + sprite.width / 2, y: sprite.top + sprite.height / 2 } }) };
    });
    const ballGroup = add('ball');
    const candleBaseGroup = add('candleBase');
    const flameGroups = renderer.flameCenters.map((center, index) => add('flame', { index, center }));
    const assignments = new Uint8Array(CW * H);
    const inside = (sprite, x, y, pad = 3) => x >= sprite.left - pad && y >= sprite.top - pad && x < sprite.left + sprite.width + pad && y < sprite.top + sprite.height + pad;
    const moonMask = new Uint8Array(CW * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < CW - 1; x++) {
      if (moon[(y * CW + x) * 4 + 3] >= 250) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < CW && yy >= 0 && yy < H) moonMask[yy * CW + xx] = 1;
      }
    }
    for (let y = 0; y < H; y++) for (let column = 0; column < CW; column++) {
      const x = column - inset, pixel = y * CW + column, p = pixel * 4;
      if (baseline[p] === target[p] && baseline[p + 1] === target[p + 1] && baseline[p + 2] === target[p + 2]) continue;
      let owner = staticGroup;
      const object = objects.find(object => inside(object.sprite, x, y));
      if (object) owner = object.group;
      else if (inside(renderer.sprites.tennis, x, y, 5)) owner = ballGroup;
      else {
        let nearest = -1, distance = Infinity;
        renderer.flameCenters.forEach((center, index) => {
          const d = Math.hypot((x - center.x) / 70, (y - center.y) / 82);
          if (d < distance) { distance = d; nearest = index; }
        });
        if (distance < 1.15) owner = flameGroups[nearest];
        else if (moonMask[pixel] && foreground[p + 3] < 8 && (Math.min(baseline[p], baseline[p + 1], baseline[p + 2]) > 180 || Math.min(target[p], target[p + 1], target[p + 2]) > 180)) owner = moonGroup;
        else if (x < W * .28 && y > H * .48) owner = floorGroup;
        else if (x > W * .28 && x < W * .72 && y < H * .27) owner = chandelierGroup;
        else if (x > W * .24 && x < W * .76 && y > H * .32 && y < H * .69) owner = environmentGroup;
      }
      assignments[pixel] = owner;
      const group = groups[owner];
      group.left = Math.min(group.left, x); group.top = Math.min(group.top, y);
      group.right = Math.max(group.right, x + 1); group.bottom = Math.max(group.bottom, y + 1); group.count++;
      if (group.kind === 'flame') {
        const fixed = groups[candleBaseGroup];
        fixed.left = Math.min(fixed.left, x); fixed.top = Math.min(fixed.top, y);
        fixed.right = Math.max(fixed.right, x + 1); fixed.bottom = Math.max(fixed.bottom, y + 1); fixed.count++;
      }
    }
    for (const group of groups) {
      if (!group.count) continue;
      group.width = group.right - group.left; group.height = group.bottom - group.top;
      group.positive = create(group.width, group.height); group.negative = create(group.width, group.height);
      group.plus = group.positive.getContext('2d').createImageData(group.width, group.height);
      group.minus = group.negative.getContext('2d').createImageData(group.width, group.height);
    }
    const smooth = (low, high, value) => { const t = clamp((value - low) / (high - low)); return t * t * (3 - 2 * t); };
    function writeDifference(group, x, y, difference) {
      const j = ((y - group.top) * group.width + x - group.left) * 4;
      for (let channel = 0; channel < 3; channel++) {
        group.plus.data[j + channel] = Math.max(0, difference[channel]);
        group.minus.data[j + channel] = Math.max(0, -difference[channel]);
      }
      group.plus.data[j + 3] = group.minus.data[j + 3] = 255;
    }
    for (let y = 0; y < H; y++) for (let column = 0; column < CW; column++) {
      const x = column - inset, pixel = y * CW + column, p = pixel * 4;
      if (baseline[p] === target[p] && baseline[p + 1] === target[p + 1] && baseline[p + 2] === target[p + 2]) continue;
      const group = groups[assignments[pixel]];
      const difference = [target[p] - baseline[p], target[p + 1] - baseline[p + 1], target[p + 2] - baseline[p + 2]];
      if (group.kind !== 'flame') { writeDifference(group, x, y, difference); continue; }
      const average = [0, 0, 0]; let samples = 0;
      for (let dy = -12; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) {
        const xx = column + dx, yy = y + dy;
        if (xx < 0 || xx >= CW || yy < 270 || yy >= H) continue;
        const q = (yy * CW + xx) * 4;
        if (foreground[q + 3] > 8 || target[q + 2] < 95) continue;
        for (let c = 0; c < 3; c++) average[c] += target[q + c] - baseline[q + c];
        samples++;
      }
      const distance = Math.hypot((x - group.center.x) / 70, (y - group.center.y) / 82);
      const fieldWeight = smooth(270, 305, y) * (1 - smooth(.55, 1.15, distance));
      const coreWeight = (1 - smooth(.18, .38, distance)) * (1 - smooth(0, 24, foreground[p + 3]));
      const moving = difference.map((value, c) => {
        const field = samples ? average[c] / samples * fieldWeight : 0;
        const light = field * (1 - coreWeight) + value * coreWeight;
        return Math.round(Math.max(-(255 - target[p + c]), Math.min(target[p + c], light)));
      });
      writeDifference(group, x, y, moving);
      writeDifference(groups[candleBaseGroup], x, y, difference.map((value, c) => value - moving[c]));
    }
    for (const group of groups) {
      if (!group.count) continue;
      group.positive.getContext('2d').putImageData(group.plus, 0, 0);
      group.negative.getContext('2d').putImageData(group.minus, 0, 0);
      delete group.plus; delete group.minus;
    }
    const activeGroups = groups.filter(group => group.count);
    renderer.approvedNight = { groups: activeGroups, referenceSize: [CW, H], nativeArtInset: inset, previewMatched: true };
    renderer.leafAt = () => null;

    function ballPose(now) {
      const time = renderer.ballStartedAt === null ? -1 : (now - renderer.ballStartedAt) / 1000;
      if (time >= 1.55) return null;
      let dx = renderer.ballOffset.x, dy = renderer.ballOffset.y;
      if (time >= 0) {
        const height = Math.min(H * .18, renderer.sprites.tennis.top + renderer.ballOffset.y - H * .615);
        if (time < .72) { const t = time / .72; dx += W * .045 * t; dy -= Math.max(0, height) * 4 * t * (1 - t); }
        else { const t = Math.min(1, (time - .72) / .6); dx += W * (.045 + .15 * t); dy -= H * .065 * 4 * t * (1 - t); if (time > 1.32) dx += (time - 1.32) * W; }
      }
      return { dx, dy, angle: Math.max(0, time) * 1.5, pivot: { x: renderer.sprites.tennis.left + renderer.sprites.tennis.width / 2, y: renderer.sprites.tennis.top + renderer.sprites.tennis.height / 2 } };
    }
    function drawBrand(state) {
      if (!renderer.images.brandLogo) return;
      const box = renderer.brandBox || { x: renderer.canvas.width * 19 / 1731, y: renderer.canvas.height * 10 / 908, width: renderer.canvas.width * 62 / 1731, height: renderer.canvas.width * 47 / 1731 };
      const key = [Math.round(box.width), Math.round(box.height), Math.round(clamp(state.strength) * 255)].join(':');
      if (!renderer.approvedBrand || renderer.approvedBrand.key !== key) {
        const image = create(Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height))), ctx = image.getContext('2d');
        ctx.drawImage(renderer.images.brandLogo, 0, 0, image.width, image.height);
        const pixels = ctx.getImageData(0, 0, image.width, image.height), tint = renderer.moonlightData.color;
        for (let p = 0; p < pixels.data.length; p += 4) for (let c = 0; c < 3; c++) pixels.data[p + c] *= 1 - state.strength + state.strength * tint[c] / 255;
        ctx.putImageData(pixels, 0, 0); renderer.approvedBrand = { key, image };
      }
      const context = renderer.ctx;
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      context.drawImage(renderer.approvedBrand.image, box.x, box.y, box.width, box.height); context.restore();
    }
    function viewportPlane(group, key) {
      const width = renderer.canvas.width, height = renderer.canvas.height;
      if (!group.viewport || group.viewport.width !== width || group.viewport.height !== height) group.viewport = { width, height };
      if (group.viewport[key]) return group.viewport[key];
      const canvas = create(width, height), context = canvas.getContext('2d');
      const original = create(CW, H);
      original.getContext('2d').drawImage(group[key], group.left + inset, group.top);
      const { scale, x, y } = renderer.viewport;
      const left = Math.round(x - inset * scale), top = Math.round(y), right = Math.round(x + (CW - inset) * scale), bottom = Math.round(y + H * scale);
      const dw = right - left, dh = bottom - top;
      context.drawImage(original, 0, 0, CW, H, left, top, dw, dh);
      if (left > 0) context.drawImage(original, 0, 0, 1, H, 0, top, left, dh);
      if (right < width) context.drawImage(original, CW - 1, 0, 1, H, right, top, width - right, dh);
      if (top > 0) context.drawImage(original, 0, 0, CW, 1, left, 0, dw, top);
      if (bottom < height) context.drawImage(original, 0, H - 1, CW, 1, left, bottom, dw, height - bottom);
      if (left > 0 && top > 0) context.drawImage(original, 0, 0, 1, 1, 0, 0, left, top);
      if (right < width && top > 0) context.drawImage(original, CW - 1, 0, 1, 1, right, 0, width - right, top);
      if (left > 0 && bottom < height) context.drawImage(original, 0, H - 1, 1, 1, 0, bottom, left, height - bottom);
      if (right < width && bottom < height) context.drawImage(original, CW - 1, H - 1, 1, 1, right, bottom, width - right, height - bottom);
      group.viewport[key] = canvas;
      return canvas;
    }
    renderer.render = function (now, state, force = false) {
      const rendered = originalRender.call(this, now, state, force);
      if (!rendered) return false;
      const context = this.ctx, { scale, x: offsetX, y: offsetY } = this.viewport;
      context.save(); context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      if (state.strength > 0) for (const group of activeGroups) {
        let opacity = state.strength, pose = {};
        if (group.kind === 'floor') opacity = state.floor;
        else if (group.kind === 'chandelier') opacity = state.chandelier;
        else if (group.kind === 'environment') opacity = state.environment === undefined ? state.chandelier : state.environment;
        else if (group.kind === 'object') pose = { scale: this.scales[group.id], pivot: group.pivot };
        else if (group.kind === 'ball') { pose = ballPose(now); if (!pose) continue; }
        else if (group.kind === 'candleBase') opacity = state.candle;
        else if (group.kind === 'flame') {
          opacity = state.candle;
          pose = { angle: this.leans[group.index] + (this.reducedMotion ? 0 : Math.sin(now * .006 + group.index * 1.7) * .018), pivot: this.flamePivots[group.index] };
        } else if (group.kind === 'moon') {
          const meta = this.moonlightData, progress = clamp(state.shadowProgress);
          pose = { dx: (meta.startTranslation[0] - meta.endTranslation[0]) * (1 - progress), dy: (meta.startTranslation[1] - meta.endTranslation[1]) * (1 - progress) };
        }
        if (!opacity) continue;
        if (group.kind === 'static') {
          context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = opacity;
          context.globalCompositeOperation = 'difference'; context.drawImage(viewportPlane(group, 'negative'), 0, 0);
          context.globalCompositeOperation = 'lighter'; context.drawImage(viewportPlane(group, 'positive'), 0, 0);
          context.restore();
          continue;
        }
        const sprite = { left: group.left, top: group.top, width: group.width, height: group.height };
        this.draw(context, { ...sprite, canvas: group.negative }, { ...pose, opacity, mode: 'difference' });
        this.draw(context, { ...sprite, canvas: group.positive }, { ...pose, opacity, mode: 'lighter' });
      }
      context.restore();
      drawBrand(state);
      return true;
    };
    return renderer;
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { install }; return; }
  const scene = global.ChezTheoScene;
  if (!scene) return;
  const load = scene.load;
  scene.load = async function () { return install(await load.call(this)); };
})(globalThis);
