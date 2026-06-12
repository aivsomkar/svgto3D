import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
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

const state = {
  subject: 'star',
  material: 'chrome',
  depth: 0.05,
  bevel: 0.05,
  motion: 'turntable',
  frames: 48,
  size: 96,
  svgText: SUBJECTS.star,
  svgName: 'star',
  custom: { color: '#ff4d00', metalness: 1, roughness: 0.2, transmission: 0, clearcoat: 0 },
};

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
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(2, 3, 4);
scene.add(key);

const root = new THREE.Group();
scene.add(root);

let mesh = null;
let material = makeMaterial(state.material);

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

// ----- model building -----

function buildModel() {
  const data = new SVGLoader().parse(state.svgText);
  const shapes = [];
  for (const path of data.paths) shapes.push(...SVGLoader.createShapes(path));
  if (!shapes.length) return;

  const flat = new THREE.ShapeGeometry(shapes);
  flat.computeBoundingBox();
  const bb = flat.boundingBox;
  flat.dispose();
  const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) || 1;

  const geo = new THREE.ExtrudeGeometry(shapes, {
    steps: 1,
    depth: state.depth * size * 4,
    bevelEnabled: state.bevel > 0,
    bevelThickness: state.bevel * size,
    bevelSize: state.bevel * size * 0.9,
    bevelSegments: 5,
    curveSegments: 32,
  });
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  const dims = geo.boundingBox.getSize(new THREE.Vector3());
  const scale = 1.7 / Math.max(dims.x, dims.y);

  if (mesh) {
    root.remove(mesh);
    mesh.geometry.dispose();
  }
  mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = Math.PI; // svg y-axis points down
  mesh.scale.setScalar(scale);
  root.add(mesh);
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
  material.envMapIntensity = 1;

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
      material.envMapIntensity = 1 + 2.5 * gauss(t, 0.5, 0.12);
      break;
    case 'flicker':
      material.envMapIntensity =
        0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 13) * Math.sin(t * Math.PI * 29));
      break;
  }
}

// ----- film -----

const stripEl = document.getElementById('filmstrip');
const infoEl = document.getElementById('filminfo');
let filmTimer = null;
let lastBlob = null;

function scheduleFilm() {
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

function renderFilm() {
  if (!mesh) return;
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

  const frameCanvases = [];
  captureFrames(size, frames, (canvas) => {
    const copy = document.createElement('canvas');
    copy.width = size;
    copy.height = size;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    frameCanvases.push(copy);
  });

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

const customBtn = document.createElement('button');
customBtn.className = 'btn';
customBtn.dataset.name = 'custom';
const customSwatch = document.createElement('span');
customSwatch.className = 'swatch';
customSwatch.style.background = state.custom.color;
customBtn.append(customSwatch, document.createTextNode('custom'));
customBtn.addEventListener('click', () => setMaterial('custom'));
document.getElementById('materials').appendChild(customBtn);

for (const [group, names] of Object.entries(MOTIONS)) {
  buttonGroup(
    document.getElementById(`motion-${group}`),
    names,
    (n) => n === state.motion,
    (n) => setMotion(n)
  );
}

function setSubject(name) {
  state.subject = name;
  state.svgName = name;
  state.svgText = SUBJECTS[name];
  refreshActive('#subjects .btn', name);
  buildModel();
}

function setMaterial(name) {
  state.material = name;
  material.dispose();
  material = makeMaterial(name);
  if (mesh) mesh.material = material;
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
  if (prop === 'color') {
    material.color.set(value);
  } else {
    material[prop] = value;
    if (prop === 'transmission') material.thickness = value > 0 ? 1.2 : 0;
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
  return input;
}

const depthInput = bindSlider('depth', (v) => v.toFixed(2), (v) => {
  state.depth = v;
  buildModel();
});
const bevelInput = bindSlider('bevel', (v) => v.toFixed(3), (v) => {
  state.bevel = v;
  buildModel();
});
const framesInput = bindSlider('frames', (v) => `${v}`, (v) => {
  state.frames = v;
  scheduleFilm();
});
bindSlider('size', (v) => `${v}px`, (v) => {
  state.size = v;
  scheduleFilm();
});
bindSlider('cmetal', (v) => v.toFixed(2), (v) => updateCustom('metalness', v));
bindSlider('crough', (v) => v.toFixed(2), (v) => updateCustom('roughness', v));
bindSlider('ctrans', (v) => v.toFixed(2), (v) => updateCustom('transmission', v));
bindSlider('ccoat', (v) => v.toFixed(2), (v) => updateCustom('clearcoat', v));

document.getElementById('random').addEventListener('click', () => {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  setMaterial(pick(Object.keys(MATERIALS)));
  setMotion(pick(Object.values(MOTIONS).flat()));
  state.depth = +(0.02 + Math.random() * 0.3).toFixed(3);
  state.bevel = +(Math.random() * 0.08).toFixed(3);
  depthInput.value = state.depth;
  bevelInput.value = state.bevel;
  document.getElementById('depth-val').textContent = state.depth.toFixed(2);
  document.getElementById('bevel-val').textContent = state.bevel.toFixed(3);
  setSubject(pick(Object.keys(SUBJECTS)));
});

// ----- upload / drag-drop -----

function loadSvgFile(file) {
  if (!file || !/\.svg$/i.test(file.name)) return;
  file.text().then((text) => {
    state.svgText = text;
    state.svgName = file.name.replace(/\.svg$/i, '');
    state.subject = null;
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

buildModel();
