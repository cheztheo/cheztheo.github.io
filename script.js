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
const cursor = document.querySelector('#windCursor');
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

function updateCycle(now) {
  state = ChezTheoCycle.cycleAt(now - startedAt);
  root.style.setProperty('--night-opacity', (state.strength * .9).toFixed(5));
  root.style.setProperty('--night-strength', state.strength.toFixed(5));
  if (state.phase !== previousPhase) {
    timeState.textContent = state.phase;
    previousPhase = state.phase;
  }
  if (renderer) {
    renderer.reducedMotion = motionPreference.matches;
    renderer.render(now, state);
    document.querySelector('#sceneCanvas').classList.add('is-ready');
    const near = state.candle > 0 && pointer && renderer.flamePivots.some((pivot) =>
      Math.hypot(pointer.x - pivot.x, pointer.y - (pivot.y - 22)) < pointer.radius);
    cursor.classList.toggle('near-flame', Boolean(near));
  }
  requestAnimationFrame(updateCycle);
}
requestAnimationFrame(updateCycle);

scene.load().then((readyRenderer) => {
  renderer = readyRenderer;
  if (previewOffset) startedAt = performance.now() - previewOffset;
  if (ballLaunched) renderer.launchBall(performance.now());
}).catch((error) => {
  console.error('The room artwork could not be loaded.', error);
  hint.textContent = '部分图片没有加载完成，请刷新后再试';
  hint.classList.remove('hidden');
});
document.querySelector('#replay')?.addEventListener('click', () => {
  startedAt = performance.now() - previewOffset;
});

tennisButton.addEventListener('click', () => {
  if (ballLaunched) return;
  ballLaunched = true;
  tennisLayer.classList.add('launched');
  tennisButton.disabled = true;
  if (renderer) renderer.launchBall(performance.now());
  hint.textContent = '网球要刷新页面才会回来';
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 4000);
});

document.querySelectorAll('.project').forEach((button) => {
  button.addEventListener('click', () => {
    dialogTitle.textContent = button.dataset.project;
    dialog.showModal();
  });
});
dialogClose.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

function roomPoint(event) {
  const bounds = artboard.getBoundingClientRect();
  return { u: (event.clientX - bounds.left) / bounds.width,
    v: (event.clientY - bounds.top) / bounds.height, bounds };
}

document.addEventListener('pointermove', (event) => {
  cursor.style.left = event.clientX + 'px';
  cursor.style.top = event.clientY + 'px';
  cursor.classList.toggle('visible', event.pointerType !== 'touch');
  const point = roomPoint(event);
  if (point.u < 0 || point.u > 1 || point.v < 0 || point.v > 1 || dialog.open) {
    pointer = null;
  } else {
    pointer = { x: point.u * 2048, y: point.v * 1152,
      radius: Math.max(25, room.clientWidth * .025) / room.clientWidth * 2048 };
  }
  if (renderer) renderer.setPointer(pointer);
});
document.documentElement.addEventListener('pointerleave', () => {
  pointer = null;
  cursor.classList.remove('visible', 'near-flame');
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
