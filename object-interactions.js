(function (global) {
  'use strict';

  // One-time alpha analysis. Fill only enclosed holes (e.g. the inside of
  // a picture frame); transparent space outside the silhouette stays inert.
  function createSilhouette(imageData, threshold = 16) {
    const { width: imageWidth, height: imageHeight, data } = imageData;
    let left = imageWidth;
    let top = imageHeight;
    let right = -1;
    let bottom = -1;

    for (let y = 0; y < imageHeight; y += 1) {
      for (let x = 0, index = (y * imageWidth) * 4 + 3;
           x < imageWidth; x += 1, index += 4) {
        if (data[index] <= threshold) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left) return null;

    const width = right - left + 1;
    const height = bottom - top + 1;
    const paddedWidth = width + 2;
    const paddedHeight = height + 2;
    const padded = new Uint8Array(paddedWidth * paddedHeight);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[((y + top) * imageWidth + x + left) * 4 + 3];
        padded[(y + 1) * paddedWidth + x + 1] = alpha > threshold ? 1 : 0;
      }
    }

    // Mark the exterior background, leaving enclosed transparent holes inside.
    const queue = new Int32Array(padded.length);
    let head = 0;
    let tail = 1;
    padded[0] = 2;
    queue[0] = 0;
    const visit = (index) => {
      if (padded[index] !== 0) return;
      padded[index] = 2;
      queue[tail++] = index;
    };
    while (head < tail) {
      const index = queue[head++];
      const x = index % paddedWidth;
      const y = Math.floor(index / paddedWidth);
      if (x > 0) visit(index - 1);
      if (x + 1 < paddedWidth) visit(index + 1);
      if (y > 0) visit(index - paddedWidth);
      if (y + 1 < paddedHeight) visit(index + paddedWidth);
    }

    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        pixels[y * width + x] = padded[(y + 1) * paddedWidth + x + 1] === 2 ? 0 : 1;
      }
    }
    return { imageWidth, imageHeight, left, top, width, height, pixels };
  }

  function containsPoint(mask, u, v) {
    if (!mask || !Number.isFinite(u) || !Number.isFinite(v) ||
        u < 0 || v < 0 || u >= 1 || v >= 1) return false;
    const x = Math.floor(u * mask.imageWidth) - mask.left;
    const y = Math.floor(v * mask.imageHeight) - mask.top;
    return x >= 0 && y >= 0 && x < mask.width && y < mask.height &&
      mask.pixels[y * mask.width + x] === 1;
  }

  // Keep the image-mask calculation usable for offline verification as well.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSilhouette, containsPoint };
    return;
  }
  if (typeof document === 'undefined') return;
  global.ChezTheoHitTest = { createSilhouette, containsPoint };

  const artboard = document.querySelector('#artboard');
  const dialog = document.querySelector('#projectDialog');
  if (!artboard) return;

  // Explicit whitelist: other layers never receive the hover transform.
  const objects = [
    { id: 'computer', image: '#computerDayLayer', visual: '#computerVisual', control: '#computerButton' },
    { id: 'diary', image: '#diaryVisual', visual: '#diaryVisual', control: '#diaryButton' },
    { id: 'painting', image: '#paintingVisual', visual: '#paintingVisual', control: '#paintingButton' },
    { id: 'tennis', image: '#tennisLayer', visual: '#tennisLayer', control: '#tennisButton',
      zoom: false, offsetU: -.065, offsetV: -.058 }
  ].map((object) => ({
    ...object,
    image: document.querySelector(object.image),
    visual: document.querySelector(object.visual),
    control: document.querySelector(object.control),
    mask: null
  })).filter((object) => object.image && object.visual && object.control);

  let hoveredObject = null;
  let focusedObject = null;

  function renderHover() {
    for (const object of objects) {
      const keyboardFocus = object === focusedObject && object.control.matches(':focus-visible');
      object.visual.classList.toggle('is-hovered', object.zoom !== false && !dialog.open &&
        (object === hoveredObject || keyboardFocus));
      if (global.ChezTheoScene) {
        global.ChezTheoScene.setObjectHover(object.id, object.zoom !== false && !dialog.open &&
          (object === hoveredObject || keyboardFocus));
      }
    }
    artboard.classList.toggle('has-clickable-object', !dialog.open && Boolean(hoveredObject));
  }

  function objectAt(clientX, clientY) {
    const bounds = artboard.getBoundingClientRect();
    if (!bounds.width || !bounds.height || dialog.open ||
        (global.ChezTheoScene && global.ChezTheoScene.isDragging)) return null;
    const u = (clientX - bounds.left) / bounds.width;
    const v = (clientY - bounds.top) / bounds.height;
    // Coordinates always use the original artboard, independent of zoom.
    const renderer = global.ChezTheoScene && global.ChezTheoScene.renderer;
    if (renderer && renderer.leafAt(u, v)) return null;
    return objects.find((object) => !object.control.disabled &&
      containsPoint(object.mask, u - (object.offsetU || 0), v - (object.offsetV || 0))) || null;
  }

  for (const object of objects) {
    object.control.addEventListener('focus', () => {
      focusedObject = object;
      renderHover();
    });
    object.control.addEventListener('blur', () => {
      if (focusedObject === object) focusedObject = null;
      renderHover();
    });
  }

  artboard.addEventListener('pointermove', (event) => {
    const next = event.pointerType === 'touch' ? null : objectAt(event.clientX, event.clientY);
    if (next === hoveredObject) return;
    hoveredObject = next;
    renderHover();
  });
  artboard.addEventListener('pointerleave', () => {
    hoveredObject = null;
    renderHover();
  });
  artboard.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    const object = objectAt(event.clientX, event.clientY);
    if (!object) return;
    object.control.click();
    hoveredObject = null;
    renderHover();
  });
  global.addEventListener('resize', () => {
    hoveredObject = null;
    renderHover();
  });
  dialog.addEventListener('close', renderHover);

  Promise.allSettled(objects.map(async (object) => {
    await object.image.decode();
    const scale = Math.min(1, 2048 / object.image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(object.image.naturalWidth * scale);
    canvas.height = Math.round(object.image.naturalHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(object.image, 0, 0, canvas.width, canvas.height);
    object.mask = createSilhouette(context.getImageData(0, 0, canvas.width, canvas.height));
    if (object.mask) {
      const mask = object.mask;
      const x = (mask.left + mask.width / 2) / mask.imageWidth * 100;
      const y = (mask.top + mask.height / 2) / mask.imageHeight * 100;
      object.visual.style.transformOrigin = `${x}% ${y}%`;
    }
    canvas.width = 0;
    canvas.height = 0;
  })).then((results) => {
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Could not read the silhouette for ${objects[index].id}.`, result.reason);
      }
    });
  });
})(globalThis);
