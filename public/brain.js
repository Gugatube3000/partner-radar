// Holographic brain: a signed-distance brain (two hemispheres with gyri, cerebellum,
// brainstem) contoured into glowing slices, with bloom, a scan plane and agent pulses.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------- 3D simplex noise (Gustavson, public domain)
const G3 = new Float32Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);
const perm = new Uint8Array(512);
{ const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i; let s = 1337;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
function grad(h, x, y, z) { h = (h % 12) * 3; return G3[h] * x + G3[h + 1] * y + G3[h + 2] * z; }
function noise3(xin, yin, zin) {
  const F = 1 / 3, G = 1 / 6;
  const s = (xin + yin + zin) * F;
  const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
  const t = (i + j + k) * G;
  const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  const x1 = x0 - i1 + G, y1 = y0 - j1 + G, z1 = z0 - k1 + G;
  const x2 = x0 - i2 + 2 * G, y2 = y0 - j2 + 2 * G, z2 = z0 - k2 + 2 * G;
  const x3 = x0 - 1 + 3 * G, y3 = y0 - 1 + 3 * G, z3 = z0 - 1 + 3 * G;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  let n = 0, q;
  q = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (q > 0) { q *= q; n += q * q * grad(perm[ii + perm[jj + perm[kk]]], x0, y0, z0); }
  q = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (q > 0) { q *= q; n += q * q * grad(perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1); }
  q = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (q > 0) { q *= q; n += q * q * grad(perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2); }
  q = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (q > 0) { q *= q; n += q * q * grad(perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3); }
  return 32 * n;
}

// ---------- brain signed distance field
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
function ell(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const k1 = Math.sqrt((px * px) / (rx * rx) + (py * py) / (ry * ry) + (pz * pz) / (rz * rz));
  return (k0 * (k0 - 1)) / Math.max(k1, 1e-6);
}
function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
function brainSDF(x, y, z) {
  const ax = Math.abs(x);
  let c = ell(ax, y, z, 0.47, 0.08, 0.02, 0.56, 0.62, 1.02);
  c = smin(c, ell(ax, y, z, 0.42, 0.0, 0.55, 0.5, 0.5, 0.52), 0.25);
  c = smin(c, ell(ax, y, z, 0.44, 0.12, -0.5, 0.5, 0.55, 0.56), 0.25);
  c = smin(c, ell(ax, y, z, 0.63, -0.34, 0.14, 0.36, 0.3, 0.62), 0.22);
  c = Math.max(c, 0.045 * smooth(-0.35, 0.15, y) - ax);
  const n = noise3(x * 3.1, y * 3.1, z * 3.1) + 0.5 * noise3(x * 6.2 + 11, y * 6.2, z * 6.2);
  c += 0.05 * (1 - smooth(0.0, 0.28, Math.abs(n))) - 0.012;
  let cb = ell(x, y, z, 0, -0.5, -0.68, 0.62, 0.3, 0.36);
  cb += 0.012 * Math.sin(y * 70 + z * 20);
  const bs = capsule(x, y, z, 0, -0.45, -0.25, 0, -1.15, -0.38, 0.14);
  return smin(smin(c, cb, 0.06), bs, 0.12);
}

// ---------- marching squares on a slice
// field(u, v) -> sdf; emits segments into out as [u0,v0,u1,v1,...]
function contour(field, u0, u1, v0, v1, nu, nv, out) {
  const du = (u1 - u0) / nu, dv = (v1 - v0) / nv;
  const vals = new Float32Array((nu + 1) * (nv + 1));
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) vals[j * (nu + 1) + i] = field(u0 + i * du, v0 + j * dv);
  const lerp = (a, b) => a / (a - b);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = vals[j * (nu + 1) + i], b = vals[j * (nu + 1) + i + 1], c = vals[(j + 1) * (nu + 1) + i + 1], d = vals[(j + 1) * (nu + 1) + i];
      const idx = (a < 0 ? 1 : 0) | (b < 0 ? 2 : 0) | (c < 0 ? 4 : 0) | (d < 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = u0 + i * du, y = v0 + j * dv;
      const e = [
        () => [x + lerp(a, b) * du, y], () => [x + du, y + lerp(b, c) * dv],
        () => [x + (1 - lerp(c, d)) * du, y + dv], () => [x, y + (1 - lerp(d, a)) * dv],
      ];
      const seg = (p, q) => { const P = e[p](), Q = e[q](); out.push(P[0], P[1], Q[0], Q[1]); };
      switch (idx) {
        case 1: case 14: seg(3, 0); break; case 2: case 13: seg(0, 1); break; case 3: case 12: seg(3, 1); break;
        case 4: case 11: seg(1, 2); break; case 6: case 9: seg(0, 2); break; case 7: case 8: seg(3, 2); break;
        case 5: seg(3, 2); seg(0, 1); break; case 10: seg(3, 0); seg(1, 2); break;
      }
    }
  }
}

