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

function buildModel() {
  let items = [];
  let flipY = true;

  if (state.mode === 'text' && state.text.trim()) {
    const shapes = font.generateShapes(state.text.trim(), 100);
    items = [{ shapes, color: new THREE.Color(0x111111) }];
    flipY = false;
  } else {
    const data = new SVGLoader().parse(state.svgText);
    for (const path of data.paths) {
      const style = path.userData?.style ?? {};
      if (style.fill === 'none') continue;
      const shapes = SVGLoader.createShapes(path);
      if (!shapes.length) continue;
      const color = new THREE.Color(0x111111);
      try {
        if (style.fill) color.setStyle(style.fill);
        else if (path.color) color.copy(path.color);
      } catch {
        /* keep fallback color */
      }
      items.push({ shapes, color });
    }
  }
  if (!items.length) return;

  const flat = new THREE.ShapeGeometry(items.flatMap((i) => i.shapes));
  flat.computeBoundingBox();
  const fb = flat.boundingBox;
  flat.dispose();
  const size = Math.max(fb.max.x - fb.min.x, fb.max.y - fb.min.y) || 1;

  const opts = {
    steps: 1,
    depth: state.depth * size * 4,
    bevelEnabled: state.bevel > 0,
    bevelThickness: state.bevel * size,
    bevelSize: state.bevel * size * 0.9,
    bevelSegments: 5,
    curveSegments: 32,
  };

  const geos = items.map((item) => new THREE.ExtrudeGeometry(item.shapes, opts));
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

function captureFrameCanvases(size, frames) {
  const out = [];
  captureFrames(size, frames, (canvas) => {
    const copy = document.createElement('canvas');
    copy.width = size;
    copy.height = size;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    out.push(copy);
  });
  return out;
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

function exportGif() {
  const { frames, size } = state;
  const gif = GIFEncoder();
  const delay = (LOOP_SECONDS * 1000) / frames;
  const tmp = document.createElement('canvas');
  tmp.width = size;
  tmp.height = size;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });

  captureFrames(size, frames, (canvas) => {
    tctx.clearRect(0, 0, size, size);
    tctx.drawImage(canvas, 0, 0);
    const { data } = tctx.getImageData(0, 0, size, size);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) {
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      } else {
        data[i + 3] = 255;
      }
    }
    const palette = quantize(data, 256, { format: 'rgba4444' });
    const index = applyPalette(data, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((p) => p[3] === 0);
    gif.writeFrame(index, size, size, {
      palette,
      delay,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(transparentIndex, 0),
      dispose: 2,
    });
  });

  gif.finish();
  download(new Blob([gif.bytes()], { type: 'image/gif' }), `${baseName()}.gif`);
}

async function exportMp4() {
  if (typeof VideoEncoder === 'undefined') {
    infoEl.textContent = 'mp4 export needs webcodecs (chrome / edge / recent safari)';
    return;
  }
  const { frames, size } = state;
  const fps = frames / LOOP_SECONDS;
  const loops = 3; // mp4 players rarely loop, so bake a few cycles in

  const frameCanvases = captureFrameCanvases(size, frames);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: size, height: size },
    fastStart: 'in-memory',
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error(e);
      infoEl.textContent = 'mp4 encode failed — see console';
    },
  });
  encoder.configure({
    codec: 'avc1.42001f',
    width: size,
    height: size,
    bitrate: 4_000_000,
    framerate: fps,
  });

  // h264 has no alpha channel, so composite onto white
  const tmp = document.createElement('canvas');
  tmp.width = size;
  tmp.height = size;
  const tctx = tmp.getContext('2d');

  const total = frames * loops;
  for (let i = 0; i < total; i++) {
    tctx.fillStyle = '#fff';
    tctx.fillRect(0, 0, size, size);
    tctx.drawImage(frameCanvases[i % frames], 0, 0);
    const vf = new VideoFrame(tmp, {
      timestamp: (i * 1e6) / fps,
      duration: 1e6 / fps,
    });
    encoder.encode(vf, { keyFrame: i % frames === 0 });
    vf.close();
  }
  await encoder.flush();
  muxer.finalize();
  download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), `${baseName()}.mp4`);
}

async function exportWebm() {
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
  );
  if (!mime) {
    infoEl.textContent = 'webm export not supported in this browser';
    return;
  }
  const { frames, size } = state;
  const fps = frames / LOOP_SECONDS;
  const loops = 2;
  const frameCanvases = captureFrameCanvases(size, frames);

  // MediaRecorder keeps the canvas alpha channel, so the webm stays transparent
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.drawImage(frameCanvases[0], 0, 0);

  const stream = cv.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  rec.start();

  const total = frames * loops;
  infoEl.textContent = `recording webm… (${Math.round((total / fps) * 10) / 10}s, realtime)`;
  for (let i = 0; i < total; i++) {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(frameCanvases[i % frames], 0, 0);
    track.requestFrame();
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await stopped;
  download(new Blob(chunks, { type: 'video/webm' }), `${baseName()}.webm`);
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

function exportGrid() {
  if (!modelGroup) return;
  const cell = 256;
  const cols = 3;
  const rows = Math.ceil(ALL_MATERIALS.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * cell;
  sheet.height = rows * cell;
  const sctx = sheet.getContext('2d');

  const prevRatio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(cell, cell, false);
  camera.aspect = 1;
  camera.updateProjectionMatrix();

  ALL_MATERIALS.forEach((name, idx) => {
    assignMaterial(name);
    root.rotation.set(-0.1, 0.65, 0);
    root.position.set(0, 0, 0);
    renderer.render(scene, camera);
    const x = (idx % cols) * cell;
    const y = Math.floor(idx / cols) * cell;
    sctx.drawImage(renderer.domElement, x, y);
    sctx.fillStyle = '#000';
    sctx.font = '14px "IBM Plex Mono", monospace';
    sctx.fillText(name, x + 10, y + cell - 12);
  });

  assignMaterial(state.material);
  renderer.setPixelRatio(prevRatio);
  resize();
  sheet.toBlob((blob) => download(blob, `${state.svgName}-materials.png`), 'image/png');
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

renderer.setAnimationLoop(() => {
  const t = ((performance.now() / 1000) % LOOP_SECONDS) / LOOP_SECONDS;
  applyMotion(t);
  controls.update();
  renderer.render(scene, camera);
});

setEnv(state.env);
syncControls();
buildModel();
