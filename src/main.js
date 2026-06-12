import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import helvetiker from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { SUBJECTS } from './subjects.js';

const LOOP_SECONDS = 4;

const MATERIALS = {
  chrome: { color: 0xffffff, metalness: 1, roughness: 0.04 },
  gunmetal: { color: 0x30343c, metalness: 1, roughness: 0.28 },
  porcelain: { color: 0xfafafa, metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 },
  copper: { color: 0xc97b4a, metalness: 1, roughness: 0.12 },
  lens: { color: 0xffe9f2, metalness: 0, roughness: 0.05, transmission: 1, thickness: 1.2, ior: 1.5 },
  'lens dark': { color: 0x3a3340, metalness: 0, roughness: 0.08, transmission: 0.9, thickness: 1.5 },
  brand: { color: 0x4338ca, metalness: 0.85, roughness: 0.22 },
};

const MOTIONS = {
  spin: ['turntable'],
  object: ['settle', 'sway', 'pendulum', 'float', 'push in', 'nod', 'drop in'],
  light: ['light pan', 'glint', 'flicker'],
};

const ENVS = ['studio', 'sunset', 'neon', 'noir'];

const EXPORT_RES = { 512: 512, 1024: 1024, 2048: 2048, '4k': 3840 };

const ALL_MOTIONS = Object.values(MOTIONS).flat();
const ALL_MATERIALS = [...Object.keys(MATERIALS), 'original', 'custom'];

const state = {
  mode: 'svg', // 'svg' | 'text'
  subject: 'star',
  text: '',
  material: 'chrome',
  env: 'studio',
  depth: 0.05,
  bevel: 0.05,
  motion: 'turntable',
  frames: 48,
  size: 96,
  exportRes: '1024',
  svgText: SUBJECTS.star,
  svgName: 'star',
  custom: { color: '#ff4d00', metalness: 1, roughness: 0.2, transmission: 0, clearcoat: 0 },
};

// ----- url state -----

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function parseURL() {
  const p = new URLSearchParams(location.search);
  const num = (key, lo, hi, fallback) => {
    const v = parseFloat(p.get(key));
    return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  };
  if (p.get('t')) {
    state.mode = 'text';
    state.text = p.get('t').slice(0, 24);
    state.subject = null;
    state.svgName = state.text.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'text';
  } else if (SUBJECTS[p.get('s')]) {
    state.subject = p.get('s');
    state.svgName = state.subject;
    state.svgText = SUBJECTS[state.subject];
  }
  if (ALL_MATERIALS.includes(p.get('m'))) state.material = p.get('m');
  if (ALL_MOTIONS.includes(p.get('mo'))) state.motion = p.get('mo');
  if (ENVS.includes(p.get('e'))) state.env = p.get('e');
  state.depth = num('d', 0.01, 0.5, state.depth);
  state.bevel = num('b', 0, 0.1, state.bevel);
  state.frames = Math.round(num('f', 8, 96, state.frames));
  state.size = Math.round(num('z', 32, 256, state.size));
  if (EXPORT_RES[p.get('x')]) state.exportRes = p.get('x');
  if (/^[0-9a-f]{6}$/i.test(p.get('co') || '')) state.custom.color = '#' + p.get('co');
  state.custom.metalness = num('cm', 0, 1, state.custom.metalness);
  state.custom.roughness = num('cr', 0, 1, state.custom.roughness);
  state.custom.transmission = num('cg', 0, 1, state.custom.transmission);
  state.custom.clearcoat = num('ck', 0, 1, state.custom.clearcoat);
}

function updateURL() {
  const p = new URLSearchParams();
  if (state.mode === 'text' && state.text) p.set('t', state.text);
  else if (state.subject) p.set('s', state.subject);
  p.set('m', state.material);
  p.set('mo', state.motion);
  p.set('e', state.env);
  p.set('d', state.depth);
  p.set('b', state.bevel);
  p.set('f', state.frames);
  p.set('z', state.size);
  p.set('x', state.exportRes);
  if (state.material === 'custom') {
    p.set('co', state.custom.color.slice(1));
    p.set('cm', state.custom.metalness);
    p.set('cr', state.custom.roughness);
    p.set('cg', state.custom.transmission);
    p.set('ck', state.custom.clearcoat);
  }
  history.replaceState(null, '', '?' + p.toString());
}

parseURL();

// ----- scene -----

