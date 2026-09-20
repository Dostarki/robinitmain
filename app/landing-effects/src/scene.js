import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BoxGeometry,
  MeshStandardMaterial, LineSegments, EdgesGeometry, LineBasicMaterial,
  DirectionalLight, AmbientLight, PointLight, BufferGeometry, Float32BufferAttribute,
  Points, ShaderMaterial, AdditiveBlending, LineLoop, SphereGeometry, GridHelper, Color,
} from 'three';

// One small, self-hosted decorative scene. No wallet or pricing code is involved.
const host = document.querySelector('.scene-canvas');
const stage = host?.closest('.hero-visual');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
let renderer;
let disposeScene = () => {};

function mount() {
  renderer = new WebGLRenderer({ alpha: true, antialias: !coarse.matches, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse.matches ? 1 : 1.5));
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.append(renderer.domElement);
  const tokens = getComputedStyle(stage);
  const color = (name, fallback) => new Color(tokens.getPropertyValue(name).trim() || fallback);
  const palette = {
    blue: color('--ds-blue', '#8faac4'), pale: color('--ds-blue-light', '#b2c4d5'),
    orange: color('--ds-orange', '#dca782'), bg: color('--ds-bg', '#14171b'),
  };
  renderer.setClearColor(palette.bg, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, .1, 40);
  camera.position.set(3.8, 2.7, 5.6);
  camera.lookAt(0, .1, 0);
  scene.add(new AmbientLight(0xe8e5df, 1.6));
  const key = new DirectionalLight(0xf2eee6, 2.4);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const rim = new PointLight(palette.blue, 8, 10);
  rim.position.set(3, 1, -2);
  scene.add(rim);
  const warm = new PointLight(palette.orange, 6, 8);
  warm.position.set(-3, -1, 2);
  scene.add(warm);

  const sculpture = new Group();
  sculpture.position.y = -.22;
  scene.add(sculpture);
  const shape = new BoxGeometry(.42, .42, .42);
  const edgeShape = new EdgesGeometry(shape);
  const blue = new MeshStandardMaterial({ color: palette.blue.clone().multiplyScalar(.72), metalness: .05, roughness: .82, emissive: palette.blue, emissiveIntensity: .025 });
  const pale = new MeshStandardMaterial({ color: palette.pale, metalness: .04, roughness: .8 });
  const orange = new MeshStandardMaterial({ color: palette.orange, metalness: .04, roughness: .76, emissive: palette.orange, emissiveIntensity: .035 });
  const edgeMaterial = new LineBasicMaterial({ color: palette.pale, transparent: true, opacity: .2 });
  const cubes = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const accent = x === 1 && y === 1 && z === 1 || x === -1 && y === -1 && z === 0;
    const cube = new Mesh(shape, accent ? orange : (x + y + z) % 3 === 0 ? pale : blue);
    cube.position.set(x * .58, y * .58, z * .58);
    cube.userData.base = cube.position.clone();
    cube.add(new LineSegments(edgeShape, edgeMaterial));
    sculpture.add(cube);
    cubes.push(cube);
  }

  const orbit = new Group();
  orbit.rotation.set(.3, .1, .4);
  scene.add(orbit);
  const ringPoints = [];
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * Math.PI * 2;
    ringPoints.push(Math.cos(a) * 1.85, 0, Math.sin(a) * 1.85);
  }
  const ringGeometry = new BufferGeometry();
  ringGeometry.setAttribute('position', new Float32BufferAttribute(ringPoints, 3));
  const ring = new LineLoop(ringGeometry, new LineBasicMaterial({ color: palette.blue, transparent: true, opacity: .24 }));
  orbit.add(ring);
  const second = new LineLoop(ringGeometry, new LineBasicMaterial({ color: palette.orange, transparent: true, opacity: .16 }));
  second.rotation.x = 1.25;
  orbit.add(second);
  const satellite = new Mesh(new SphereGeometry(.06, 12, 8), orange);
  orbit.add(satellite);

  const floor = new GridHelper(10, 20, palette.blue, palette.blue);
  floor.position.y = -1.8;
  floor.material.transparent = true;
  floor.material.opacity = .09;
  scene.add(floor);
  // Deterministic stars: no large textures, bloom pipeline, or model downloads.
  const positions = [];
  for (let i = 0; i < 44; i++) {
    positions.push(Math.sin(i * 2.4) * 3.3, Math.cos(i * 1.7) * 2.2, Math.sin(i * .8) * 2 - 2);
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const dustMaterial = new ShaderMaterial({
    uniforms: { tint: { value: palette.blue } },
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: 'void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_PointSize=5.0;gl_Position=projectionMatrix*p;}',
    fragmentShader: 'uniform vec3 tint;void main(){float d=length(gl_PointCoord-0.5);float a=(1.0-smoothstep(0.0,0.5,d))*0.32;gl_FragColor=vec4(tint,a);}',
  });
  scene.add(new Points(dustGeometry, dustMaterial));

  let visible = true, frame = 0, last = 0, elapsed = 0, destroyed = false, contextLost = false;
  const pointer = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
  function draw(now) {
    frame = 0;
    if (destroyed || contextLost || !visible || document.hidden) { last = 0; return; }
    if (!reduced.matches && now - last < 1000 / 30) { frame = requestAnimationFrame(draw); return; }
    const delta = last ? Math.min((now - last) / 1000, .08) : 0;
    last = now;
    if (!reduced.matches) elapsed += delta;
    eased.x += (pointer.x - eased.x) * .07;
    eased.y += (pointer.y - eased.y) * .07;
    sculpture.rotation.y = .35 + elapsed * .13 + eased.x * .15;
    sculpture.rotation.x = -.15 + eased.y * .1;
    sculpture.position.y = -.22 + Math.sin(elapsed * .7) * .07;
    const spread = 1 + Math.sin(elapsed * .55) * .07;
    cubes.forEach(cube => cube.position.copy(cube.userData.base).multiplyScalar(spread));
    orbit.rotation.y = elapsed * .09;
    satellite.position.set(Math.cos(elapsed * .35) * 1.85, 0, Math.sin(elapsed * .35) * 1.85);
    renderer.render(scene, camera);
    stage.dataset.scene = 'ready';
    if (!reduced.matches) frame = requestAnimationFrame(draw);
  }
  function start() { if (!frame && !destroyed && !contextLost && visible && !document.hidden) frame = requestAnimationFrame(draw); }
  function stop() { cancelAnimationFrame(frame); frame = 0; last = 0; }
  function resize() {
    if (destroyed) return;
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    start();
  }
  function move(event) {
    if (coarse.matches || reduced.matches) return;
    const rect = stage.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
    pointer.y = (event.clientY - rect.top) / rect.height * 2 - 1;
  }
  function resetPointer() { pointer.x = pointer.y = 0; }
  function visibility() { document.hidden ? stop() : start(); }
  function motion() { stop(); resetPointer(); start(); }
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  const viewObserver = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    visible ? start() : stop();
  }, { rootMargin: '80px' });
  viewObserver.observe(stage);
  stage.addEventListener('pointermove', move, { passive: true });
  stage.addEventListener('pointerleave', resetPointer, { passive: true });
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', motion);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; stop(); stage.dataset.scene = 'fallback';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; start(); });
  disposeScene = () => {
    destroyed = true; stop(); sizeObserver.disconnect(); viewObserver.disconnect();
    stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerleave', resetPointer);
    document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', motion);
    const geometries = new Set(), materials = new Set();
    scene.traverse(item => { if (item.geometry) geometries.add(item.geometry); if (item.material) materials.add(item.material); });
    geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
    renderer.dispose(); renderer.domElement.remove();
  };
  resize();
}

if (host && stage) {
  try { mount(); }
  catch { renderer?.dispose(); host.replaceChildren(); stage.dataset.scene = 'fallback'; }
}
// Cards stay visible even when JS/WebGL is unavailable.
const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) { entry.target.classList.add('reveal-in'); reveal.unobserve(entry.target); }
}), { threshold: .12 });
document.querySelectorAll('.panel,.chart-card,.sim,.mechanic,.score-card,.x-card').forEach(card => reveal.observe(card));
addEventListener('pagehide', event => { if (!event.persisted) { disposeScene(); reveal.disconnect(); } });
