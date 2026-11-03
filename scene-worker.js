'use strict';
// Reuse the already-published modules through their existing offline exports.
// No drawing code or background settings are copied or replaced by this update.
function loadModule(file, dependencies = {}) {
  const box = { exports: {} };
  globalThis.module = box;
  globalThis.require = name => {
    if (!(name in dependencies)) throw new Error('Unknown room dependency: ' + name);
    return dependencies[name];
  };
  try { importScripts(file); }
  finally { delete globalThis.module; delete globalThis.require; }
  return box.exports;
}
const moonlight = loadModule('moonlight-data.js?v=20261103-7');
const shadowMorph = loadModule('shadow-morph.js?v=20261103-7');
const { RoomRenderer } = loadModule('scene-renderer.js?v=20261103-10', {
  './moonlight-data.js': moonlight, './shadow-morph.js': shadowMorph
});
const { install } = loadModule('approved-night.js?v=20261103-10');

let renderer;
self.addEventListener('message', ({ data }) => {
  try {
    if (data.type === 'init') {
      const makeCanvas = (width, height) => new OffscreenCanvas(width, height);
      renderer = new RoomRenderer(makeCanvas(1, 1), data.images, makeCanvas);
      install(renderer);
      self.postMessage({ type: 'ready', flamePivots: renderer.flamePivots, lightGroups: Boolean(renderer.lightGroups) });
      return;
    }
    if (data.type !== 'frame' || !renderer) return;
    if (renderer.canvas.width !== data.width || renderer.canvas.height !== data.height) {
      renderer.canvas.width = data.width;
      renderer.canvas.height = data.height;
      renderer.dirty = true;
    }
    renderer.brandBox = data.brandBox;
    renderer.reducedMotion = data.reducedMotion;
    renderer.setPointer(data.pointer);
    for (const [id, active] of Object.entries(data.hover)) renderer.setHover(id, active);
    if (data.ballStartedAt !== null) renderer.launchBall(data.ballStartedAt);
    const rendered = renderer.render(data.now, data.state);
    const bitmap = rendered ? renderer.canvas.transferToImageBitmap() : null;
    self.postMessage({ type: 'frame', bitmap, width: data.width, height: data.height }, bitmap ? [bitmap] : []);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || String(error) });
  }
});