const viewport = document.getElementById('viewport');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000, 0);
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
camera.position.set(0, 0, 3.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;

const pmrem = new THREE.PMREMGenerator(renderer);

const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(2, 3, 4);
scene.add(key);

const root = new THREE.Group();
scene.add(root);

const font = new Font(helvetiker);

let modelGroup = null;
let subColors = [];
let activeMaterials = [];

// ----- environments -----

const envCache = {};

function lightPlane(target, color, intensity, w, h, pos) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(...pos);
  m.lookAt(0, 0, 0);
  target.add(m);
}

function buildEnvScene(name) {
  const s = new THREE.Scene();
  if (name === 'sunset') {
    lightPlane(s, '#ff6a00', 6, 8, 3, [0, -0.5, -6]); // low sun
    lightPlane(s, '#ff9d5c', 2, 10, 10, [0, -4, 0]); // warm bounce
    lightPlane(s, '#4a3b8f', 1.4, 10, 6, [0, 5, 2]); // violet sky
    lightPlane(s, '#ffd9b0', 3, 3, 6, [6, 0, 1]); // warm rim
  } else if (name === 'neon') {
    lightPlane(s, '#ff00aa', 8, 1.2, 8, [-4, 0, 1]);
    lightPlane(s, '#00e5ff', 8, 1.2, 8, [4, 0, 1]);
    lightPlane(s, '#ffffff', 1, 6, 1, [0, 5, 0]);
    lightPlane(s, '#3300ff', 2, 8, 8, [0, 0, -6]);
  } else if (name === 'noir') {
    lightPlane(s, '#ffffff', 7, 2, 7, [-5, 1, 2]);
    lightPlane(s, '#888888', 0.8, 6, 6, [5, 0, -2]);
  }
  return s;
}

function setEnv(name) {
  state.env = name;
  if (!envCache[name]) {
    const src = name === 'studio' ? new RoomEnvironment() : buildEnvScene(name);
    envCache[name] = pmrem.fromScene(src, 0.04).texture;
  }
  scene.environment = envCache[name];
  refreshActive('#envs .btn', name);
  scheduleFilm();
}

// ----- materials -----

function makeMaterial(name) {
  const def =
    name === 'custom'
      ? {
          color: new THREE.Color(state.custom.color),
          metalness: state.custom.metalness,
          roughness: state.custom.roughness,
          transmission: state.custom.transmission,
          clearcoat: state.custom.clearcoat,
          thickness: state.custom.transmission > 0 ? 1.2 : 0,
          ior: 1.5,
        }
      : MATERIALS[name];
  const mat = new THREE.MeshPhysicalMaterial(def);
  mat.envMapIntensity = 1;
  mat.side = THREE.DoubleSide;
  return mat;
}

function assignMaterial(name) {
  if (!modelGroup) return;
  for (const m of activeMaterials) m.dispose();
  if (name === 'original') {
    activeMaterials = modelGroup.children.map((child, i) => {
      const m = new THREE.MeshPhysicalMaterial({
        color: subColors[i],
        metalness: 0.2,
        roughness: 0.35,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
      });
      m.envMapIntensity = 1;
      m.side = THREE.DoubleSide;
      child.material = m;
      return m;
    });
  } else {
    const m = makeMaterial(name);
    for (const child of modelGroup.children) child.material = m;
    activeMaterials = [m];
  }
}

// ----- model building -----

function parseColor(str, fallback) {
  const c = new THREE.Color(0x111111);
  try {
    if (str && !str.startsWith('url(')) c.setStyle(str);
    else if (fallback) c.copy(fallback);
  } catch {
    /* keep fallback color */
  }
  return c;
}