const VERT = /* glsl */ `
attribute float aKind;
varying vec3 vPos; varying float vKind; varying float vNear;
void main(){ vPos = position; vKind = aKind; vec4 mv = modelViewMatrix * vec4(position, 1.0); vNear = 1.0 - clamp((-mv.z - 4.5) / 2.2, 0.0, 1.0); gl_Position = projectionMatrix * mv; }`;
const FRAG = /* glsl */ `
uniform float uTime; uniform float uScan; uniform float uEnergy;
uniform vec4 uPulse[8]; uniform vec3 uPulseCol[8];
uniform vec3 uLow; uniform vec3 uHigh;
varying vec3 vPos; varying float vKind; varying float vNear;
void main(){
  float h = clamp((vPos.y + 1.25) / 2.0, 0.0, 1.0);
  vec3 col = mix(uLow, uHigh, h);
  float a = (vKind > 0.5 ? 0.03 : 0.085 + 0.03 * uEnergy) * (0.25 + 0.75 * vNear);
  float scan = exp(-pow((vPos.y - uScan) * 10.0, 2.0));
  col += vec3(0.55, 1.0, 0.85) * scan * (0.5 + uEnergy * 0.4);
  a += scan * 0.3;
  for (int i = 0; i < 8; i++) {
    float age = uTime - uPulse[i].w;
    if (age < 0.0 || age > 2.6) continue;
    float d = distance(vPos, uPulse[i].xyz);
    float wave = exp(-pow((d - age * 0.95) * 8.0, 2.0)) * exp(-age * 1.3);
    float core = exp(-d * d * 30.0) * exp(-age * 2.0);
    col += uPulseCol[i] * (wave * 1.4 + core * 2.0);
    a += wave * 0.45 + core * 0.7;
  }
  gl_FragColor = vec4(col * a, 1.0);
}`;
const PVERT = /* glsl */ `
attribute float aPhase; uniform float uTime; uniform float uPx; varying float vA;
void main(){
  float f = pow(0.5 + 0.5 * sin(uTime * (1.2 + aPhase * 2.5) + aPhase * 40.0), 10.0);
  vA = 0.08 + f * 0.8;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPx * (1.4 + f * 2.6) * (3.6 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = /* glsl */ `
