(() => {
  'use strict';
  const fog = document.querySelector('#fogIntro');
  const glass = document.querySelector('#fogGlass');
  const skip = document.querySelector('#fogSkip');
  if (!fog || !glass) return;

  // A small alpha mask keeps the live page and its real blur underneath.
  const mask = document.createElement('canvas');
  const ctx = mask.getContext('2d');
  if (!ctx) { fog.remove(); return; }
  let opacity = 1;
  let active = null;
  let frame = 0;
  let clearing = false;

  function sizeMask(preserve = false) {
    const old = preserve && mask.width ? document.createElement('canvas') : null;
    if (old) {
      old.width = mask.width;
      old.height = mask.height;
      old.getContext('2d').drawImage(mask, 0, 0);
    }
    const scale = Math.min(.6, 850 / Math.max(innerWidth, innerHeight));
    mask.width = Math.max(1, Math.round(innerWidth * scale));
    mask.height = Math.max(1, Math.round(innerHeight * scale));
    ctx.globalCompositeOperation = 'source-over';
    if (old) ctx.drawImage(old, 0, 0, mask.width, mask.height);
    else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, mask.width, mask.height);
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

  function wipe(x, y, touch) {
    const sx = x * mask.width / innerWidth;
    const sy = y * mask.height / innerHeight;
    // The fully clear center is about a fingertip wide, with a soft edge.
    const radius = (touch ? 15 : 13) * mask.width / innerWidth;
    const edge = ctx.createRadialGradient(sx, sy, radius * .18, sx, sy, radius);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(.64, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = edge;
    ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
    ctx.globalCompositeOperation = 'source-over';
    queueMask();
  }

  function wipeLine(from, to, touch) {
    const step = 5;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(distance / step));
    for (let j = 1; j <= count; j++) {
      const t = j / count;
      wipe(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, touch);
    }
  }

  function clearAll() {
    if (clearing) return;
    clearing = true;
    if (frame) cancelAnimationFrame(frame);
    fog.classList.add('is-clearing');
    setTimeout(() => fog.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 1150);
  }

  function fadeBy(amount) {
    if (clearing) return;
    opacity = Math.max(0, opacity - amount);
    glass.style.setProperty('--fog-opacity', opacity.toFixed(2));
    if (opacity <= .08) clearAll();
  }

  function isZ(points) {
    if (points.length < 4) return false;
    const a = points[0], d = points[points.length - 1];
    const minX = Math.max(75, innerWidth * .12);
    const minY = Math.max(55, innerHeight * .10);
    const top = points.map((point, index) => ({ ...point, index }))
      .filter(point => point.y < a.y + minY * .65);
    if (!top.length) return false;
    const b = top.reduce((best, point) => point.x > best.x ? point : best);
    const lower = points.slice(b.index + 1).filter(point => point.y > b.y + minY * .75);
    if (!lower.length) return false;
    const c = lower.reduce((best, point) => point.x < best.x ? point : best);
    return b.x - a.x > minX && b.x - c.x > minX &&
      d.x - c.x > minX && c.y - b.y > minY &&
      Math.abs(b.y - a.y) < minY * .8 &&
      Math.abs(d.y - c.y) < minY * .8;
  }

  fog.addEventListener('pointerdown', event => {
    if (clearing || event.target === skip || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    fog.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    active = { id: event.pointerId, start: point, last: point, points: [point],
      touch: event.pointerType !== 'mouse' };
    wipe(point.x, point.y, active.touch);
  });
  fog.addEventListener('pointermove', event => {
    if (!active || event.pointerId !== active.id) return;
    event.preventDefault();
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    for (const item of events) {
      const point = { x: item.clientX, y: item.clientY };
      if (Math.hypot(point.x - active.last.x, point.y - active.last.y) < 2) continue;
      wipeLine(active.last, point, active.touch);
      active.points.push(point);
      active.last = point;
    }
  });
  function finish(event) {
    if (!active || event.pointerId !== active.id) return;
    const stroke = active;
    active = null;
    if (event.type === 'pointerup') {
      const end = { x: event.clientX, y: event.clientY };
      wipeLine(stroke.last, end, stroke.touch);
      stroke.points.push(end);
      if (isZ(stroke.points)) clearAll();
      else if (Math.hypot(end.x - stroke.start.x, end.y - stroke.start.y) < 14) fadeBy(.16);
    }
  }
  fog.addEventListener('pointerup', finish);
  fog.addEventListener('pointercancel', finish);
  skip.addEventListener('pointerdown', event => event.stopPropagation());
  skip.addEventListener('click', event => { event.stopPropagation(); clearAll(); });
  fog.addEventListener('keydown', event => {
    if (event.target !== fog || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    fadeBy(.2);
  });
  let resizeFrame = 0;
  addEventListener('resize', () => {
    if (resizeFrame || clearing) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; sizeMask(true); });
  });
  sizeMask();
})();