// Extrude a flat triangulated geometry (e.g. SVGLoader.pointsToStroke output)
// into a solid: front + back faces plus walls along boundary edges.
function extrudeFlat(srcGeo, depth) {
  const posAttr = srcGeo.getAttribute('position');
  const idxAttr = srcGeo.getIndex();
  const keyOf = (x, y) => `${Math.round(x * 1e4)}|${Math.round(y * 1e4)}`;
  const seen = new Map();
  const verts = [];
  const remap = new Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const k = keyOf(x, y);
    if (!seen.has(k)) {
      seen.set(k, verts.length);
      verts.push([x, y]);
    }
    remap[i] = seen.get(k);
  }
  const tris = [];
  const triCount = (idxAttr ? idxAttr.count : posAttr.count) / 3;
  const at = (n) => remap[idxAttr ? idxAttr.getX(n) : n];
  for (let t = 0; t < triCount; t++) {
    const a = at(t * 3);
    const b = at(t * 3 + 1);
    const c = at(t * 3 + 2);
    if (a !== b && b !== c && a !== c) tris.push([a, b, c]);
  }
  const edgeCount = new Map();
  const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const [a, b, c] of tris)
    for (const [u, v] of [[a, b], [b, c], [c, a]])
      edgeCount.set(ekey(u, v), (edgeCount.get(ekey(u, v)) || 0) + 1);

  const positions = [];
  const push = (v, z) => positions.push(verts[v][0], verts[v][1], z);
  for (const [a, b, c] of tris) {
    push(a, depth); push(b, depth); push(c, depth);
  }
  for (const [a, b, c] of tris) {
    push(c, 0); push(b, 0); push(a, 0);
  }
  for (const [a, b, c] of tris) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (edgeCount.get(ekey(u, v)) === 1) {
        push(u, 0); push(v, 0); push(v, depth);
        push(u, 0); push(v, depth); push(u, depth);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

function buildModel() {
  let items = [];
  let flipY = true;

  if (state.mode === 'text' && state.text.trim()) {
    const shapes = font.generateShapes(state.text.trim(), 100);
    items = [{ kind: 'fill', shapes, color: new THREE.Color(0x111111) }];
    flipY = false;
  } else {
    const data = new SVGLoader().parse(state.svgText);
    for (const path of data.paths) {
      const style = path.userData?.style ?? {};
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (parseFloat(style.opacity) === 0) continue;
      const hasFill = style.fill && style.fill !== 'none' && parseFloat(style.fillOpacity) !== 0;
      const hasStroke =
        style.stroke && style.stroke !== 'none' &&
        (style.strokeWidth ?? 1) > 0 && parseFloat(style.strokeOpacity) !== 0;
      if (hasFill) {
        const shapes = SVGLoader.createShapes(path);
        if (shapes.length) {
          items.push({ kind: 'fill', shapes, color: parseColor(style.fill, path.color) });
        }
      }
      if (hasStroke) {
        const color = parseColor(style.stroke, path.color);
        for (const sub of path.subPaths) {
          const geo = SVGLoader.pointsToStroke(sub.getPoints(), style);
          if (geo) items.push({ kind: 'stroke', geo, color });
        }
      }
    }
  }
  if (!items.length) return;

  // SVG paint order: later paths draw on top. Coplanar extrusions would hide
  // them, so a path that substantially covers a clearly larger earlier path
  // (a background) gets raised a relief layer.
  const boxes = items.map((item) => {
    let b;
    if (item.kind === 'fill') {
      const g = new THREE.ShapeGeometry(item.shapes);
      g.computeBoundingBox();
      b = g.boundingBox.clone();
      g.dispose();
    } else {
      item.geo.computeBoundingBox();
      b = item.geo.boundingBox.clone();
    }
    return b;
  });
  const area = (b) => (b.max.x - b.min.x) * (b.max.y - b.min.y) || 1;
  const coveredBy = (a, b) => {
    const ix = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
    const iy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
    if (ix <= 0 || iy <= 0) return false;
    return (ix * iy) / area(a) > 0.25 && area(b) > area(a) * 1.5;
  };
  const layers = items.map(() => 0);
  for (let i = 1; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      if (coveredBy(boxes[i], boxes[j])) layers[i] = Math.max(layers[i], layers[j] + 1);
    }
  }

  const bb2 = new THREE.Box3();
  for (const b of boxes) bb2.union(b);
  const size = Math.max(bb2.max.x - bb2.min.x, bb2.max.y - bb2.min.y) || 1;

  const opts = {
    steps: 1,
    depth: state.depth * size * 4,
    bevelEnabled: state.bevel > 0,
    bevelThickness: state.bevel * size,
    bevelSize: state.bevel * size * 0.9,
    bevelSegments: 5,
    curveSegments: 32,
  };

  const reliefUnit = size * Math.min(0.05, Math.max(0.01, state.depth));
  const zSign = flipY ? -1 : 1;
  const geos = items.map((item, i) => {
    let g;
    if (item.kind === 'fill') {
      g = new THREE.ExtrudeGeometry(item.shapes, opts);
    } else {
      g = extrudeFlat(item.geo, opts.depth);
      item.geo.dispose();
    }
    if (layers[i]) g.translate(0, 0, zSign * reliefUnit * layers[i]);
    return g;
  });
  const box = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    box.union(g.boundingBox);
  }
  const c = box.getCenter(new THREE.Vector3());
  for (const g of geos) g.translate(-c.x, -c.y, -c.z);
  const dims = box.getSize(new THREE.Vector3());
  const scale = 1.7 / Math.max(dims.x, dims.y);

  if (modelGroup) {
    root.remove(modelGroup);
    for (const child of modelGroup.children) child.geometry.dispose();
  }
  modelGroup = new THREE.Group();
  subColors = items.map((i) => i.color);
  for (const g of geos) modelGroup.add(new THREE.Mesh(g));
  modelGroup.rotation.x = flipY ? Math.PI : 0;
  modelGroup.scale.setScalar(scale);
  root.add(modelGroup);

  assignMaterial(state.material);
  scheduleFilm();
}