varying float vA; uniform vec3 uCol;
void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uCol, vA * smoothstep(0.5, 0.0, d)); }`;

export function createBrain(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x02070a, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0.35, 5.6);
  camera.lookAt(0, 0, 0);

  const root = new THREE.Group();
  root.rotation.x = 0.12;
  scene.add(root);
  const brain = new THREE.Group();
  brain.position.y = 0.27;
  root.add(brain);

  const uniforms = {
    uTime: { value: 0 }, uScan: { value: 0 }, uEnergy: { value: 0 },
    uPulse: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, -99)) },
    uPulseCol: { value: Array.from({ length: 8 }, () => new THREE.Color(0x2cf5b5)) },
    uLow: { value: new THREE.Color(0x0a8f7a) }, uHigh: { value: new THREE.Color(0x3dffc0) },
  };
  const lineMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  const allVerts = [];
  const slices = [];
  // horizontal (axial) slices
  for (let s = 0; s < 64; s++) slices.push({ kind: 0, k: -1.27 + (s * 2.0) / 63 });
  // sagittal slices
  for (let s = 0; s < 30; s++) slices.push({ kind: 1, k: -1.1 + (s * 2.2) / 29 });
  // build in brightness order (outer to inner) for a nicer assembly
  slices.sort((a, b) => a.kind - b.kind || Math.abs(b.k) - Math.abs(a.k));

  let built = 0;
  function buildSome(budgetMs = 10) {
    const t0 = performance.now();
    const pos = [], kind = [];
    while (built < slices.length && performance.now() - t0 < budgetMs) {
      const sl = slices[built++];
      const out = [];
      if (sl.kind === 0) {
        contour((u, v) => brainSDF(u, sl.k, v), -1.15, 1.15, -1.2, 1.2, 92, 96, out);
        for (let i = 0; i < out.length; i += 2) { pos.push(out[i], sl.k, out[i + 1]); kind.push(0); }
      } else {
        contour((u, v) => brainSDF(sl.k, u, v), -1.3, 0.8, -1.2, 1.2, 80, 92, out);
        for (let i = 0; i < out.length; i += 2) { pos.push(sl.k, out[i], out[i + 1]); kind.push(1); }
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
    brain.add(new THREE.LineSegments(g, lineMat));
    for (let i = 0; i < pos.length; i += 3) if (kind[i / 3] === 0) allVerts.push(pos[i], pos[i + 1], pos[i + 2]);
    if (built >= slices.length) addNeurons();
  }

  const pointUniforms = { uTime: uniforms.uTime, uPx: { value: renderer.getPixelRatio() * 2 }, uCol: { value: new THREE.Color(0x9fffe0) } };
  function addNeurons() {
    const n = 1400, p = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(Math.random() * (allVerts.length / 3)) * 3;
      p[i * 3] = allVerts[j]; p[i * 3 + 1] = allVerts[j + 1]; p[i * 3 + 2] = allVerts[j + 2]; ph[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
    brain.add(new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: pointUniforms, vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    opts.onReady?.();
  }

  // orbit rings with satellites
  const orbitGroup = new THREE.Group();
  root.add(orbitGroup);
  const ringMat = new THREE.LineBasicMaterial({ color: 0x1fbf98, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending });
  const sats = [];
  [[1.72, 0.32, 0.0], [1.95, -0.22, 1.1]].forEach(([r, tilt, rot], idx) => {
    const pts = [];
    for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat);
    const holder = new THREE.Group();
    holder.rotation.set(tilt, rot, 0);
    holder.add(ring);
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 12), new THREE.MeshBasicMaterial({ color: idx ? 0xffb23f : 0x8fffe0 }));
    holder.add(sat);
    sats.push({ sat, r, speed: idx ? -0.35 : 0.5, a: Math.random() * 6 });
    orbitGroup.add(holder);
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.65, 0.4, 0.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let energy = 0, targetEnergy = 0, pulseIdx = 0, last = performance.now();
  const clock = { t: 0 };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock.t += dt;
    if (built < slices.length) buildSome(9);
    energy += (targetEnergy - energy) * Math.min(1, dt * 2);
    uniforms.uTime.value = clock.t;
    uniforms.uEnergy.value = energy;
    uniforms.uScan.value = Math.sin(clock.t * (0.45 + energy * 0.5)) * 1.05 - 0.2;
    root.rotation.y += dt * (0.12 + energy * 0.22);
    brain.position.y = 0.27 + Math.sin(clock.t * 0.8) * 0.025;
    for (const s of sats) { s.a += dt * s.speed * (1 + energy); s.sat.position.set(Math.cos(s.a) * s.r, 0, Math.sin(s.a) * s.r); }
    bloom.strength = 0.6 + energy * 0.3;
    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    /** Fire a pulse wave from a random point on the cortex. */
    pulse(hex = "#2cf5b5") {
      if (!allVerts.length) return;
      const j = Math.floor(Math.random() * (allVerts.length / 3)) * 3;
      uniforms.uPulse.value[pulseIdx].set(allVerts[j], allVerts[j + 1], allVerts[j + 2], clock.t);
      uniforms.uPulseCol.value[pulseIdx].set(hex);
      pulseIdx = (pulseIdx + 1) % 8;
    },
    setEnergy(v) { targetEnergy = v; },
    progress: () => built / slices.length,
  };
}
