(() => {
  'use strict';
  const fog = document.querySelector('#fogIntro');
  const glass = document.querySelector('#fogGlass');
  const skip = document.querySelector('#fogSkip');
  const editor = document.querySelector('#fogEditor');
  const brushInput = document.querySelector('#fogBrushSize');
  const brushValue = document.querySelector('#fogBrushSizeValue');
  const brushCursor = document.querySelector('#fogBrushCursor');
  if (!fog || !glass) return;

  // The color studio opens directly onto the photograph and its live sidebar.
  if (new URLSearchParams(location.search).has('edit-colors')) { fog.remove(); return; }

  const editMode = new URLSearchParams(location.search).has('dust-edit');
  // Keep new local drafts separate from the author's now-published lettering.
  const storageKey = 'theoland.fog.preset.v2';
  const publishedStrokes = window.theolandDustStrokes || [];
  const validStrokes = value => Array.isArray(value) ? value.slice(0, 200).map(stroke => {
    // Older saved letters used a bare array of points and the original brush size.
    const points = Array.isArray(stroke) ? stroke : stroke?.points;
    const size = Array.isArray(stroke) ? 20.8 : stroke?.size;
    if (!Array.isArray(points) || !points.length || points.length > 5000 ||
      !Number.isFinite(size) || size < 6 || size > 80 ||
      !points.every(point => Array.isArray(point) && point.length === 2 &&
        point.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1))) return null;
    return { points, size };
  }).filter(Boolean) : [];
  function loadStrokes() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return validStrokes(JSON.parse(saved).strokes);
    } catch (_) { /* Private browsing may disable local storage. */ }
    return validStrokes(publishedStrokes);
  }
  let strokes = loadStrokes();

  // A small alpha mask keeps the live page and its real blur underneath.
  const mask = document.createElement('canvas');
  const ctx = mask.getContext('2d');
  if (!ctx) { fog.remove(); return; }
  let active = null;
  let frame = 0;
  let clearing = false;
  let strokeCount = 0;

  function randomFrom(seed) {
    return () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
  }

  function makeDust() {
    const tile = document.createElement('canvas');
    // A 512px tile displayed at 128px makes each grain one quarter as wide.
    tile.width = tile.height = 512;
    const pen = tile.getContext('2d');
    const pixels = pen.createImageData(512, 512);
    const random = randomFrom(20261112);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (random() > .12) continue;
      const light = random() < .46;
      const shade = light ? 248 : 70;
      pixels.data[i] = shade;
      pixels.data[i + 1] = shade;
      pixels.data[i + 2] = shade;
      pixels.data[i + 3] = Math.round((light ? .14 : .08) * 255 + random() * 32);
    }
    pen.putImageData(pixels, 0, 0);
    for (let i = 0; i < 150; i++) {
      const light = random() < .5;
      pen.fillStyle = light ? 'rgba(250,248,241,.16)' : 'rgba(72,78,81,.10)';
      pen.beginPath();
      pen.arc(random() * 512, random() * 512, .5 + random() * 1.8, 0, Math.PI * 2);
      pen.fill();
    }
    glass.style.setProperty('--dust-texture', `url("${tile.toDataURL('image/png')}")`);
  }

  function makeBrush() {
    const stamp = document.createElement('canvas');
    stamp.width = stamp.height = 32;
    const pen = stamp.getContext('2d');
    const pixels = pen.createImageData(32, 32);
    const random = randomFrom(873521);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const distance = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
      const edge = .82 + random() * .16;
      if (distance >= edge) continue;
      const i = (y * 32 + x) * 4;
      // Opaque center reveals the original photo. A rough, translucent rim
      // leaves the last dust grains without a hard circular cutout.
      const fade = Math.max(0, Math.min(1, (edge - distance) / .38));
      const grain = distance < .43 ? 1 : random() < .13 ? .18 : .55 + random() * .45;
      pixels.data[i + 3] = Math.round(255 * fade * grain);
    }
    pen.putImageData(pixels, 0, 0);
    return stamp;
  }
  makeDust();
  const brush = makeBrush();
  const fleckRandom = randomFrom(136831);

  function sizeMask(preserve = false) {
    const old = preserve && mask.width ? document.createElement('canvas') : null;
    if (old) {
      old.width = mask.width;
      old.height = mask.height;
      old.getContext('2d').drawImage(mask, 0, 0);
    }
    // Small handwriting needs enough mask pixels to keep its clear center crisp.
    const scale = Math.min(1, 1800 / Math.max(innerWidth, innerHeight));
    mask.width = Math.max(1, Math.round(innerWidth * scale));
    mask.height = Math.max(1, Math.round(innerHeight * scale));
    ctx.globalCompositeOperation = 'source-over';
    if (old) ctx.drawImage(old, 0, 0, mask.width, mask.height);
    else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, mask.width, mask.height);
      replayStrokes();
    }
    queueMask();
  }

  function queueMask() {
    if (frame || clearing) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const image = `url("${mask.toDataURL('image/png')}")`;
      glass.style.webkitMaskImage = image;
      glass.style.maskImage = image;
    });
  }

  function wipe(x, y, touch, size = touch ? 24 : 20.8) {
    const sx = x * mask.width / innerWidth;
    const sy = y * mask.height / innerHeight;
    // Each pass lifts some dust; the grainy edge remains until rubbed again.
    const radius = size / 2 * mask.width / innerWidth;
    const jitter = radius * .075;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(brush, sx - radius + (fleckRandom() - .5) * jitter,
      sy - radius + (fleckRandom() - .5) * jitter, radius * 2, radius * 2);
    for (let i = 0; i < 7; i++) {
      const angle = fleckRandom() * Math.PI * 2;
      const distance = radius * (.73 + fleckRandom() * .52);
      ctx.fillStyle = `rgba(0,0,0,${.08 + fleckRandom() * .18})`;
      ctx.fillRect(sx + Math.cos(angle) * distance, sy + Math.sin(angle) * distance, .25, .25);
    }
    ctx.globalCompositeOperation = 'source-over';
    queueMask();
  }

  function wipeLine(from, to, touch, size) {
    const step = 3;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(distance / step));
    for (let j = 1; j <= count; j++) {
      const t = j / count;
      wipe(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, touch, size);
    }
  }

  const toUnit = point => [
    Math.max(0, Math.min(1, +(point.x / innerWidth).toFixed(4))),
    Math.max(0, Math.min(1, +(point.y / innerHeight).toFixed(4)))
  ];
  const fromUnit = point => ({ x: point[0] * innerWidth, y: point[1] * innerHeight });
  function replayStrokes() {
    for (const stroke of strokes) {
      const first = fromUnit(stroke.points[0]);
      wipe(first.x, first.y, false, stroke.size);
      for (let i = 1; i < stroke.points.length; i++) {
        wipeLine(fromUnit(stroke.points[i - 1]), fromUnit(stroke.points[i]), false, stroke.size);
      }
    }
  }
  function redrawStrokes() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, mask.width, mask.height);
    replayStrokes();
    queueMask();
  }

  if (editMode && editor) {
    fog.classList.add('is-editing');
    editor.hidden = false;
    const status = document.querySelector('#fogEditorStatus');
    const updateBrush = () => {
      const size = Number(brushInput.value);
      brushValue.value = `${size} px`;
      brushCursor.style.width = `${size}px`;
      brushCursor.style.height = `${size}px`;
    };
    brushInput.addEventListener('input', updateBrush);
    updateBrush();
    editor.addEventListener('pointerdown', event => event.stopPropagation());
    document.querySelector('#fogUndo').addEventListener('click', () => {
      strokes.pop();
      redrawStrokes();
      status.textContent = '已撤销最后一笔；保存后刷新仍能看见。';
    });
    document.querySelector('#fogReset').addEventListener('click', () => {
      strokes = [];
      redrawStrokes();
      status.textContent = '已清空，可以重新写。';
    });
    document.querySelector('#fogSave').addEventListener('click', () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ version: 2, strokes }));
        location.href = location.pathname + location.hash;
      } catch (_) {
        status.textContent = '浏览器未允许保存，请先下载笔迹文件。';
      }
    });
    document.querySelector('#fogExport').addEventListener('click', () => {
      const data = new Blob([JSON.stringify({ version: 2, strokes }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'theoland-dust-lettering.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '笔迹文件已下载，发给我后可固定给所有访客。';
    });
  }

  function clearAll(mode = 'normal') {
    if (clearing) return;
    clearing = true;
    if (frame && mode === 'normal') cancelAnimationFrame(frame);
    if (mode === 'tap') fog.classList.add('is-tap-clearing');
    fog.classList.add('is-clearing');
    const duration = mode === 'tap' ? 2650 : 1150;
    setTimeout(() => fog.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : duration);
  }

  fog.addEventListener('pointerdown', event => {
    if (clearing || event.target === skip || event.target.closest('.fog-editor') ||
      (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    fog.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    active = { id: event.pointerId, last: point, traveled: 0,
      points: editMode ? [toUnit(point)] : null,
      touch: event.pointerType !== 'mouse',
      size: editMode ? Number(brushInput.value) : event.pointerType === 'mouse' ? 20.8 : 24 };
    wipe(point.x, point.y, active.touch, active.size);
  });
  fog.addEventListener('pointermove', event => {
    if (editMode && event.pointerType === 'mouse') {
      brushCursor.hidden = !!event.target.closest('.fog-editor');
      brushCursor.style.left = `${event.clientX}px`;
      brushCursor.style.top = `${event.clientY}px`;
    }
    if (!active || event.pointerId !== active.id) return;
    event.preventDefault();
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    for (const item of events) {
      const point = { x: item.clientX, y: item.clientY };
      const movement = Math.hypot(point.x - active.last.x, point.y - active.last.y);
      if (movement < 2) continue;
      active.traveled += movement;
      wipeLine(active.last, point, active.touch, active.size);
      if (active.points) active.points.push(toUnit(point));
      active.last = point;
    }
  });
  function finish(event) {
    if (!active || event.pointerId !== active.id) return;
    const stroke = active;
    active = null;
    if (event.type === 'pointerup') {
      const end = { x: event.clientX, y: event.clientY };
      wipeLine(stroke.last, end, stroke.touch, stroke.size);
      stroke.traveled += Math.hypot(end.x - stroke.last.x, end.y - stroke.last.y);
      if (editMode) {
        if (stroke.traveled >= 2) stroke.points.push(toUnit(end));
        strokes.push({ points: stroke.points, size: stroke.size });
        document.querySelector('#fogEditorStatus').textContent = `已画 ${strokes.length} 笔；保存后可预览。`;
        return;
      }
      if (stroke.traveled < 14) clearAll('tap');
      else if (++strokeCount >= 3) clearAll('tap');
    } else if (editMode) {
      redrawStrokes();
    }
  }
  fog.addEventListener('pointerup', finish);
  fog.addEventListener('pointercancel', finish);
  fog.addEventListener('pointerleave', () => { if (brushCursor) brushCursor.hidden = true; });
  skip.addEventListener('pointerdown', event => event.stopPropagation());
  skip.addEventListener('click', event => { event.stopPropagation(); clearAll(); });
  fog.addEventListener('keydown', event => {
    if (editMode || event.target !== fog || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    clearAll('tap');
  });
  let resizeFrame = 0;
  addEventListener('resize', () => {
    if (resizeFrame || clearing) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; sizeMask(true); });
  });
  sizeMask();
})();