// ----- motion -----

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutElastic = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
function easeOutBounce(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
const gauss = (t, mid, width) => Math.exp(-Math.pow((t - mid) / width, 2));

function applyMotion(t) {
  root.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  scene.environmentRotation.set(0, 0, 0);
  for (const m of activeMaterials) m.envMapIntensity = 1;

  switch (state.motion) {
    case 'turntable':
      root.rotation.y = t * Math.PI * 2;
      break;
    case 'settle':
      root.rotation.y = (1 - easeOutElastic(Math.min(t * 1.4, 1))) * 1.4;
      break;
    case 'sway':
      root.rotation.y = Math.sin(t * Math.PI * 2) * 0.4;
      break;
    case 'pendulum':
      root.rotation.z = Math.sin(t * Math.PI * 2) * 0.3;
      break;
    case 'float':
      root.position.y = Math.sin(t * Math.PI * 2) * 0.07;
      root.rotation.y = Math.sin(t * Math.PI * 2 + 1) * 0.14;
      root.rotation.x = Math.sin(t * Math.PI * 4) * 0.04;
      break;
    case 'push in':
      root.position.z = -2.2 * (1 - easeOutCubic(Math.min(t * 1.6, 1)));
      break;
    case 'nod':
      root.rotation.x = Math.sin(t * Math.PI * 2) * 0.28;
      break;
    case 'drop in':
      root.position.y = 1.4 * (1 - easeOutBounce(Math.min(t * 1.5, 1)));
      break;
    case 'light pan':
      scene.environmentRotation.y = t * Math.PI * 2;
      break;
    case 'glint':
      root.rotation.y = 0.4;
      scene.environmentRotation.y = t * Math.PI;
      for (const m of activeMaterials) m.envMapIntensity = 1 + 2.5 * gauss(t, 0.5, 0.12);
      break;
    case 'flicker':
      for (const m of activeMaterials)
        m.envMapIntensity = 0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 13) * Math.sin(t * Math.PI * 29));
      break;
  }
}

// ----- film -----

const stripEl = document.getElementById('filmstrip');
const infoEl = document.getElementById('filminfo');
let filmTimer = null;
let lastBlob = null;

function scheduleFilm() {
  updateURL();
  clearTimeout(filmTimer);
  filmTimer = setTimeout(renderFilm, 600);
}

