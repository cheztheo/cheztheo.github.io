(function (global) {
  'use strict';

  class WorkerRenderer {
    constructor(worker, canvas, metadata, makeFallback) {
      this.worker = worker;
      this.canvas = canvas;
      this.images = {}; // Colour calibration runs inside the worker.
      this.flamePivots = metadata.flamePivots;
      this.lightGroups = metadata.lightGroups;
      this.hover = {};
      this.pointer = null;
      this.ballStartedAt = null;
      this.hasFrame = false;
      this.busy = false;
      this.pending = null;
      this.lastRequest = -Infinity;
      this.makeFallback = makeFallback;
      worker.addEventListener('message', ({ data }) => {
        if (data.type === 'error') { this.fail(new Error(data.message)); return; }
        if (data.type !== 'frame') return;
        if (data.bitmap) {
          // Resize can overtake a frame. Discard that frame instead of scaling
          // its pixels, then draw the newest requested viewport.
          if (data.width === canvas.width && data.height === canvas.height) {
            if (!this.context) this.context = canvas.getContext('2d', { alpha: false, desynchronized: true });
            this.context.drawImage(data.bitmap, 0, 0);
            this.hasFrame = true;
          }
          data.bitmap.close();
        }
        this.busy = false;
        this.flush();
      });
      worker.addEventListener('error', event => {
        event.preventDefault();
        this.fail(new Error(event.message || 'Background rendering stopped.'));
      });
      canvas.dataset.renderThread = 'worker';
    }

    setPointer(point) { this.pointer = point; }
    setHover(id, active) { this.hover[id] = active; }
    leafAt() { return null; } // The approved artwork keeps its foliage fixed.
    launchBall(now) { if (this.ballStartedAt === null) this.ballStartedAt = now; }

    flush() {
      if (!this.worker || this.busy || !this.pending) return;
      const frame = this.pending;
      this.pending = null;
      this.busy = true;
      this.worker.postMessage(frame);
    }

    fail(error) {
      if (!this.worker) return;
      this.worker.terminate();
      this.worker = null;
      this.busy = false;
      this.pending = null;
      console.warn('Using the original room renderer.', error);
      this.canvas.dataset.renderThread = 'main';
      const fallback = this.makeFallback();
      if (fallback && typeof fallback.then === 'function') {
        this.recovering = true;
        fallback.then(renderer => { this.fallback = renderer; this.recovering = false; })
          .catch(error => console.error('The room renderer could not recover.', error));
      } else this.fallback = fallback;
    }

    render(now, state) {
      if (this.recovering) return false;
      if (this.fallback) {
        const renderer = this.fallback;
        renderer.reducedMotion = this.reducedMotion;
        renderer.brandBox = this.brandBox;
        renderer.dirty = renderer.dirty || this.dirty;
        this.dirty = false;
        renderer.setPointer(this.pointer);
        for (const [id, active] of Object.entries(this.hover)) renderer.setHover(id, active);
        if (this.ballStartedAt !== null) renderer.launchBall(this.ballStartedAt);
        const rendered = renderer.render(now, state);
        this.hasFrame = this.hasFrame || rendered;
        return rendered;
      }
      if (now - this.lastRequest < 1000 / 24) return this.hasFrame;
      this.lastRequest = now;
      // Keep only the latest input while a frame is drawing. A slow frame must
      // never build a queue of old pointer positions or old animation times.
      this.pending = { type: 'frame', now, state, pointer: this.pointer,
        hover: { ...this.hover }, ballStartedAt: this.ballStartedAt,
        reducedMotion: this.reducedMotion, brandBox: this.brandBox,
        width: this.canvas.width, height: this.canvas.height };
      this.flush();
      return this.hasFrame;
    }
  }

  function supported() {
    return Boolean(global.Worker && global.OffscreenCanvas && global.createImageBitmap &&
      global.OffscreenCanvas.prototype.transferToImageBitmap);
  }

  async function create(canvas, images, makeFallback) {
    if (!supported()) return null;
    let worker;
    let bitmaps = [];
    try {
      bitmaps = await Promise.all(Object.entries(images).map(async ([key, image]) =>
        [key, await global.createImageBitmap(image)]));
      worker = new global.Worker(new URL('scene-worker.js?v=20261103-1', document.baseURI));
      const metadata = await new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
        };
        const onMessage = ({ data }) => {
          if (data.type === 'ready') { cleanup(); resolve(data); }
          else if (data.type === 'error') { cleanup(); reject(new Error(data.message)); }
        };
        const onError = event => { event.preventDefault(); cleanup(); reject(new Error(event.message)); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Background renderer startup timed out.')); }, 30000);
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({ type: 'init', images: Object.fromEntries(bitmaps) }, bitmaps.map(([, bitmap]) => bitmap));
      });
      return new WorkerRenderer(worker, canvas, metadata, makeFallback);
    } catch (error) {
      if (worker) worker.terminate();
      for (const [, bitmap] of bitmaps) bitmap.close();
      console.warn('Background rendering is unavailable; using the original renderer.', error);
      return null;
    }
  }

  const api = { create, WorkerRenderer };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  global.ChezTheoWorkerRenderer = api;
  const scene = global.ChezTheoScene;
  if (!scene) return;
  const originalLoad = scene.load;
  scene.load = async function () {
    const canvas = document.querySelector('#sceneCanvas');
    let resize;
    const makeFallback = () => {
      if (resize) global.removeEventListener('resize', resize);
      canvas.dataset.renderThread = 'main';
      return originalLoad.call(this);
    };
    if (!supported()) return makeFallback();
    const entries = Array.from(document.querySelectorAll('img[data-scene], canvas[data-tiles]'));
    await Promise.all(entries.map(image => image.dataset.tiles
      ? global.ChezTheoImageTiles.load(image.dataset.tiles, image) : image.decode()));
    const images = Object.fromEntries(entries.map(image => [image.dataset.scene, image]));
    const renderer = await create(canvas, images, makeFallback);
    if (!renderer) return makeFallback();
    document.querySelector('#artboard').classList.toggle('is-grouped', Boolean(renderer.lightGroups));
    resize = () => {
      const bounds = canvas.getBoundingClientRect(), scale = global.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const brand = document.querySelector('.brand');
      if (brand) {
        const box = brand.getBoundingClientRect(), ratio = canvas.width / bounds.width;
        renderer.brandBox = { x: (box.left - bounds.left) * ratio, y: (box.top - bounds.top) * ratio,
          width: box.width * ratio, height: box.height * ratio };
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
