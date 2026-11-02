(function (global) {
  'use strict';
  const W = 2048;
  const H = 1152;
  const BALL_OFFSET = { x: -.065 * W, y: -.058 * H };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  // Nonseparable Lighter Color, Linear Light and Vivid Light are not CSS
  // mix-blend-mode values. Composite their actual source pixels explicitly.
  function blendPixels(backdrop, source, mode, opacity) {
    for (let i = 0; i < backdrop.length; i += 4) {
      const alpha = source[i + 3] / 255 * opacity;
      if (alpha <= 0) continue;
      if (mode === 'lighter-color' &&
          source[i] + source[i + 1] + source[i + 2] <=
          backdrop[i] + backdrop[i + 1] + backdrop[i + 2]) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const b = backdrop[i + channel];
        const s = source[i + channel];
        let mixed = s;
        if (mode === 'linear-light') mixed = clamp(b + 2 * s - 255, 0, 255);
        else if (mode === 'vivid-light') {
          mixed = s < 127.5
            ? (s <= 0 ? 0 : 255 - clamp((255 - b) * 255 / (2 * s), 0, 255))
            : (s >= 255 ? 255 : clamp(b * 255 / (2 * (255 - s)), 0, 255));
        }
        backdrop[i + channel] = b + (mixed - b) * alpha;
      }
    }
    return backdrop;
  }

  class RoomRenderer {
    constructor(canvas, images, makeCanvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
      this.images = images;
      this.makeCanvas = makeCanvas;
      this.targets = { computer: 1, diary: 1, painting: 1 };
      this.scales = { computer: 1, diary: 1, painting: 1 };
      this.pointer = null;
      this.leans = [0, 0, 0];
      this.ballStartedAt = null;
      this.lastFrame = -1000;
      this.dirty = true;
      this.scratch = new Map();
      this.nightCanvas = this.newCanvas(W, H);
      this.nightProgress = -1;
      this.computerStrength = -1;
      this.staticCanvas = this.newCanvas(W, H);
      this.sprites = {};
      for (const name of ['computerDay', 'computerNight', 'diary', 'painting',
        'tennis', 'floorEmission', 'floorEnvironment', 'haloOne', 'haloTwo',
        'chandelierGlow']) {
        this.sprites[name] = this.cropSprite(images[name],
          name.startsWith('computer') ? .75 : 1);
      }
      const day = this.sprites.computerDay;
      const night = this.sprites.computerNight;
      const left = Math.min(day.left, night.left);
      const top = Math.min(day.top, night.top);
      const right = Math.max(day.left + day.width, night.left + night.width);
      const bottom = Math.max(day.top + day.height, night.top + night.height);
      this.computerCanvas = this.newCanvas(right - left, bottom - top);
      this.sprites.computer = { canvas: this.computerCanvas, left, top,
        width: right - left, height: bottom - top };
      this.flames = [
        this.rectSprite(images.flames, [1020, 328, 1050, 386]),
        this.rectSprite(images.flames, [1076, 290, 1112, 346]),
        this.rectSprite(images.flames, [1125, 336, 1152, 387])
      ];
      this.flamePivots = [{ x: 1034, y: 382 }, { x: 1094, y: 341 }, { x: 1138, y: 381 }];
      this.prepareFoliage();
      this.prepareStaticRoom();
    }

    newCanvas(width, height) {
      const canvas = this.makeCanvas(width, height);
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    fullCanvas(image) {
      const canvas = this.newCanvas(W, H);
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, W, H);
      return canvas;
    }

    cropSprite(image, brightness = 1) {
      const full = this.fullCanvas(image);
      const context = full.getContext('2d', { willReadFrequently: true });
      const data = context.getImageData(0, 0, W, H);
      let left = W;
      let top = H;
      let right = 0;
      let bottom = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0, index = y * W * 4; x < W; x += 1, index += 4) {
          if (!data.data[index + 3]) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
          if (brightness !== 1) {
            data.data[index] *= brightness;
            data.data[index + 1] *= brightness;
            data.data[index + 2] *= brightness;
          }
        }
      }
      if (left === W) return null;
      const canvas = this.newCanvas(right - left, bottom - top);
      const crop = canvas.getContext('2d', { willReadFrequently: true });
      crop.putImageData(data, -left, -top);
      const sprite = { canvas, left, top, width: canvas.width, height: canvas.height };
      sprite.data = crop.getImageData(0, 0, canvas.width, canvas.height).data;
      return sprite;
    }

    rectSprite(image, rect) {
      const [left, top, right, bottom] = rect;
      const canvas = this.newCanvas(right - left, bottom - top);
      canvas.getContext('2d').drawImage(image, left, top, right - left, bottom - top,
        0, 0, canvas.width, canvas.height);
      return { canvas, left, top, width: canvas.width, height: canvas.height };
    }

    prepareFoliage() {
      const base = this.fullCanvas(this.images.flowers);
      const context = base.getContext('2d', { willReadFrequently: true });
      const data = context.getImageData(0, 0, W, H);
      // Isolate only green leaf pixels; vase, stems and flowers stay in place.
      const regions = [[750, 342, 897, 462], [893, 294, 1037, 433]];
      const layers = regions.map(() => {
        const canvas = this.newCanvas(W, H);
        const ctx = canvas.getContext('2d');
        return { canvas, ctx, pixels: ctx.createImageData(W, H) };
      });
      for (let y = 0; y < H; y += 1) {
        for (let x = 0, i = y * W * 4; x < W; x += 1, i += 4) {
          if (!data.data[i + 3]) continue;
          const r = data.data[i];
          const g = data.data[i + 1];
          const b = data.data[i + 2];
          if (!(g > r * 1.1 && g > b * 1.25 && g - r > 10)) continue;
          const leaf = regions.findIndex((box) =>
            x >= box[0] && x < box[2] && y >= box[1] && y < box[3]);
          if (leaf < 0) continue;
          layers[leaf].pixels.data.set(data.data.subarray(i, i + 4), i);
          data.data[i + 3] = 0;
        }
      }
      context.putImageData(data, 0, 0);
      this.flowerBase = base;
      this.leaves = layers.map((layer) => {
        layer.ctx.putImageData(layer.pixels, 0, 0);
        return { sprite: this.cropSprite(layer.canvas), dx: 0, dy: 0 };
      }).filter((leaf) => leaf.sprite);
    }

    prepareStaticRoom() {
      const context = this.staticCanvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, W, H);
      context.globalAlpha = .6;
      const background = this.images.background;
      const bw = background.naturalWidth || background.width;
      const bh = background.naturalHeight || background.height;
      context.drawImage(background, 1, 1, bw - 2, bh - 2, 0, 0, W, H);
      context.globalAlpha = 1;
      context.drawImage(this.images.racket, BALL_OFFSET.x, BALL_OFFSET.y, W, H);
      for (const name of ['chandelier', 'floorLamp', 'furniture']) {
        context.drawImage(this.images[name], 0, 0, W, H);
      }
      context.drawImage(this.flowerBase, 0, 0);
      context.drawImage(this.images.glass, 0, 0, W, H);
      context.drawImage(this.images.candlestick, 0, 0, W, H);
    }

    setHover(id, active) {
      if (!(id in this.targets)) return;
      const next = active ? 1.025 : 1;
      if (this.targets[id] === next) return;
      this.targets[id] = next;
      this.dirty = true;
    }

    setPointer(point) { this.pointer = point; }

    launchBall(now) {
      if (this.ballStartedAt !== null) return;
      this.ballStartedAt = now;
      this.dirty = true;
    }

    leafAt(u, v) {
      for (let i = this.leaves.length - 1; i >= 0; i -= 1) {
        const leaf = this.leaves[i];
        const sprite = leaf.sprite;
        const x = Math.floor(u * W - leaf.dx - sprite.left);
        const y = Math.floor(v * H - leaf.dy - sprite.top);
        if (x >= 0 && y >= 0 && x < sprite.width && y < sprite.height &&
            sprite.data[(y * sprite.width + x) * 4 + 3] > 16) return leaf;
      }
      return null;
    }

    moveLeaf(leaf, x, y) {
      leaf.dx = clamp(x, -leaf.sprite.left, W - leaf.sprite.left - leaf.sprite.width);
      leaf.dy = clamp(y, -leaf.sprite.top, H - leaf.sprite.top - leaf.sprite.height);
      this.dirty = true;
    }

    draw(context, sprite, options = {}) {
      if (!sprite || options.opacity === 0) return;
      const pivot = options.pivot || {
        x: sprite.left + sprite.width / 2, y: sprite.top + sprite.height / 2
      };
      context.save();
      context.globalAlpha = options.opacity === undefined ? 1 : options.opacity;
      context.globalCompositeOperation = options.mode || 'source-over';
      context.translate(pivot.x + (options.dx || 0), pivot.y + (options.dy || 0));
      context.rotate(options.angle || 0);
      context.scale(options.scale || 1, options.scale || 1);
      context.drawImage(sprite.canvas, sprite.left - pivot.x, sprite.top - pivot.y);
      context.restore();
    }

    customBlend(sprite, mode, opacity, options = {}) {
      if (!sprite || opacity < .001) return;
      const pivot = options.pivot || {
        x: sprite.left + sprite.width / 2, y: sprite.top + sprite.height / 2
      };
      const cosine = Math.cos(options.angle || 0);
      const sine = Math.sin(options.angle || 0);
      const scale = options.scale || 1;
      const corners = [[sprite.left, sprite.top], [sprite.left + sprite.width, sprite.top],
        [sprite.left, sprite.top + sprite.height], [sprite.left + sprite.width, sprite.top + sprite.height]]
        .map(([x, y]) => {
          const px = (x - pivot.x) * scale;
          const py = (y - pivot.y) * scale;
          return { x: pivot.x + px * cosine - py * sine + (options.dx || 0),
            y: pivot.y + px * sine + py * cosine + (options.dy || 0) };
        });
      const ratio = this.canvas.width / W;
      const left = clamp(Math.floor(Math.min(...corners.map((p) => p.x)) * ratio) - 2, 0, this.canvas.width);
      const top = clamp(Math.floor(Math.min(...corners.map((p) => p.y)) * ratio) - 2, 0, this.canvas.height);
      const right = clamp(Math.ceil(Math.max(...corners.map((p) => p.x)) * ratio) + 2, 0, this.canvas.width);
      const bottom = clamp(Math.ceil(Math.max(...corners.map((p) => p.y)) * ratio) + 2, 0, this.canvas.height);
      const width = right - left;
      const height = bottom - top;
      if (!width || !height) return;
      let scratch = this.scratch.get(sprite);
      if (!scratch) {
        scratch = this.newCanvas(width, height);
        this.scratch.set(sprite, scratch);
      }
      if (scratch.width !== width) scratch.width = width;
      if (scratch.height !== height) scratch.height = height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.setTransform(ratio, 0, 0, ratio, -left, -top);
      this.draw(context, sprite, options);
      context.setTransform(1, 0, 0, 1, 0, 0);
      const source = context.getImageData(0, 0, width, height);
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      const backdrop = this.ctx.getImageData(left, top, width, height);
      blendPixels(backdrop.data, source.data, mode, opacity);
      this.ctx.putImageData(backdrop, left, top);
      this.ctx.restore();
    }

    updateComputer(strength) {
      if (Math.abs(strength - this.computerStrength) < .0005) return;
      this.computerStrength = strength;
      const context = this.computerCanvas.getContext('2d');
      const sprite = this.sprites.computer;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.computerCanvas.width, this.computerCanvas.height);
      context.translate(-sprite.left, -sprite.top);
      this.draw(context, this.sprites.computerDay, { opacity: 1 - strength });
      this.draw(context, this.sprites.computerNight, { opacity: strength, mode: 'lighter' });
      context.setTransform(1, 0, 0, 1, 0, 0);
    }

    updateNight(progress) {
      if (Math.abs(progress - this.nightProgress) < .0004) return;
      this.nightProgress = progress;
      const context = this.nightCanvas.getContext('2d');
      context.clearRect(0, 0, W, H);
      context.fillStyle = '#568ad4';
      const paint = (image, dx, dy, opacity, mode) => {
        dx = Math.round(dx);
        dy = Math.round(dy);
        context.globalAlpha = opacity;
        context.globalCompositeOperation = mode;
        context.drawImage(image, dx, dy, W, H);
        const left = Math.max(0, dx);
        const right = Math.min(W, W + dx);
        const top = Math.max(0, dy);
        const bottom = Math.min(H, H + dy);
        if (left > 0) context.fillRect(0, 0, left, H);
        if (right < W) context.fillRect(right, 0, W - right, H);
        if (top > 0) context.fillRect(left, 0, right - left, top);
        if (bottom < H) context.fillRect(left, bottom, right - left, H - bottom);
      };
      paint(this.images.nightStart, W * .47 * progress, H * .03 * progress, 1 - progress, 'source-over');
      paint(this.images.nightEnd, -W * .47 * (1 - progress), -H * .03 * (1 - progress), progress, 'lighter');
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    }

    render(now, state, force = false) {
      if (!force && now - this.lastFrame < 1000 / 24) return false;
      const dt = this.lastFrame < 0 ? .1 : Math.min(.1, (now - this.lastFrame) / 1000);
      let moving = false;
      for (const id of Object.keys(this.scales)) {
        const difference = this.targets[id] - this.scales[id];
        this.scales[id] = this.reducedMotion || Math.abs(difference) < .00005
          ? this.targets[id] : this.scales[id] + difference * (1 - Math.exp(-dt / .075));
        moving = moving || Math.abs(difference) > .00005;
      }
      const ballTime = this.ballStartedAt === null ? -1 : (now - this.ballStartedAt) / 1000;
      if (!force && !this.dirty && !moving && !state.strength &&
          !(ballTime >= 0 && ballTime < 1.55)) return false;
      this.lastFrame = now;
      this.dirty = false;
      const ratio = this.canvas.width / W;
      const context = this.ctx;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.drawImage(this.staticCanvas, 0, 0);
      const ball = this.sprites.tennis;
      if (ballTime < 0 || ballTime < 1.55) {
        let dx = BALL_OFFSET.x;
        let dy = BALL_OFFSET.y;
        if (ballTime >= 0) {
          const firstHeight = Math.min(H * .18, ball.top + BALL_OFFSET.y - H * .615);
          if (ballTime < .72) {
            const t = ballTime / .72;
            dx += W * .045 * t;
            dy -= Math.max(0, firstHeight) * 4 * t * (1 - t);
          } else {
            const t = Math.min(1, (ballTime - .72) / .6);
            dx += W * (.045 + .15 * t);
            dy -= H * .065 * 4 * t * (1 - t);
            if (ballTime > 1.32) dx += (ballTime - 1.32) * W;
          }
        }
        this.draw(context, ball, { dx, dy, angle: Math.max(0, ballTime) * 1.5 });
      }
      this.updateComputer(state.strength);
      this.draw(context, this.sprites.computer, { scale: this.scales.computer });
      this.draw(context, this.sprites.diary, { scale: this.scales.diary });
      this.draw(context, this.sprites.painting, { scale: this.scales.painting });
      for (const leaf of this.leaves) this.draw(context, leaf.sprite, { dx: leaf.dx, dy: leaf.dy });
      if (state.strength > 0) {
        this.updateNight(state.shadowProgress);
        context.save();
        context.globalCompositeOperation = 'multiply';
        context.globalAlpha = state.strength * .9;
        context.drawImage(this.nightCanvas, 0, 0);
        context.restore();
      }
      if (state.floor > 0) {
        this.draw(context, this.sprites.floorEmission, { opacity: state.floor });
        this.customBlend(this.sprites.floorEnvironment, 'lighter-color', state.floor);
      }
      if (state.candle > 0) {
        const sway = this.reducedMotion ? 0 : Math.sin(now * .0037) * .9;
        const first = this.reducedMotion ? 1 : 1 + .025 * Math.sin(now * .0057) + .012 * Math.sin(now * .0091);
        const second = this.reducedMotion ? 1 : 1 + .025 * Math.sin(now * .0041 + 1.8) + .012 * Math.sin(now * .0083);
        this.customBlend(this.sprites.haloOne, 'linear-light', .38 * state.candle * first, { dx: sway });
        this.customBlend(this.sprites.haloTwo, 'linear-light', .31 * state.candle * second, { dx: -sway * .7 });
        this.flames.forEach((flame, index) => {
          const pivot = this.flamePivots[index];
          let target = 0;
          if (this.pointer) {
            const distance = Math.hypot(this.pointer.x - pivot.x, this.pointer.y - (pivot.y - 22));
            const radius = this.pointer.radius || 52;
            if (distance < radius) {
              target = clamp((pivot.x - this.pointer.x) / radius * 1.1, -.6, .6) * (1 - distance / radius);
            }
          }
          this.leans[index] += (target - this.leans[index]) * (1 - Math.exp(-dt / .09));
          const tinySway = this.reducedMotion ? 0 : Math.sin(now * .006 + index * 1.7) * .018;
          this.customBlend(flame, 'vivid-light',
            state.candle * (.97 + .03 * Math.sin(now * .008 + index)),
            { angle: this.leans[index] + tinySway, pivot });
        });
      }
      if (state.chandelier > 0) {
        this.draw(context, this.sprites.chandelierGlow, { mode: 'overlay', opacity: state.chandelier });
      }
      return true;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RoomRenderer, blendPixels, W, H, BALL_OFFSET };
    return;
  }
  global.ChezTheoScene = {
    renderer: null,
    isDragging: false,
    ready: false,
    hover: { computer: false, diary: false, painting: false },
    setObjectHover(id, active) {
      if (!(id in this.hover)) return;
      this.hover[id] = active;
      if (this.renderer) this.renderer.setHover(id, active);
    }
  };
  global.ChezTheoScene.load = async function () {
    const canvas = document.querySelector('#sceneCanvas');
    const entries = Array.from(document.querySelectorAll('img[data-scene]'));
    await Promise.all(entries.map((image) => image.decode()));
    const images = Object.fromEntries(entries.map((image) => [image.dataset.scene, image]));
    const makeCanvas = () => document.createElement('canvas');
    const renderer = new RoomRenderer(canvas, images, makeCanvas);
    const resize = () => {
      const room = document.querySelector('#room');
      const width = Math.min(1440, Math.max(960,
        Math.round(room.clientWidth * Math.min(global.devicePixelRatio || 1, 1.25))));
      canvas.width = Math.round(width / 16) * 16;
      canvas.height = canvas.width * 9 / 16;
      renderer.dirty = true;
    };
    resize();
    global.addEventListener('resize', resize);
    this.renderer = renderer;
    for (const [id, active] of Object.entries(this.hover)) renderer.setHover(id, active);
    this.ready = true;
    return renderer;
  };
})(globalThis);