function captureFrames(size, frames, onFrame) {
  const prevRatio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  for (let i = 0; i < frames; i++) {
    applyMotion(i / frames);
    renderer.render(scene, camera);
    onFrame(renderer.domElement, i);
  }
  renderer.setPixelRatio(prevRatio);
  resize();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// High-res exports get their own renderer: frames render at up to 2x
// supersampling and downscale to the target size. PMREM textures can't cross
// WebGL contexts, so the environment is regenerated for the export context.
// The main animation loop pauses so it can't fight over scene transforms.
async function withExportRenderer(outSize, fn) {
  const renderSize = Math.min(outSize * 2, 4096);
  const xr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  xr.setPixelRatio(1);
  xr.setSize(renderSize, renderSize, false);
  xr.toneMapping = THREE.ACESFilmicToneMapping;
  xr.setClearColor(0x000000, 0);

  const xpmrem = new THREE.PMREMGenerator(xr);
  const src = state.env === 'studio' ? new RoomEnvironment() : buildEnvScene(state.env);
  const xenv = xpmrem.fromScene(src, 0.04).texture;
  const prevEnv = scene.environment;
  scene.environment = xenv;

  const xcam = camera.clone();
  xcam.aspect = 1;
  xcam.updateProjectionMatrix();

  const down = document.createElement('canvas');
  down.width = outSize;
  down.height = outSize;
  const dctx = down.getContext('2d', { willReadFrequently: true });
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = 'high';

  const renderFrame = (t, poseFn) => {
    applyMotion(t);
    if (poseFn) poseFn();
    xr.render(scene, xcam);
    dctx.clearRect(0, 0, outSize, outSize);
    dctx.drawImage(xr.domElement, 0, 0, outSize, outSize);
    return down;
  };

  renderer.setAnimationLoop(null);
  try {
    return await fn(renderFrame);
  } finally {
    scene.environment = prevEnv;
    xenv.dispose();
    xpmrem.dispose();
    xr.dispose();
    xr.forceContextLoss();
    startMainLoop();
  }
}

function renderFilm() {
  if (!modelGroup) return;
  const { frames, size } = state;

  const sprite = document.createElement('canvas');
  sprite.width = frames * size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');

  stripEl.innerHTML = '';
  captureFrames(size, frames, (canvas, i) => {
    ctx.drawImage(canvas, i * size, 0);
    const thumb = document.createElement('canvas');
    thumb.width = size;
    thumb.height = size;
    thumb.getContext('2d').drawImage(canvas, 0, 0);
    stripEl.appendChild(thumb);
  });

  sprite.toBlob((blob) => {
    lastBlob = blob;
    const kb = blob ? Math.max(1, Math.round(blob.size / 1024)) : 0;
    infoEl.textContent = `${frames} frames · ${size}px · ${kb}KB`;
  }, 'image/png');
}

// ----- export -----

const baseName = () =>
  `${state.svgName}-${state.material.replace(' ', '-')}-${state.frames}f`;

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  const kb = Math.max(1, Math.round(blob.size / 1024));
  infoEl.textContent = `saved ${filename} · ${kb}KB`;
}

async function exportGif() {
  const { frames } = state;
  // gif palettes + players choke past 1k; quality comes from supersampling
  const res = Math.min(EXPORT_RES[state.exportRes], 1024);
  const capped = EXPORT_RES[state.exportRes] > res;
  const delay = (LOOP_SECONDS * 1000) / frames;

  await withExportRenderer(res, async (renderFrame) => {
    const gif = GIFEncoder();
    for (let i = 0; i < frames; i++) {
      const canvas = renderFrame(i / frames);
      const { data } = canvas.getContext('2d').getImageData(0, 0, res, res);
      for (let j = 0; j < data.length; j += 4) {
        if (data[j + 3] < 128) {
          data[j] = data[j + 1] = data[j + 2] = data[j + 3] = 0;
        } else {
          data[j + 3] = 255;
        }
      }
      const palette = quantize(data, 256, { format: 'rgba4444' });
      const index = applyPalette(data, palette, 'rgba4444');
      const transparentIndex = palette.findIndex((p) => p[3] === 0);
      gif.writeFrame(index, res, res, {
        palette,
        delay,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(transparentIndex, 0),
        dispose: 2,
      });
      infoEl.textContent = `encoding gif ${res}px… ${Math.round(((i + 1) / frames) * 100)}%${capped ? ' (gif caps at 1024px)' : ''}`;
      await sleep(0);
    }
    gif.finish();
    download(new Blob([gif.bytes()], { type: 'image/gif' }), `${baseName()}-${res}px.gif`);
  });
}

async function pickVideoConfig(res, fps) {
  const bitrate = Math.min(80_000_000, Math.round(res * res * fps * 0.12));
  const candidates = [
    { codec: 'avc1.640034', mux: 'avc' }, // h264 high 5.2
    { codec: 'avc1.4d0028', mux: 'avc' },
    { codec: 'avc1.42001f', mux: 'avc' },
    { codec: 'hvc1.1.6.L186.B0', mux: 'hevc' }, // hevc level 6 for 4k square
    { codec: 'hvc1.1.6.L153.B0', mux: 'hevc' },
    { codec: 'av01.0.16M.08', mux: 'av1' },
    { codec: 'av01.0.12M.08', mux: 'av1' },
  ];
  for (const { codec, mux } of candidates) {
    const config = { codec, width: res, height: res, bitrate, framerate: fps };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return { config, mux };
    } catch {
      /* unknown codec string on this browser — try next */
    }
  }
  return null;
}

