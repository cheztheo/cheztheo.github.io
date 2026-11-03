(function (global) {
  'use strict';
  const W = 2048;
  const H = 1152;
  const moonlightData = typeof module !== 'undefined' && module.exports ? require('./moonlight-data.js') : global.ChezTheoMoonlightData;
  const shadowMorph = typeof module !== 'undefined' && module.exports ? require('./shadow-morph.js') : global.ChezTheoShadowMorph;
  const BALL_OFFSET = { x: -.065 * W, y: -.058 * H };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const smooth = (low, high, value) => {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
  };

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
      this.viewportBackground = null;
      this.viewportNight = null;
      this.viewportNightProgress = -1;
      this.nightCanvas = this.newCanvas(W, H);
      this.moonlightData = moonlightData || { color: [86, 138, 212], source: 'nightEnd', startTranslation: [-960, -60], endTranslation: [32, 24] };
      this.nightProgress = -1;
      this.computerStrength = -1;
      this.staticCanvas = this.newCanvas(W, H);
      this.sprites = {};
      const groupKeys = ['groupFloor', 'groupChandelier', 'groupEnvironment', 'groupCandle', 'groupFlame0', 'groupFlame1', 'groupFlame2'];
      this.lightGroups = groupKeys.every((key) => images[key]) ? {} : null;
      if (this.lightGroups) for (const key of groupKeys) this.lightGroups[key] = this.cropSprite(images[key]);
      this.ballOffset = this.lightGroups ? { x: 0, y: 0 } : BALL_OFFSET;
      for (const name of ['computerDay', 'computerNight', 'diary', 'painting',
        'tennis', 'floorEmission', 'floorEnvironment', 'haloOne', 'haloTwo',
        'chandelierGlow']) {
        this.sprites[name] = this.cropSprite(images[name],
          name === 'computerNight' || (name === 'computerDay' && !this.lightGroups) ? .75 : 1);
      }
      this.sprites.tennis.sourceImage = images.tennis;
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
      if (this.lightGroups) this.flames = [this.lightGroups.groupFlame0, this.lightGroups.groupFlame1, this.lightGroups.groupFlame2];
      this.flamePivots = [{ x: 1034, y: 382 }, { x: 1094, y: 341 }, { x: 1138, y: 381 }];
      this.flameCenters = [{ x: 1033.36, y: 353.35 }, { x: 1095.73, y: 318.45 }, { x: 1139.60, y: 361.80 }];
      this.tableEnvironmentOpacity = .5;
      this.prepareCandleGroups();
      this.prepareTableEnvironment();
      this.brightenComputerScreen();
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

    prepareCandleGroups() {
      if (!this.lightGroups) return;
      const originals = [this.lightGroups.groupCandle, ...this.flames];
      const left = Math.min(...originals.map(s => s.left));
      const top = Math.min(...originals.map(s => s.top));
      const width = Math.max(...originals.map(s => s.left + s.width)) - left;
      const height = Math.max(...originals.map(s => s.top + s.height)) - top;
      const combined = this.newCanvas(width, height), cx = combined.getContext('2d');
      cx.translate(-left, -top);
      for (const sprite of originals) this.draw(cx, sprite);
      const source = cx.getImageData(0, 0, width, height);
      const parts = Array.from({ length: 4 }, () => cx.createImageData(width, height));
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, alpha = source.data[i + 3] / 255;
        if (!alpha) continue;
        const radii = this.flameCenters.map(p => Math.hypot((left + x - p.x) / 65, (top + y - p.y) / 78));
        const scores = radii.map(r => 1 - smooth(.45, 1.1, r));
        const amount = Math.max(...scores), total = scores.reduce((a, b) => a + b, 0);
        const weights = [1 - amount, ...scores.map(s => total ? s / total * amount : 0)];
        const nearest = radii.indexOf(Math.min(...radii));
        // A flame core belongs to exactly one moving candle, never to its neighbor.
        if (radii[nearest] < .35) { weights.fill(0); weights[nearest + 1] = 1; }
        const density = Math.log1p(-Math.min(alpha, .999999));
        const bytes = weights.map(w => w ? Math.round((1 - Math.exp(density * w)) * 255) : 0);
        const owner = weights.indexOf(Math.max(...weights));
        let other = 1;
        bytes.forEach((a, j) => { if (j !== owner) other *= 1 - a / 255; });
        bytes[owner] = Math.max(bytes[owner], Math.ceil(255 * clamp(1 - (1 - alpha) / Math.max(other, 1e-9), 0, 1)));
        parts.forEach((part, j) => {
          part.data.set(source.data.subarray(i, i + 3), i);
          part.data[i + 3] = bytes[j];
        });
      }
      const sprites = parts.map(part => {
        const canvas = this.newCanvas(width, height);
        canvas.getContext('2d').putImageData(part, 0, 0);
        return { canvas, left, top, width, height, data: part.data };
      });
      this.lightGroups.groupCandle = sprites[0];
      // The complete near glow and flame now share one canvas and one transform.
      this.flames = sprites.slice(1);
      this.candleHaloAttached = true;
    }

    prepareTableEnvironment() {
      if (!this.lightGroups) return;
      const sprite = this.lightGroups.groupEnvironment;
      const context = sprite.canvas.getContext('2d');
      const pixels = context.getImageData(0, 0, sprite.width, sprite.height);
      const ratio = this.tableEnvironmentOpacity / .6;
      const fieldCanvas = this.newCanvas(sprite.width, sprite.height), fieldContext = fieldCanvas.getContext('2d');
      fieldContext.filter = 'blur(32px)'; fieldContext.drawImage(sprite.canvas, 0, 0);
      const field = fieldContext.getImageData(0, 0, sprite.width, sprite.height).data;
      this.tableShadowMap = new Uint8Array(W * H);
      let shadowPixels = 0;
      for (let y = 0; y < sprite.height; y++) for (let x = 0; x < sprite.width; x++) {
        const px = sprite.left + x, py = sprite.top + y, i = (y * sprite.width + x) * 4;
        const radius = Math.hypot((px - 1000) / 350, (py - 674) / 215);
        const surface = 1 - smooth(.94, 1.04, radius);
        const alpha = pixels.data[i + 3], fieldAlpha = field[i + 3];
        // Keep the original cast-shadow cutouts near the book, glass, vase,
        // pen and laptop. Smooth only their surrounding illumination field.
        const castRegion = smooth(755, 790, px) * (1 - smooth(1230, 1270, px)) * smooth(520, 555, py) * (1 - smooth(735, 765, py));
        const deficit = fieldAlpha ? (fieldAlpha - alpha) / fieldAlpha : 0;
        const shadow = castRegion * smooth(.18, .5, deficit);
        if (shadow > .999 && surface > .5) shadowPixels++;
        this.tableShadowMap[py * W + px] = Math.round(shadow * 255);
        pixels.data[i + 3] = alpha * (1 - surface * (1 - ratio));
      }
      context.putImageData(pixels, 0, 0);
      sprite.data = pixels.data;
      this.tableIllumination = { preservedShadowPixels: shadowPixels };
    }

    brightenComputerScreen() {
      const sprite = this.sprites.computerNight;
      const context = sprite.canvas.getContext('2d');
      const pixels = context.getImageData(0, 0, sprite.width, sprite.height);
      const corners = [[1018, 591], [1109, 551], [1127, 617], [1040, 658]];
      for (let y = 0; y < sprite.height; y++) for (let x = 0; x < sprite.width; x++) {
        const px = x + sprite.left, py = y + sprite.top;
        let distance = Infinity;
        corners.forEach(([ax, ay], j) => {
          const [bx, by] = corners[(j + 1) % corners.length];
          distance = Math.min(distance, ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / Math.hypot(bx - ax, by - ay));
        });
        const factor = 1 + .28 * smooth(0, 3, distance), i = (y * sprite.width + x) * 4;
        for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.min(255, pixels.data[i + c] * factor);
      }
      context.putImageData(pixels, 0, 0);
      sprite.data = pixels.data;
    }

    prepareFoliage() {
      if (this.lightGroups) {
        this.flowerBase = this.fullCanvas(this.images.flowers);
        this.leaves = [];
        return;
      }
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
      // Foreground stays transparent and retains its original contained layout.
      context.clearRect(0, 0, W, H);
      context.drawImage(this.images.racket, this.ballOffset.x, this.ballOffset.y, W, H);
      for (const name of ['chandelier', 'floorLamp', 'furniture']) {
        context.drawImage(this.images[name], 0, 0, W, H);
      }
      context.drawImage(this.flowerBase, 0, 0);
      context.drawImage(this.images.glass, 0, 0, W, H);
      context.drawImage(this.images.candlestick, 0, 0, W, H);
    }

    updateViewport() {
      const width = this.canvas.width;
      const height = this.canvas.height;
      const scale = Math.min(width / W, height / H);
      this.viewport = { scale, x: (width - W * scale) / 2, y: (height - H * scale) / 2 };
      if (this.viewportBackground &&
          this.viewportBackground.width === width && this.viewportBackground.height === height) return;
      this.viewportBackground = this.newCanvas(width, height);
      const context = this.viewportBackground.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      const original = this.images.background;
      const bw = original.naturalWidth || original.width;
      const bh = original.naturalHeight || original.height;
      // The new export adds artwork to the sides of the original room. Keep
      // its height tied to that room, so the drawing stays registered to the
      // furniture at every viewport size. Never fit it to the window's width.
      // The -11 logical-pixel registration matches both unchanged cabinet and
      // small-frame strokes in the two uploads; it is independent of clipping.
      const backgroundScale = H * scale / bh;
      const dw = bw * backgroundScale, dh = H * scale;
      const left = (width - dw) / 2 - 11 * scale, top = this.viewport.y;
      context.drawImage(original, left, top, dw, dh);
      this.backgroundViewport = { scale: backgroundScale, x: left, y: top, width: dw, height: dh };
    }

    drawViewportNight(opacity) {
      const width = this.canvas.width;
      const height = this.canvas.height;
      if (!this.viewportNight ||
          this.viewportNight.width !== width || this.viewportNight.height !== height) {
        this.viewportNight = this.newCanvas(width, height);
        this.viewportNightProgress = -1;
      }
      if (this.viewportNightProgress !== this.nightProgress) {
        this.viewportNightProgress = this.nightProgress;
        const context = this.viewportNight.getContext('2d');
        context.clearRect(0, 0, width, height);
        // Integer adjoining rectangles avoid a new antialiased seam. Extend
        // the true edge pixels, including transparent moonlight, to the window.
        const left = Math.round(this.viewport.x);
        const top = Math.round(this.viewport.y);
        const right = Math.round(this.viewport.x + W * this.viewport.scale);
        const bottom = Math.round(this.viewport.y + H * this.viewport.scale);
        const sw = right - left;
        const sh = bottom - top;
        const source = this.nightCanvas;
        // Extend the exact edge alpha. Filtering one-pixel strips makes
        // them translucent and creates light blue sidebars on wide screens.
        context.filter = 'none';
        if (left > 0) context.drawImage(source, 0, 0, 1, H, 0, top, left, sh);
        if (right < width) context.drawImage(source, W - 1, 0, 1, H, right, top, width - right, sh);
        if (top > 0) context.drawImage(source, 0, 0, W, 1, left, 0, sw, top);
        if (bottom < height) context.drawImage(source, 0, H - 1, W, 1, left, bottom, sw, height - bottom);
        if (left > 0 && top > 0) context.drawImage(source, 0, 0, 1, 1, 0, 0, left, top);
        if (right < width && top > 0) context.drawImage(source, W - 1, 0, 1, 1, right, 0, width - right, top);
        if (left > 0 && bottom < height) context.drawImage(source, 0, H - 1, 1, 1, 0, bottom, left, height - bottom);
        if (right < width && bottom < height) {
          context.drawImage(source, W - 1, H - 1, 1, 1, right, bottom, width - right, height - bottom);
        }
        context.filter = 'none';
        context.drawImage(source, 0, 0, W, H, left, top, sw, sh);
      }
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.globalCompositeOperation = 'multiply';
      this.ctx.globalAlpha = opacity;
      this.ctx.drawImage(this.viewportNight, 0, 0);
      this.ctx.restore();
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
      if (sprite.sourceImage) {
        const image = sprite.sourceImage, sx = (image.naturalWidth || image.width) / W, sy = (image.naturalHeight || image.height) / H;
        context.drawImage(image, sprite.left * sx, sprite.top * sy, sprite.width * sx, sprite.height * sy,
          sprite.left - pivot.x, sprite.top - pivot.y, sprite.width, sprite.height);
      } else context.drawImage(sprite.canvas, sprite.left - pivot.x, sprite.top - pivot.y);
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
      const { scale: ratio, x: offsetX, y: offsetY } = this.viewport;
      const left = clamp(Math.floor(Math.min(...corners.map((p) => p.x)) * ratio + offsetX) - 2, 0, this.canvas.width);
      const top = clamp(Math.floor(Math.min(...corners.map((p) => p.y)) * ratio + offsetY) - 2, 0, this.canvas.height);
      const right = clamp(Math.ceil(Math.max(...corners.map((p) => p.x)) * ratio + offsetX) + 2, 0, this.canvas.width);
      const bottom = clamp(Math.ceil(Math.max(...corners.map((p) => p.y)) * ratio + offsetY) + 2, 0, this.canvas.height);
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
      context.setTransform(ratio, 0, 0, ratio, offsetX - left, offsetY - top);
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
      progress = clamp(progress, 0, 1);
      if (progress === this.nightProgress || (progress > 0 && progress < 1 && Math.abs(progress - this.nightProgress) < .0001)) return;
      this.nightProgress = progress;
      const meta = this.moonlightData;
      if (meta.morphMode === 'two-pane-mesh' && shadowMorph) {
        if (!this.shadowMorph) this.shadowMorph = shadowMorph.create(this, meta);
        this.shadowMorph.draw(progress, this.nightCanvas.getContext('2d'));
        return;
      }
      if (!this.originalMoonlight) {
        this.originalMoonlight = this.fullCanvas(this.images[meta.source]);
        const ox = this.originalMoonlight.getContext('2d');
        const pixels = ox.getImageData(0, 0, W, H);
        for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255 - pixels.data[i];
        ox.putImageData(pixels, 0, 0);
      }
      const context = this.nightCanvas.getContext('2d');
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, W, H);
      context.fillStyle = 'rgb(' + meta.color.join(',') + ')';
      context.fillRect(0, 0, W, H);
      const dx = meta.startTranslation[0] * (1 - progress) + meta.endTranslation[0] * progress;
      const dy = meta.startTranslation[1] * (1 - progress) + meta.endTranslation[1] * progress;
      context.globalCompositeOperation = 'destination-out';
      // One original painted footprint at native size, including its paper
      // texture and gap. Only translate; never scale or blend two frames.
      context.drawImage(this.originalMoonlight, dx, dy);
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
      this.updateViewport();
      const { scale: ratio, x: offsetX, y: offsetY } = this.viewport;
      const context = this.ctx;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.drawImage(this.viewportBackground, 0, 0);
      context.setTransform(ratio, 0, 0, ratio, offsetX, offsetY);
      // Read original full-resolution PNGs at the final display transform;
      // avoid a reduced-resolution intermediate for the furniture and racket.
      context.drawImage(this.images.racket, this.ballOffset.x, this.ballOffset.y, W, H);
      for (const name of ['chandelier', 'floorLamp', 'furniture']) context.drawImage(this.images[name], 0, 0, W, H);
      context.drawImage(this.flowerBase, 0, 0);
      context.drawImage(this.images.glass, 0, 0, W, H);
      context.drawImage(this.images.candlestick, 0, 0, W, H);
      const ball = this.sprites.tennis;
      if (ballTime < 0 || ballTime < 1.55) {
        let dx = this.ballOffset.x;
        let dy = this.ballOffset.y;
        if (ballTime >= 0) {
          const firstHeight = Math.min(H * .18, ball.top + this.ballOffset.y - H * .615);
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
      const computerPivot = { x: this.sprites.computer.left + this.sprites.computer.width / 2, y: this.sprites.computer.top + this.sprites.computer.height / 2 };
      if (this.lightGroups) this.draw(context, this.sprites.computerDay, { opacity: .75, scale: this.scales.computer, pivot: computerPivot });
      else {
        this.updateComputer(state.strength);
        this.draw(context, this.sprites.computer, { scale: this.scales.computer });
      }
      this.draw(context, this.sprites.diary, { scale: this.scales.diary });
      this.draw(context, this.sprites.painting, { scale: this.scales.painting });
      for (const leaf of this.leaves) this.draw(context, leaf.sprite, { dx: leaf.dx, dy: leaf.dy });
      if (this.images.brandLogo && !this.approvedNight) {
        const box = this.brandBox || { x: this.canvas.width * 22 / W, y: this.canvas.height * 12 / H, width: this.canvas.width * 75 / W, height: this.canvas.width * 58 / W };
        context.save();context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(this.images.brandLogo, box.x, box.y, box.width, box.height);
        context.restore();
      }
      if (state.strength > 0) {
        this.updateNight(state.shadowProgress);
        this.drawViewportNight(state.strength * (this.lightGroups ? 1 : .9));
      }
      if (this.lightGroups) {
        this.draw(context, this.sprites.computerNight, { opacity: state.strength, scale: this.scales.computer, pivot: computerPivot });
        this.draw(context, this.lightGroups.groupFloor, { opacity: state.floor });
        this.draw(context, this.lightGroups.groupChandelier, { opacity: state.chandelier });
        this.draw(context, this.lightGroups.groupEnvironment, { opacity: state.environment === undefined ? state.chandelier : state.environment });
        this.draw(context, this.lightGroups.groupCandle, { opacity: state.candle * (this.reducedMotion ? 1 : .985 + .015 * Math.sin(now * .0057)) });
      } else if (state.floor > 0) {
        this.draw(context, this.sprites.floorEmission, { opacity: state.floor });
        this.customBlend(this.sprites.floorEnvironment, 'lighter-color', state.floor);
      }
      if (state.candle > 0) {
        const sway = this.reducedMotion ? 0 : Math.sin(now * .0037) * .9;
        const first = this.reducedMotion ? 1 : 1 + .025 * Math.sin(now * .0057) + .012 * Math.sin(now * .0091);
        const second = this.reducedMotion ? 1 : 1 + .025 * Math.sin(now * .0041 + 1.8) + .012 * Math.sin(now * .0083);
        if (!this.lightGroups) {
          this.customBlend(this.sprites.haloOne, 'linear-light', .38 * state.candle * first, { dx: sway });
          this.customBlend(this.sprites.haloTwo, 'linear-light', .31 * state.candle * second, { dx: -sway * .7 });
        }
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
          if (this.lightGroups) this.draw(context, flame, { opacity: state.candle * (this.reducedMotion ? 1 : .985 + .015 * Math.sin(now * .008 + index)), angle: this.leans[index] + tinySway, pivot });
          else this.customBlend(flame, 'vivid-light', state.candle * (.97 + .03 * Math.sin(now * .008 + index)), { angle: this.leans[index] + tinySway, pivot });
        });
      }
      if (!this.lightGroups && state.chandelier > 0) {
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
    const entries = Array.from(document.querySelectorAll('img[data-scene], canvas[data-tiles]'));
    await Promise.all(entries.map((image) => image.dataset.tiles
      ? global.ChezTheoImageTiles.load(image.dataset.tiles, image) : image.decode()));
    const images = Object.fromEntries(entries.map((image) => [image.dataset.scene, image]));
    const makeCanvas = () => document.createElement('canvas');
    const renderer = new RoomRenderer(canvas, images, makeCanvas);
    document.querySelector('#artboard').classList.toggle('is-grouped',Boolean(renderer.lightGroups));
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const scale = global.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const brand = document.querySelector('.brand');
      if (brand) {
        const box = brand.getBoundingClientRect(), pixelRatio = canvas.width / bounds.width;
        renderer.brandBox = { x: (box.left - bounds.left) * pixelRatio, y: (box.top - bounds.top) * pixelRatio, width: box.width * pixelRatio, height: box.height * pixelRatio };
      }
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
