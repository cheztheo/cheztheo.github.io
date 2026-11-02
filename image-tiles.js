(function (global) {
  'use strict';

  function assemble(manifest, images, canvas) {
    canvas.width = manifest.width;
    canvas.height = manifest.height;
    const context = canvas.getContext('2d');
    manifest.tiles.forEach((tile, index) => context.drawImage(images[index], tile.x, tile.y));
    return canvas;
  }

  async function load(manifestURL, canvas = document.createElement('canvas')) {
    const url = new URL(manifestURL, document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Artwork tiles could not load: ' + response.status);
    const manifest = await response.json();
    const images = await Promise.all(manifest.tiles.map(async (tile) => {
      const image = new Image();
      image.src = new URL(tile.file, url).href;
      await image.decode();
      return image;
    }));
    return assemble(manifest, images, canvas);
  }

  const api = { assemble, load };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChezTheoImageTiles = api;
})(globalThis);