async function exportMp4() {
  if (typeof VideoEncoder === 'undefined') {
    infoEl.textContent = 'mp4 export needs webcodecs (chrome / edge / recent safari)';
    return;
  }
  const { frames } = state;
  let res = EXPORT_RES[state.exportRes];
  const fps = frames / LOOP_SECONDS;
  const loops = 3; // mp4 players rarely loop, so bake a few cycles in

  let picked = await pickVideoConfig(res, fps);
  if (!picked && res > 2160) {
    res = 2160; // square 4k — within h264/hevc encoder limits
    picked = await pickVideoConfig(res, fps);
  }
  if (!picked) {
    infoEl.textContent = `no video encoder supports ${res}px here — try a lower export res`;
    return;
  }

  await withExportRenderer(res, async (renderFrame) => {
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: picked.mux, width: res, height: res },
      fastStart: 'in-memory',
    });
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error(e);
        infoEl.textContent = 'mp4 encode failed — see console';
      },
    });
    encoder.configure(picked.config);

    // h264 has no alpha channel, so composite onto white
    const tmp = document.createElement('canvas');
    tmp.width = res;
    tmp.height = res;
    const tctx = tmp.getContext('2d');

    const total = frames * loops;
    for (let i = 0; i < total; i++) {
      const frame = renderFrame((i % frames) / frames);
      tctx.fillStyle = '#fff';
      tctx.fillRect(0, 0, res, res);
      tctx.drawImage(frame, 0, 0);
      const vf = new VideoFrame(tmp, {
        timestamp: (i * 1e6) / fps,
        duration: 1e6 / fps,
      });
      encoder.encode(vf, { keyFrame: i % frames === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 4) await sleep(5);
      if (i % 4 === 0) {
        infoEl.textContent = `encoding mp4 ${res}px… ${Math.round((i / total) * 100)}%`;
        await sleep(0);
      }
    }
    await encoder.flush();
    muxer.finalize();
    download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), `${baseName()}-${res}px.mp4`);
  });
}

async function exportWebm() {
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
    (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
  );
  if (!mime) {
    infoEl.textContent = 'webm export not supported in this browser';
    return;
  }
  const { frames } = state;
  const res = EXPORT_RES[state.exportRes];
  const fps = frames / LOOP_SECONDS;
  const loops = 2;
  const bitrate = res >= 1920 ? 40_000_000 : res >= 1024 ? 16_000_000 : 8_000_000;

  await withExportRenderer(res, async (renderFrame) => {
    // MediaRecorder keeps the canvas alpha channel, so the webm stays transparent
    const cv = document.createElement('canvas');
    cv.width = res;
    cv.height = res;
    const ctx = cv.getContext('2d');
    ctx.drawImage(renderFrame(0), 0, 0);

    const stream = cv.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((res2) => (rec.onstop = res2));
    rec.start();

    const total = frames * loops;
    for (let i = 0; i < total; i++) {
      const frame = renderFrame((i % frames) / frames);
      ctx.clearRect(0, 0, res, res);
      ctx.drawImage(frame, 0, 0);
      track.requestFrame();
      infoEl.textContent = `recording webm ${res}px… ${Math.round((i / total) * 100)}% (realtime)`;
      await sleep(1000 / fps);
    }
    rec.stop();
    await stopped;
    download(new Blob(chunks, { type: 'video/webm' }), `${baseName()}-${res}px.webm`);
  });
}

function atRest(fn) {
  root.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  fn();
}

function exportGlb() {
  if (!modelGroup) return;
  atRest(() => {
    new GLTFExporter().parse(
      modelGroup,
      (buffer) => download(new Blob([buffer], { type: 'model/gltf-binary' }), `${state.svgName}.glb`),
      (e) => {
        console.error(e);
        infoEl.textContent = 'glb export failed — see console';
      },
      { binary: true }
    );
  });
}

function exportStl() {
  if (!modelGroup) return;
  atRest(() => {
    const data = new STLExporter().parse(modelGroup, { binary: true });
    download(new Blob([data], { type: 'model/stl' }), `${state.svgName}.stl`);
  });
}

