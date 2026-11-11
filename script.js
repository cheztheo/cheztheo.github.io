'use strict';
const room = document.querySelector('#room');
const artboard = document.querySelector('#artboard');
const root = document.documentElement;
const tennisLayer = document.querySelector('#tennisLayer');
const tennisButton = document.querySelector('#tennisButton');
const timeState = document.querySelector('#timeState');
const hint = document.querySelector('#hint');
const dialog = document.querySelector('#projectDialog');
const dialogTitle = document.querySelector('#dialogTitle');
const dialogClose = document.querySelector('#dialogClose');
const scene = window.ChezTheoScene;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const previewOffset = document.body.hasAttribute('data-night-preview')
  ? ChezTheoCycle.timing.day + ChezTheoCycle.timing.dusk : 0;
let startedAt = performance.now() - previewOffset;
let renderer = null;
let previousPhase = '';
let state = ChezTheoCycle.cycleAt(previewOffset);
let pointer = null;
let drag = null;
let suppressDragClick = false;
let ballLaunched = false;
let previousStrength = '';
let previousNightOpacity = '';
let artboardBounds = artboard.getBoundingClientRect();
window.addEventListener('resize', () => { artboardBounds = artboard.getBoundingClientRect(); });

function updateCycle(now) {
  state = ChezTheoCycle.cycleAt(now - startedAt);
  const nightOpacity = (state.strength * .9).toFixed(5);
  const strength = state.strength.toFixed(5);
  if (nightOpacity !== previousNightOpacity) {
    root.style.setProperty('--night-opacity', nightOpacity);
    previousNightOpacity = nightOpacity;
  }
  if (strength !== previousStrength) {
    root.style.setProperty('--night-strength', strength);
    previousStrength = strength;
  }
  if (state.phase !== previousPhase) {
    timeState.textContent = state.phase;
    previousPhase = state.phase;
  }
  if (renderer) {
    renderer.reducedMotion = motionPreference.matches;
    renderer.render(now, state);
    if (renderer.hasFrame !== false) renderer.canvas.classList.add('is-ready');
  }
  requestAnimationFrame(updateCycle);
}
requestAnimationFrame(updateCycle);

scene.load().then((readyRenderer) => {
  renderer = readyRenderer;
  // Keep the immediate trajectory visible above the canvas during handoff.
  if (previewOffset) startedAt = performance.now() - previewOffset;
  if (ballLaunched) renderer.launchBall(performance.now());
}).catch((error) => {
  console.error('The room artwork could not be loaded.', error);
  hint.textContent = '部分图片没有加载完成，请刷新后再试';
  hint.classList.remove('hidden');
});

tennisButton.addEventListener('click', () => {
  if (ballLaunched) return;
  ballLaunched = true;
  // Give immediate visual feedback while the scene renderer is still loading.
  tennisLayer.classList.add('launching');
  tennisButton.disabled = true;
  if (renderer) renderer.launchBall(performance.now());
  hint.textContent = '网球要刷新页面才会回来';
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 4000);
});

document.querySelectorAll('.project').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.id === 'computerButton') { window.location.href = 'photography/'; return; }
    dialogTitle.textContent = button.dataset.project;
    dialog.showModal();
  });
});
dialogClose.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

function roomPoint(event) {
  const bounds = artboardBounds;
  return { u: (event.clientX - bounds.left) / bounds.width,
    v: (event.clientY - bounds.top) / bounds.height, bounds };
}

document.addEventListener('pointermove', (event) => {
  const point = roomPoint(event);
  if (point.u < 0 || point.u > 1 || point.v < 0 || point.v > 1 || dialog.open) {
    pointer = null;
  } else {
    pointer = { x: point.u * 2048, y: point.v * 1152,
      radius: Math.max(25, point.bounds.width * .025) / point.bounds.width * 2048 };
  }
  if (renderer) renderer.setPointer(pointer);
}, { passive: true });
document.documentElement.addEventListener('pointerleave', () => {
  pointer = null;
  if (renderer) renderer.setPointer(null);
});

artboard.addEventListener('pointerdown', (event) => {
  if (!renderer || dialog.open || event.button !== 0) return;
  const point = roomPoint(event);
  const leaf = renderer.leafAt(point.u, point.v);
  if (!leaf) return;
  event.preventDefault();
  drag = { leaf, id: event.pointerId, startX: point.u * 2048, startY: point.v * 1152,
    x: leaf.dx, y: leaf.dy, moved: false };
  scene.isDragging = true;
  for (const id of ['computer', 'diary', 'painting']) scene.setObjectHover(id, false);
  artboard.setPointerCapture(event.pointerId);
});
artboard.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const point = roomPoint(event);
  const dx = point.u * 2048 - drag.startX;
  const dy = point.v * 1152 - drag.startY;
  drag.moved = drag.moved || Math.hypot(dx, dy) > 3;
  renderer.moveLeaf(drag.leaf, drag.x + dx, drag.y + dy);
});
function finishDrag(event) {
  if (!drag || drag.id !== event.pointerId) return;
  suppressDragClick = drag.moved;
  const id = drag.id;
  drag = null;
  scene.isDragging = false;
  if (artboard.hasPointerCapture(id)) artboard.releasePointerCapture(id);
  setTimeout(() => { suppressDragClick = false; }, 0);
}
artboard.addEventListener('pointerup', finishDrag);
artboard.addEventListener('pointercancel', finishDrag);
artboard.addEventListener('click', (event) => {
  if (!suppressDragClick) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
setTimeout(() => hint.classList.add('hidden'), 6000);
