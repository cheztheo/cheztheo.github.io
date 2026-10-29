const room = document.querySelector('#room');
const root = document.documentElement;
const nightWash = document.querySelector('#nightWash');
const floorLight = document.querySelector('#floorLight');
const chandelierLight = document.querySelector('#chandelierLight');
const candleZone = document.querySelector('#candleZone');
const tennisLayer = document.querySelector('#tennisLayer');
const tennisButton = document.querySelector('#tennisButton');
const timeState = document.querySelector('#timeState');
const hint = document.querySelector('#hint');
const dialog = document.querySelector('#projectDialog');
const dialogTitle = document.querySelector('#dialogTitle');
const dialogClose = document.querySelector('#dialogClose');

const DAY_MS = 120_000;
const DUSK_MS = 60_000;
const NIGHT_MS = 120_000;
const CYCLE_MS = DAY_MS + DUSK_MS + NIGHT_MS;
const startedAt = performance.now();
let previousPhase = '';

function setLit(element, lit) {
  element.classList.toggle('on', lit);
}

function updateCycle(now) {
  const elapsed = (now - startedAt) % CYCLE_MS;
  let phase = '白天';
  let nightStrength = 0;
  let nightElapsed = -1;

  if (elapsed >= DAY_MS && elapsed < DAY_MS + DUSK_MS) {
    phase = '黄昏';
    nightStrength = (elapsed - DAY_MS) / DUSK_MS;
  } else if (elapsed >= DAY_MS + DUSK_MS) {
    phase = '夜晚';
    nightStrength = 1;
    nightElapsed = elapsed - DAY_MS - DUSK_MS;
  }

  root.style.setProperty('--night-opacity', (nightStrength * .9).toFixed(4));
  setLit(floorLight, nightElapsed >= 0);
  setLit(candleZone, nightElapsed >= 1_000);
  setLit(chandelierLight, nightElapsed >= 2_000);

  if (phase !== previousPhase) {
    timeState.textContent = phase;
    previousPhase = phase;
  }
  requestAnimationFrame(updateCycle);
}
requestAnimationFrame(updateCycle);

tennisButton.addEventListener('click', () => {
  if (tennisLayer.classList.contains('launched')) return;
  tennisLayer.classList.add('launched');
  tennisButton.disabled = true;
  hint.textContent = '网球要刷新页面才会回来';
  hint.classList.remove('hidden');
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

function bendFlames(clientX, clientY) {
  if (!candleZone.classList.contains('on')) return;
  const bounds = candleZone.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height * .28;
  const distance = Math.hypot(clientX - centerX, clientY - centerY);

  if (distance < Math.max(95, room.clientWidth * .1)) {
    const lean = Math.max(-34, Math.min(34, (centerX - clientX) / Math.max(2.5, room.clientWidth * .0028)));
    candleZone.style.setProperty('--lean', `${lean.toFixed(1)}deg`);
  } else {
    candleZone.style.setProperty('--lean', '0deg');
  }
}

room.addEventListener('pointermove', (event) => bendFlames(event.clientX, event.clientY));
room.addEventListener('pointerleave', () => candleZone.style.setProperty('--lean', '0deg'));

setTimeout(() => hint.classList.add('hidden'), 6000);