async function exportGrid() {
  if (!modelGroup) return;
  const cell = Math.min(EXPORT_RES[state.exportRes], 1024);
  const cols = 3;
  const rows = Math.ceil(ALL_MATERIALS.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * cell;
  sheet.height = rows * cell;
  const sctx = sheet.getContext('2d');

  await withExportRenderer(cell, async (renderFrame) => {
    const pose = () => root.rotation.set(-0.1, 0.65, 0);
    for (const [idx, name] of ALL_MATERIALS.entries()) {
      assignMaterial(name);
      const frame = renderFrame(0, pose);
      const x = (idx % cols) * cell;
      const y = Math.floor(idx / cols) * cell;
      sctx.drawImage(frame, x, y);
      sctx.fillStyle = '#000';
      sctx.font = `${Math.max(14, Math.round(cell * 0.05))}px "IBM Plex Mono", monospace`;
      sctx.fillText(name, x + cell * 0.04, y + cell * 0.95);
      await sleep(0);
    }
    assignMaterial(state.material);
    sheet.toBlob((blob) => download(blob, `${state.svgName}-materials-${cell}px.png`), 'image/png');
  });
}

function bindExport(id, fn) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    infoEl.textContent = 'encoding…';
    try {
      await fn();
    } finally {
      btn.disabled = false;
    }
  });
}

bindExport('export-sprite', () => {
  if (lastBlob) download(lastBlob, `${baseName()}.png`);
});
bindExport('export-gif', exportGif);
bindExport('export-mp4', exportMp4);
bindExport('export-webm', exportWebm);
bindExport('export-glb', exportGlb);
bindExport('export-stl', exportStl);
bindExport('export-grid', exportGrid);

// ----- ui -----

function buttonGroup(el, names, isActive, onPick, swatch = false) {
  for (const name of names) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.dataset.name = name;
    if (swatch) {
      const dot = document.createElement('span');
      dot.className = 'swatch';
      dot.style.background = '#' + new THREE.Color(MATERIALS[name].color).getHexString();
      b.appendChild(dot);
    }
    b.appendChild(document.createTextNode(name));
    if (isActive(name)) b.classList.add('active');
    b.addEventListener('click', () => onPick(name));
    el.appendChild(b);
  }
}

function refreshActive(selector, current) {
  document.querySelectorAll(selector).forEach((b) => {
    b.classList.toggle('active', b.dataset.name === current);
  });
}

buttonGroup(
  document.getElementById('subjects'),
  Object.keys(SUBJECTS),
  (n) => n === state.subject,
  (n) => setSubject(n)
);

buttonGroup(
  document.getElementById('materials'),
  Object.keys(MATERIALS),
  (n) => n === state.material,
  (n) => setMaterial(n),
  true
);

function extraMaterialButton(name, swatchStyle) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.dataset.name = name;
  const dot = document.createElement('span');
  dot.className = 'swatch';
  dot.style.background = swatchStyle;
  btn.append(dot, document.createTextNode(name));
  if (state.material === name) btn.classList.add('active');
  btn.addEventListener('click', () => setMaterial(name));
  document.getElementById('materials').appendChild(btn);
  return dot;
}

extraMaterialButton(
  'original',
  'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
);
const customSwatch = extraMaterialButton('custom', state.custom.color);

buttonGroup(document.getElementById('envs'), ENVS, (n) => n === state.env, (n) => setEnv(n));

buttonGroup(
  document.getElementById('exportres'),
  Object.keys(EXPORT_RES),
  (n) => n === state.exportRes,
  (n) => {
    state.exportRes = n;
    refreshActive('#exportres .btn', n);
    updateURL();
  }
);

for (const [group, names] of Object.entries(MOTIONS)) {
  buttonGroup(
    document.getElementById(`motion-${group}`),
    names,
    (n) => n === state.motion,
    (n) => setMotion(n)
  );
}

const textInput = document.getElementById('textinput');

function setSubject(name) {
  state.mode = 'svg';
  state.subject = name;
  state.svgName = name;
  state.svgText = SUBJECTS[name];
  state.text = '';
  textInput.value = '';
  refreshActive('#subjects .btn', name);
  buildModel();
}

function setMaterial(name) {
  state.material = name;
  assignMaterial(name);
  refreshActive('#materials .btn', name);
  document.getElementById('custom-controls').hidden = name !== 'custom';
  scheduleFilm();
}

function updateCustom(prop, value) {
  state.custom[prop] = value;
  if (state.material !== 'custom') {
    setMaterial('custom');
    return;
  }
  const mat = activeMaterials[0];
  if (prop === 'color') {
    mat.color.set(value);
  } else {
    mat[prop] = value;
    if (prop === 'transmission') mat.thickness = value > 0 ? 1.2 : 0;
  }
  scheduleFilm();
}

document.getElementById('ccolor').addEventListener('input', (e) => {
  customSwatch.style.background = e.target.value;
  updateCustom('color', e.target.value);
});

