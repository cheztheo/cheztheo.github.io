(() => {
  'use strict';
  const paletteRGB = [[169,45,45],[169,86,45],[145,110,39],[117,117,31],[94,125,33],[66,129,34],[35,133,35],[35,133,68],[34,129,97],[34,129,129],[43,122,161],[45,86,169],[45,45,169],[86,45,169],[128,45,169],[169,45,169],[169,45,128],[169,45,86],[145,75,75],[134,40,40],[177,22,22],[141,107,73],[134,87,40],[168,94,21],[118,118,61],[118,118,35],[118,118,15],[92,121,62],[82,126,38],[71,127,16],[66,128,66],[39,130,39],[16,132,16],[64,125,94],[39,130,84],[16,132,74],[64,125,125],[38,126,126],[16,127,127],[75,110,145],[40,87,134],[22,99,177],[75,75,145],[40,40,134],[22,22,177],[110,75,145],[87,40,134],[99,22,177],[145,75,145],[134,40,134],[177,22,177],[145,75,110],[134,40,87],[177,22,99]];
  const storageKey = 'theoland-preview-place-colors-v3';
  const defaults = { ...placeColors };
  const editor = document.querySelector('#colorEditor');
  const rows = document.querySelector('#colorEditorRows');
  const status = document.querySelector('#colorEditorStatus');
  let target = placeOrder.includes(activePlace) ? activePlace : 'venice';
  const toHex = rgb => '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('');
  const colorHex = color => color[0] === '#' ? color : toHex(color.match(/\d+/g).slice(0, 3).map(Number));
  const rgbText = color => 'RGB ' + [1,3,5].map(i => parseInt(colorHex(color).slice(i,i+2), 16)).join(', ');

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    let changed = false;
    for (const key of placeOrder) if (/^#[0-9a-f]{6}$/i.test(saved[key])) {
      placeColors[key] = saved[key];
      changed = true;
    }
    if (changed) render();
  } catch (_) { /* Browsers may block storage. Live color preview still works. */ }

  function renderRows() {
    rows.innerHTML = placeOrder.map(key => `<div class="color-editor-row" data-place="${key}"><button type="button" class="color-target" data-place="${key}" aria-pressed="${key === target}">${albums[key].name.zh}</button><input type="color" data-place="${key}" value="${colorHex(placeColors[key])}" aria-label="${albums[key].name.zh}颜色"><output>${rgbText(placeColors[key])}</output></div>`).join('');
  }
  function selectTarget(key) {
    target = key;
    rows.querySelectorAll('.color-target').forEach(button => button.setAttribute('aria-pressed', button.dataset.place === key));
  }
  function setPlaceColor(key, hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    placeColors[key] = hex;
    const changed = Object.fromEntries(placeOrder.filter(name => placeColors[name] !== defaults[name]).map(name => [name, placeColors[name]]));
    try { localStorage.setItem(storageKey, JSON.stringify(changed)); }
    catch (_) { status.textContent = '当前浏览器不能保存，离开前请复制 RGB。'; }
    const row = rows.querySelector(`.color-editor-row[data-place="${key}"]`);
    row.querySelector('input').value = hex;
    row.querySelector('output').textContent = rgbText(hex);
    const button = document.querySelector(`.place-list button[data-place="${key}"]`);
    if (button) button.style.setProperty('--place-color', hex);
    status.textContent = `${albums[key].name.zh}：${rgbText(hex)} · 已在本浏览器预览`;
  }
  document.querySelector('#colorPaletteGrid').innerHTML = paletteRGB.map((rgb, index) => `<button type="button" data-index="${index}" style="background:${toHex(rgb)}" aria-label="RGB ${rgb.join(', ')}"></button>`).join('');
  document.querySelector('#colorPaletteGrid').addEventListener('click', event => {
    const button = event.target.closest('button[data-index]');
    if (button) setPlaceColor(target, toHex(paletteRGB[Number(button.dataset.index)]));
  });
  rows.addEventListener('click', event => {
    const button = event.target.closest('.color-target');
    if (button) selectTarget(button.dataset.place);
  });
  rows.addEventListener('input', event => {
    if (!event.target.matches('input[type="color"]')) return;
    selectTarget(event.target.dataset.place);
    setPlaceColor(target, event.target.value);
  });
  function openEditor(open) {
    editor.hidden = !open;
    if (open) renderRows();
  }
  document.querySelector('#colorEditorClose').addEventListener('click', () => openEditor(false));
  document.querySelector('#places').addEventListener('click', event => {
    const button = event.target.closest('.place-list button[data-place]');
    if (button) { target = button.dataset.place; if (!editor.hidden) renderRows(); }
  });
  document.querySelector('#resetColors').addEventListener('click', () => {
    Object.assign(placeColors, defaults);
    try { localStorage.removeItem(storageKey); } catch (_) {}
    render();
    renderRows();
    status.textContent = '已恢复原来的地名颜色';
  });
  document.querySelector('#copyColors').addEventListener('click', async () => {
    const value = placeOrder.map(key => `${albums[key].name.zh}：${rgbText(placeColors[key])}`).join('\n');
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = 'RGB 清单已复制，可以发给我';
    } catch (_) {
      const field = document.createElement('textarea');
      field.value = value;
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      status.textContent = copied ? 'RGB 清单已复制，可以发给我' : '复制失败，请把数值或截图发给我';
    }
  });
  if (new URLSearchParams(location.search).has('edit-colors')) openEditor(true);
})();
