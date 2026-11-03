(function (global) {
  'use strict';
  const W = 2048, H = 1152;
  const mix = (a, b, t) => a + (b - a) * t;

  function create(renderer, metadata) {
    const masks = [metadata.startSource, metadata.source].map(key => {
      const canvas = renderer.fullCanvas(renderer.images[key]);
      const context = canvas.getContext('2d');
      const image = context.getImageData(0, 0, W, H);
      const alpha = new Uint8Array(W * H);
      for (let p = 0; p < alpha.length; p++) image.data[p * 4 + 3] = alpha[p] = 255 - image.data[p * 4 + 3];
      context.putImageData(image, 0, 0);
      return { canvas, alpha };
    });
    const frame = renderer.nightCanvas.getContext('2d').createImageData(W, H);
    const words = new Uint32Array(frame.data.buffer);
    const color = new Uint8ClampedArray([...metadata.color, 255]);
    const opaque = new Uint32Array(color.buffer)[0];
    const startOffset = metadata.startTranslation || [0, 0], endOffset = metadata.endTranslation || [0, 0];
    const position = (start, end, t) => [mix(start[0] + startOffset[0], end[0] + endOffset[0], t), mix(start[1] + startOffset[1], end[1] + endOffset[1], t)];

    function sample(alpha, x, y) {
      x -= .5; y -= .5;
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      if (ix < 0 || ix >= W - 1 || iy < 0 || iy >= H - 1) return 0;
      const p = iy * W + ix;
      return (alpha[p] * (1 - fx) + alpha[p + 1] * fx) * (1 - fy) + (alpha[p + W] * (1 - fx) + alpha[p + W + 1] * fx) * fy;
    }

    function triangle(destination, start, end, progress) {
      const [a, b, c] = destination;
      const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(determinant) < .001) return;
      const dax = (b[1] - c[1]) / determinant, day = (c[0] - b[0]) / determinant;
      const dbx = (c[1] - a[1]) / determinant, dby = (a[0] - c[0]) / determinant;
      const left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), right = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), bottom = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const s0 = start[0], s1 = start[1], s2 = start[2], e0 = end[0], e1 = end[1], e2 = end[2];
      for (let y = top; y <= bottom; y++) {
        let wa = dax * (left + .5 - c[0]) + day * (y + .5 - c[1]);
        let wb = dbx * (left + .5 - c[0]) + dby * (y + .5 - c[1]);
        for (let x = left; x <= right; x++, wa += dax, wb += dbx) {
          const wc = 1 - wa - wb;
          if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
          const startAlpha = sample(masks[0].alpha, wa * s0[0] + wb * s1[0] + wc * s2[0], wa * s0[1] + wb * s1[1] + wc * s2[1]);
          const endAlpha = sample(masks[1].alpha, wa * e0[0] + wb * e1[0] + wc * e2[0], wa * e0[1] + wb * e1[1] + wc * e2[1]);
          frame.data[(y * W + x) * 4 + 3] = 255 - mix(startAlpha, endAlpha, progress);
        }
      }
    }

    function draw(progress, context) {
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      if (progress <= 0 || progress >= 1) {
        const index = progress <= 0 ? 0 : 1, offset = index ? endOffset : startOffset;
        context.clearRect(0, 0, W, H); context.fillStyle = 'rgb(' + metadata.color.join(',') + ')'; context.fillRect(0, 0, W, H);
        context.globalCompositeOperation = 'destination-out'; context.drawImage(masks[index].canvas, offset[0], offset[1]);
        context.globalCompositeOperation = 'source-over'; return;
      }
      words.fill(opaque);
      for (const pane of metadata.panes) {
        const center = position(pane.startCenter, pane.endCenter, progress);
        const boundary = pane.start.map((point, i) => position(point, pane.end[i], progress));
        for (let i = 0; i < boundary.length; i++) {
          const j = (i + 1) % boundary.length;
          triangle([center, boundary[i], boundary[j]], [pane.startCenter, pane.start[i], pane.start[j]], [pane.endCenter, pane.end[i], pane.end[j]], progress);
        }
      }
      context.putImageData(frame, 0, 0);
    }
    return { draw, paneCount: metadata.panes.length };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChezTheoShadowMorph = api;
})(globalThis);