function setMotion(name) {
  state.motion = name;
  refreshActive('[id^="motion-"] .btn', name);
  scheduleFilm();
}

function bindSlider(id, format, onChange) {
  const input = document.getElementById(id);
  const out = document.getElementById(`${id}-val`);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = format(v);
    onChange(v);
  });
  return { input, out, format };
}

const sliders = {
  depth: bindSlider('depth', (v) => v.toFixed(2), (v) => {
    state.depth = v;
    buildModel();
  }),
  bevel: bindSlider('bevel', (v) => v.toFixed(3), (v) => {
    state.bevel = v;
    buildModel();
  }),
  frames: bindSlider('frames', (v) => `${v}`, (v) => {
    state.frames = v;
    scheduleFilm();
  }),
  size: bindSlider('size', (v) => `${v}px`, (v) => {
    state.size = v;
    scheduleFilm();
  }),
  cmetal: bindSlider('cmetal', (v) => v.toFixed(2), (v) => updateCustom('metalness', v)),
  crough: bindSlider('crough', (v) => v.toFixed(2), (v) => updateCustom('roughness', v)),
  ctrans: bindSlider('ctrans', (v) => v.toFixed(2), (v) => updateCustom('transmission', v)),
  ccoat: bindSlider('ccoat', (v) => v.toFixed(2), (v) => updateCustom('clearcoat', v)),
};

function setSliderValue(name, value) {
  const s = sliders[name];
  s.input.value = value;
  s.out.textContent = s.format(value);
}

function syncControls() {
  setSliderValue('depth', state.depth);
  setSliderValue('bevel', state.bevel);
  setSliderValue('frames', state.frames);
  setSliderValue('size', state.size);
  setSliderValue('cmetal', state.custom.metalness);
  setSliderValue('crough', state.custom.roughness);
  setSliderValue('ctrans', state.custom.transmission);
  setSliderValue('ccoat', state.custom.clearcoat);
  document.getElementById('ccolor').value = state.custom.color;
  customSwatch.style.background = state.custom.color;
  document.getElementById('custom-controls').hidden = state.material !== 'custom';
  if (state.mode === 'text') textInput.value = state.text;
}

document.getElementById('random').addEventListener('click', () => {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  setMaterial(pick(Object.keys(MATERIALS)));
  setMotion(pick(ALL_MOTIONS));
  setEnv(pick(ENVS));
  state.depth = +(0.02 + Math.random() * 0.3).toFixed(3);
  state.bevel = +(Math.random() * 0.08).toFixed(3);
  setSliderValue('depth', state.depth);
  setSliderValue('bevel', state.bevel);
  setSubject(pick(Object.keys(SUBJECTS)));
});

// ----- text → 3d -----

let textTimer = null;
textInput.addEventListener('input', () => {
  clearTimeout(textTimer);
  textTimer = setTimeout(() => {
    const v = textInput.value.trim();
    if (!v) return;
    state.mode = 'text';
    state.text = v;
    state.subject = null;
    state.svgName = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'text';
    refreshActive('#subjects .btn', null);
    buildModel();
  }, 350);
});

// ----- upload / drag-drop -----

function loadSvgFile(file) {
  if (!file || !/\.svg$/i.test(file.name)) return;
  file.text().then((text) => {
    state.mode = 'svg';
    state.svgText = text;
    state.svgName = file.name.replace(/\.svg$/i, '');
    state.subject = null;
    state.text = '';
    textInput.value = '';
    refreshActive('#subjects .btn', null);
    buildModel();
  });
}

document.getElementById('upload').addEventListener('click', () => {
  document.getElementById('file').click();
});
document.getElementById('file').addEventListener('change', (e) => {
  loadSvgFile(e.target.files[0]);
  e.target.value = '';
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  viewport.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) viewport.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('dragging');
  loadSvgFile(e.dataTransfer.files[0]);
});

// ----- camera -----

document.getElementById('resetcam').addEventListener('click', () => {
  camera.position.set(0, 0, 3.2);
  controls.target.set(0, 0, 0);
  controls.update();
  scheduleFilm();
});

// ----- render loop -----

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

function startMainLoop() {
  renderer.setAnimationLoop(() => {
    const t = ((performance.now() / 1000) % LOOP_SECONDS) / LOOP_SECONDS;
    applyMotion(t);
    controls.update();
    renderer.render(scene, camera);
  });
}
startMainLoop();

setEnv(state.env);
syncControls();
buildModel();
