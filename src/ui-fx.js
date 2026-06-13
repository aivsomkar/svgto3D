// Callout HUD layout + interactions, styled after the sutera.ch technical look.
// Purely cosmetic / layout: it only reads the DOM and positions overlay elements,
// never touching app state, so the 3D + export pipeline in main.js is unaffected.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const NS = 'http://www.w3.org/2000/svg';

const main = document.querySelector('main');
const viewport = document.getElementById('viewport');
const filmstrip = document.getElementById('filmstrip');
const modules = [...document.querySelectorAll('.module')];

// SVG overlay for connectors / markers / reticles, parented to <main>
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('class', 'connectors');
main.appendChild(svg);

let callout = null;
let litIndex = -1;

// keep modules from collapsing in callout mode
modules.forEach((m, i) => {
  m.querySelector('summary').addEventListener('click', (e) => {
    if (callout) e.preventDefault();
  });
  m.addEventListener('mouseenter', () => { if (callout) { litIndex = i; draw(); } });
  m.addEventListener('mouseleave', () => { if (callout) { litIndex = -1; draw(); } });
});

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// ---------------------------------------------------------------- mode switch
function setMode() {
  const wide = window.innerWidth >= 1024 && window.innerHeight >= 680;
  if (wide !== callout) {
    callout = wide;
    document.body.classList.toggle('callout', wide);
    modules.forEach((m) => (m.open = true)); // always expanded
  }
  if (callout) requestAnimationFrame(draw);
}

// -------------------------------------------------------- draw connectors
function draw() {
  if (!callout) return;
  const mr = main.getBoundingClientRect();
  const vr = viewport.getBoundingClientRect();
  const W = mr.width, H = mr.height;
  const cx = vr.left - mr.left + vr.width / 2;
  const cy = vr.top - mr.top + vr.height / 2;
  const modelD = Math.min(vr.width, vr.height);
  const rMark = clamp(modelD * 0.3, 110, 230);

  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // quadrant crosshairs
  const rBig = modelD * 0.46;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const px = cx + dx * rBig, py = cy + dy * rBig;
    svg.append(
      el('line', { class: 'crosshair', x1: px - 7, y1: py, x2: px + 7, y2: py }),
      el('line', { class: 'crosshair', x1: px, y1: py - 7, x2: px, y2: py + 7 })
    );
  }

  // elbow connectors from each callout card to a marker near the model
  modules.forEach((m, i) => {
    const r = m.getBoundingClientRect();
    const rx = r.left - mr.left, ry = r.top - mr.top;
    const ccx = rx + r.width / 2, ccy = ry + r.height / 2;
    const left = ccx < cx;
    const ax = left ? rx + r.width : rx;
    const ay = ry + 9; // meet near the summary bar
    const dirx = ccx - cx, diry = ccy - cy;
    const len = Math.hypot(dirx, diry) || 1;
    const mx2 = cx + (dirx / len) * rMark;
    const my2 = cy + (diry / len) * rMark;
    const lit = i === litIndex;
    const cls = lit ? 'lit' : '';

    svg.append(el('path', { class: cls, d: `M ${ax} ${ay} H ${mx2} V ${my2}` }));
    svg.append(el('rect', { class: 'marker-out ' + cls, x: mx2 - 4.5, y: my2 - 4.5, width: 9, height: 9 }));
    svg.append(el('rect', { class: 'marker-in ' + cls, x: mx2 - 2, y: my2 - 2, width: 4, height: 4 }));
  });
}

// --------------------------------------------- scroll pans the film strip
filmstrip.addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    filmstrip.scrollLeft += e.deltaY;
  },
  { passive: false }
);

// ---------------------------------------------------------- observers
const ro = new ResizeObserver(() => setMode());
ro.observe(main);
modules.forEach((m) => ro.observe(m)); // redraw when a card's height changes
new MutationObserver(() => callout && draw()).observe(viewport, { attributes: true, attributeFilter: ['style'] });
setMode();
