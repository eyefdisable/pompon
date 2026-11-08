/**
 * Сборка 3D-моделей «Помпона» в GLB (glTF 2.0) из процедурной геометрии.
 * Запуск: npm run models  →  models/*.glb (+ копия в public/models при сборке).
 *
 * Узлы модели (их имена использует движок):
 *   fabric      — вся мягкая обивка одним мешем, UV-атлас без перекрытий (маска пятен для игры)
 *   frame       — ножки, каркас (не пачкается)
 *   face        — группа лица; eyeL/eyeR (моргание по scale.y), pupilL/pupilR (взгляд), mouth, browL/browR, cheekL/cheekR
 *   armL/armR   — руки, точка вращения в «плече»
 *   anchor      — точка над головой для реплики
 * Проверка: руки при любом угле анимации не заходят в корпус (иначе сборка падает).
 */
import fs from 'node:fs';
import path from 'node:path';

type V3 = [number, number, number];
interface Geo { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }
interface Mat { name: string; color: [number, number, number]; rough: number; metal: number }
interface Node { name: string; t?: V3; r?: [number, number, number, number]; s?: V3; mesh?: { geo: Geo; mat: Mat }; children?: Node[]; extras?: any }

const geo = (): Geo => ({ pos: [], nrm: [], uv: [], idx: [] });
function append(dst: Geo, src: Geo) {
  const base = dst.pos.length / 3;
  dst.pos.push(...src.pos); dst.nrm.push(...src.nrm); dst.uv.push(...(src.uv.length ? src.uv : new Array((src.pos.length / 3) * 2).fill(0)));
  for (const i of src.idx) dst.idx.push(i + base);
}
function transform(g: Geo, t: V3, rotY = 0, rotX = 0, rotZ = 0): Geo {
  const out = geo(); out.idx = g.idx.slice(); out.uv = g.uv.slice();
  const rot = (x: number, y: number, z: number): V3 => {
    let a = Math.cos(rotX), b = Math.sin(rotX); [y, z] = [y * a - z * b, y * b + z * a];
    a = Math.cos(rotY); b = Math.sin(rotY); [x, z] = [x * a + z * b, -x * b + z * a];
    a = Math.cos(rotZ); b = Math.sin(rotZ); [x, y] = [x * a - y * b, x * b + y * a];
    return [x, y, z];
  };
  for (let i = 0; i < g.pos.length; i += 3) {
    const p = rot(g.pos[i], g.pos[i + 1], g.pos[i + 2]); const n = rot(g.nrm[i], g.nrm[i + 1], g.nrm[i + 2]);
    out.pos.push(p[0] + t[0], p[1] + t[1], p[2] + t[2]); out.nrm.push(...n);
  }
  return out;
}

/* ---------- примитивы ---------- */
function roundedBox(w: number, h: number, d: number, r: number, seg = 9): Geo {
  const g = geo(); const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  const faces: [V3, V3, V3][] = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
  const half: V3 = [w / 2, h / 2, d / 2];
  for (const [n, u, v] of faces) {
    const base = g.pos.length / 3;
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const a = i / seg * 2 - 1, b = j / seg * 2 - 1;
      const p = [0, 1, 2].map((k) => n[k] * half[k] + u[k] * a * Math.abs(half[[0, 1, 2].find((q) => u[q] !== 0)!]) + v[k] * b * Math.abs(half[[0, 1, 2].find((q) => v[q] !== 0)!])) as V3;
      const c: V3 = [Math.max(-hw, Math.min(hw, p[0])), Math.max(-hh, Math.min(hh, p[1])), Math.max(-hd, Math.min(hd, p[2]))];
      let o: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; const l = Math.hypot(...o) || 1; o = [o[0] / l, o[1] / l, o[2] / l];
      g.pos.push(c[0] + o[0] * r, c[1] + o[1] * r, c[2] + o[2] * r); g.nrm.push(...o);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = base + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d2 = c + 1;
      g.idx.push(a, b, d2, a, d2, c);
    }
  }
  return g;
}
function ellipsoid(rx: number, ry: number, rz: number, ws = 28, hs = 18): Geo {
  const g = geo();
  for (let j = 0; j <= hs; j++) { const th = (j / hs) * Math.PI;
    for (let i = 0; i <= ws; i++) { const ph = (i / ws) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      g.pos.push(x * rx, y * ry, z * rz); const n: V3 = [x / rx, y / ry, z / rz]; const l = Math.hypot(...n) || 1; g.nrm.push(n[0] / l, n[1] / l, n[2] / l); } }
  for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) { const a = j * (ws + 1) + i, b = a + ws + 1; g.idx.push(a, a + 1, b, a + 1, b + 1, b); }
  return g;
}
/** Трубка по ломаной/кривой с круглым сечением и сферическими концами. */
function tube(points: V3[], r: number, radial = 14, caps = true): Geo {
  const g = geo(); const n = points.length;
  for (let k = 0; k < n; k++) {
    const p = points[k], q = points[Math.min(n - 1, k + 1)], pp = points[Math.max(0, k - 1)];
    let t: V3 = [q[0] - pp[0], q[1] - pp[1], q[2] - pp[2]]; const tl = Math.hypot(...t) || 1; t = [t[0] / tl, t[1] / tl, t[2] / tl];
    const ref: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let a: V3 = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]; const al = Math.hypot(...a); a = [a[0] / al, a[1] / al, a[2] / al];
    const b: V3 = [t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]];
    for (let i = 0; i <= radial; i++) { const ang = (i / radial) * Math.PI * 2; const c = Math.cos(ang), s = Math.sin(ang);
      const nn: V3 = [a[0] * c + b[0] * s, a[1] * c + b[1] * s, a[2] * c + b[2] * s];
      g.pos.push(p[0] + nn[0] * r, p[1] + nn[1] * r, p[2] + nn[2] * r); g.nrm.push(...nn); }
  }
  for (let k = 0; k < n - 1; k++) for (let i = 0; i < radial; i++) { const a = k * (radial + 1) + i, b = a + radial + 1; g.idx.push(a, b, a + 1, a + 1, b, b + 1); }
  if (caps) { append(g, transform(ellipsoid(r, r, r, 12, 8), points[0])); append(g, transform(ellipsoid(r, r, r, 12, 8), points[n - 1])); }
  return g;
}
function cylinder(rTop: number, rBot: number, h: number, seg = 20): Geo {
  const g = geo(); const slope = (rBot - rTop) / h;
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; const r = j ? rTop : rBot;
    g.pos.push(Math.cos(a) * r, j ? h / 2 : -h / 2, Math.sin(a) * r); const n: V3 = [Math.cos(a), slope, Math.sin(a)]; const l = Math.hypot(...n); g.nrm.push(n[0] / l, n[1] / l, n[2] / l); }
  for (let i = 0; i < seg; i++) g.idx.push(i, i + seg + 1, i + 1, i + 1, i + seg + 1, i + seg + 2);
  const capTop = geo(); capTop.pos.push(0, h / 2, 0); capTop.nrm.push(0, 1, 0);
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; capTop.pos.push(Math.cos(a) * rTop, h / 2, Math.sin(a) * rTop); capTop.nrm.push(0, 1, 0); if (i) capTop.idx.push(0, i + 1, i); }
  append(g, capTop);
  return g;
}
const arc = (cx: number, cy: number, z: number, r: number, a0: number, a1: number, n = 16): V3[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z] as V3; });

/* ---------- UV-атлас: кубическая проекция с одинаковой плотностью текселей ---------- */
interface Part { g: Geo; }
function atlasUV(parts: Part[]) {
  const rects: { part: number; face: number; w: number; h: number; x?: number; y?: number; min: number[]; }[] = [];
  const info = parts.map((p, pi) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.g.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.g.pos[i + k]); mx[k] = Math.max(mx[k], p.g.pos[i + k]); }
    const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    // грань по оси k: проекция на две другие оси
    for (let f = 0; f < 6; f++) { const k = f >> 1; const [a, b] = [0, 1, 2].filter((q) => q !== k); rects.push({ part: pi, face: f, w: size[a], h: size[b], min: mn }); }
    return { mn, size };
  });
  // упаковка полками
  const pad = 0.03; const sorted = [...rects].sort((a, b) => b.h - a.h);
  const totalArea = rects.reduce((s, r) => s + (r.w + pad) * (r.h + pad), 0);
  let W = Math.sqrt(totalArea) * 1.15;
  for (let attempt = 0; attempt < 40; attempt++) {
    let x = 0, y = 0, rowH = 0, ok = true;
    for (const r of sorted) { if (x + r.w + pad > W) { x = 0; y += rowH + pad; rowH = 0; } r.x = x; r.y = y; x += r.w + pad; rowH = Math.max(rowH, r.h); if (r.w + pad > W) ok = false; }
    if (ok && y + rowH <= W) break; W *= 1.06;
  }
  const scale = 1 / W;
  // UV: грань выбирается по треугольнику; вершины на стыке граней дублируются,
  // чтобы ни один треугольник не «растягивался» через атлас (иначе пятна видны полосами на рёбрах)
  const faceOf = (nx: number, ny: number, nz: number) => { const a = [Math.abs(nx), Math.abs(ny), Math.abs(nz)]; const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2; return k * 2 + ([nx, ny, nz][k] >= 0 ? 0 : 1); };
  parts.forEach((p, pi) => {
    const { mn } = info[pi]; const g = p.g;
    const nv = g.pos.length / 3; const vFace = Array.from({ length: nv }, (_, i) => faceOf(g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]));
    const dup = new Map<string, number>();
    const pos = g.pos.slice(), nrm = g.nrm.slice(); const faceIdx = vFace.slice();
    for (let t = 0; t < g.idx.length; t += 3) {
      const ids = [g.idx[t], g.idx[t + 1], g.idx[t + 2]];
      const f = faceOf(ids.reduce((s, i) => s + g.nrm[i * 3], 0), ids.reduce((s, i) => s + g.nrm[i * 3 + 1], 0), ids.reduce((s, i) => s + g.nrm[i * 3 + 2], 0));
      for (let k = 0; k < 3; k++) {
        const i = ids[k]; if (vFace[i] === f) continue;
        const key = i + ':' + f; let ni = dup.get(key);
        if (ni === undefined) { ni = pos.length / 3; pos.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]); nrm.push(g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]); faceIdx.push(f); dup.set(key, ni); }
        g.idx[t + k] = ni;
      }
    }
    g.pos = pos; g.nrm = nrm; g.uv = [];
    for (let v = 0; v < pos.length / 3; v++) {
      const f = faceIdx[v]; const k = f >> 1; const r = rects.find((q) => q.part === pi && q.face === f)!;
      const [a, b] = [0, 1, 2].filter((q) => q !== k);
      const u = (r.x! + (pos[v * 3 + a] - mn[a])) * scale, w = (r.y! + (pos[v * 3 + b] - mn[b])) * scale;
      g.uv.push(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, w)));
    }
  });
  return { worldPerUv: W, rects: rects.map((r) => [r.x! * scale, r.y! * scale, r.w * scale, r.h * scale].map((x) => +x.toFixed(5))) };
}

/* ---------- лицо и руки ---------- */
const M = {
  white: { name: 'eye_white', color: [0.97, 0.97, 0.95], rough: 0.35, metal: 0 } as Mat,
  ink: { name: 'ink', color: [0.09, 0.1, 0.1], rough: 0.4, metal: 0 } as Mat,
  cheek: { name: 'cheek', color: [0.94, 0.62, 0.58], rough: 0.8, metal: 0 } as Mat
};
function face(scale: number, opts: { tilt?: number } = {}): Node {
  const s = scale;
  const eye = (side: number): Node => ({ name: side < 0 ? 'eyeL' : 'eyeR', t: [side * 0.115 * s, 0.05 * s, 0], children: [
    { name: side < 0 ? 'eyeballL' : 'eyeballR', mesh: { geo: ellipsoid(0.072 * s, 0.088 * s, 0.035 * s, 20, 14), mat: M.white } },
    { name: side < 0 ? 'pupilL' : 'pupilR', t: [0, -0.008 * s, 0.03 * s], children: [
      { name: 'pupilMesh', mesh: { geo: ellipsoid(0.034 * s, 0.04 * s, 0.014 * s, 16, 10), mat: M.ink } },
      { name: 'glint', t: [0.012 * s, 0.016 * s, 0.012 * s], mesh: { geo: ellipsoid(0.009 * s, 0.009 * s, 0.004 * s, 8, 6), mat: M.white } }] }] });
  const brow = (side: number): Node => ({ name: side < 0 ? 'browL' : 'browR', t: [side * 0.115 * s, 0.165 * s, 0.01 * s],
    mesh: { geo: tube(arc(0, -0.05 * s, 0, 0.06 * s, Math.PI * (side < 0 ? 0.62 : 0.38) - 0.25, Math.PI * (side < 0 ? 0.62 : 0.38) + 0.25, 8), 0.009 * s, 8), mat: M.ink } });
  const mouth: Node = { name: 'mouth', t: [0, -0.075 * s, 0.012 * s], mesh: { geo: tube(arc(0, 0.06 * s, 0, 0.075 * s, Math.PI * 1.28, Math.PI * 1.72, 14), 0.011 * s, 8), mat: M.ink } };
  const cheek = (side: number): Node => ({ name: side < 0 ? 'cheekL' : 'cheekR', t: [side * 0.2 * s, -0.045 * s, -0.004 * s], mesh: { geo: ellipsoid(0.035 * s, 0.022 * s, 0.008 * s, 12, 8), mat: M.cheek } });
  return { name: 'face', r: quatX(opts.tilt ?? 0), children: [eye(-1), eye(1), brow(-1), brow(1), mouth, cheek(-1), cheek(1)] };
}
function quatX(a: number): [number, number, number, number] { return [Math.sin(a / 2), 0, 0, Math.cos(a / 2)]; }
function quatY(a: number): [number, number, number, number] { return [0, Math.sin(a / 2), 0, Math.cos(a / 2)]; }

/** Рука: плечо в начале координат узла, по умолчанию направлена в сторону (side) и вниз. */
function arm(side: number, len: number, mat: Mat, r = 0.034): Node {
  const pts: V3[] = [[0, 0, 0], [side * len * 0.45, -len * 0.18, 0.02], [side * len * 0.8, -len * 0.12, 0.08]];
  const g = tube(pts, r, 12);
  append(g, transform(ellipsoid(r * 1.9, r * 1.7, r * 1.6, 14, 10), [side * len * 0.86, -len * 0.1, 0.1]));
  // большой палец — делает кисть читаемой
  append(g, transform(tube([[0, 0, 0], [0, r * 1.6, r * 0.6]], r * 0.62, 8), [side * len * 0.86, -len * 0.1 + r * 0.6, 0.1 + r * 0.6]));
  return { name: side < 0 ? 'armL' : 'armR', mesh: { geo: g, mat }, extras: { side, len, r } };
}

/* ---------- сборка модели ---------- */
interface Body { kind: 'rbox'; c: V3; size: V3; r: number }
interface Model { id: string; title: string; fabric: Mat; parts: Geo[]; frame: Geo; frameMat: Mat; faceNode: Node; faceAt: V3; arms: { at: V3; side: number; len: number }[]; anchor: V3; bodies: Body[]; armMat: Mat; scale?: number }

function rb(m: Model, c: V3, size: V3, r: number, rotX = 0, collide = true) {
  m.parts.push(transform(roundedBox(size[0], size[1], size[2], r), c, 0, rotX));
  if (collide) m.bodies.push({ kind: 'rbox', c, size, r });
}

const C = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((x) => Math.pow(x, 2.2)) as any; };

function sofa(): Model {
  const fabric: Mat = { name: 'fabric', color: C('#9FB3A3'), rough: 0.95, metal: 0 };
  const m: Model = { id: 'sofa', title: 'Диван', fabric, parts: [], frame: geo(), frameMat: { name: 'wood', color: C('#8A5A3B'), rough: 0.55, metal: 0 },
    faceNode: face(1.25, { tilt: -0.1 }), faceAt: [0, 1.36, -0.16], arms: [], anchor: [0, 1.95, -0.3], bodies: [], armMat: { name: 'arm', color: C('#89A091'), rough: 0.9, metal: 0 } };
  rb(m, [0, 0.52, 0], [2.9, 0.4, 1.12], 0.14);
  rb(m, [0, 1.08, -0.46], [2.5, 0.8, 0.26], 0.13);
  [-0.82, 0, 0.82].forEach((x) => { rb(m, [x, 0.86, 0.1], [0.8, 0.26, 0.92], 0.12); rb(m, [x, 1.3, -0.27], [0.78, 0.62, 0.24], 0.12, -0.1); });
  [-1, 1].forEach((sd) => rb(m, [sd * 1.36, 0.82, 0], [0.32, 0.86, 1.12], 0.15));
  [[-1.25, -0.42], [1.25, -0.42], [-1.25, 0.42], [1.25, 0.42]].forEach(([x, z]) => append(m.frame, transform(cylinder(0.035, 0.022, 0.32), [x, 0.16, z], 0, z > 0 ? 0.12 : -0.12)));
  m.arms = [{ at: [-1.53, 1.05, 0.12], side: -1, len: 0.42 }, { at: [1.53, 1.05, 0.12], side: 1, len: 0.42 }];
  return m;
}
function armchair(): Model {
  const fabric: Mat = { name: 'fabric', color: C('#D7B59A'), rough: 0.95, metal: 0 };
  const m: Model = { id: 'armchair', title: 'Кресло', fabric, parts: [], frame: geo(), frameMat: { name: 'wood', color: C('#6E4A33'), rough: 0.55, metal: 0 },
    faceNode: face(1.15, { tilt: -0.1 }), faceAt: [0, 1.4, -0.14], arms: [], anchor: [0, 2.0, -0.3], bodies: [], armMat: { name: 'arm', color: C('#C9A68A'), rough: 0.9, metal: 0 } };
  rb(m, [0, 0.52, 0], [1.5, 0.4, 1.1], 0.14);
  rb(m, [0, 1.12, -0.45], [1.1, 0.95, 0.26], 0.14);
  rb(m, [0, 0.87, 0.1], [0.86, 0.28, 0.9], 0.13);
  rb(m, [0, 1.36, -0.26], [0.84, 0.72, 0.24], 0.13, -0.1);
  [-1, 1].forEach((sd) => { rb(m, [sd * 0.62, 0.84, 0], [0.28, 0.9, 1.1], 0.14); rb(m, [sd * 0.5, 1.5, -0.42], [0.22, 0.5, 0.3], 0.1); });
  [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]].forEach(([x, z]) => append(m.frame, transform(cylinder(0.04, 0.025, 0.32), [x, 0.16, z])));
  m.arms = [{ at: [-0.77, 1.02, 0.12], side: -1, len: 0.38 }, { at: [0.77, 1.02, 0.12], side: 1, len: 0.38 }];
  return m;
}
function mattress(): Model {
  const fabric: Mat = { name: 'fabric', color: C('#E8ECEF'), rough: 0.97, metal: 0 };
  const m: Model = { id: 'mattress', title: 'Матрас', fabric, parts: [], frame: geo(), frameMat: { name: 'piping', color: C('#7D93A8'), rough: 0.8, metal: 0 },
    faceNode: face(1.05), faceAt: [0, 0.44, 0.99], arms: [], anchor: [0, 1.15, 0.7], bodies: [], armMat: { name: 'arm', color: C('#C7D0D8'), rough: 0.9, metal: 0 } };
  // матрас узнаётся по конструкции: толстый блок, стёганый верх с пуговицами, кант по периметру, бортик, ручки
  rb(m, [0, 0.4, 0], [2.6, 0.5, 1.9], 0.12);
  const topQuilt = geo();
  for (let ix = -3; ix <= 3; ix++) for (let iz = -2; iz <= 2; iz++) append(topQuilt, transform(ellipsoid(0.17, 0.024, 0.17, 14, 8), [ix * 0.34, 0.652, iz * 0.34]));
  m.parts.push(topQuilt);
  const ring = (y: number) => { const w = 1.3, d = 0.95, r = 0.12; const pts: V3[] = [];
    const corners: [number, number, number, number][] = [[w - r, d - r, 0, Math.PI / 2], [-(w - r), d - r, Math.PI / 2, Math.PI], [-(w - r), -(d - r), Math.PI, Math.PI * 1.5], [w - r, -(d - r), Math.PI * 1.5, Math.PI * 2]];
    for (const [cx, cz, a0, a1] of corners) for (let i = 0; i <= 6; i++) { const a = a0 + (a1 - a0) * (i / 6); pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); }
    pts.push(pts[0]); return tube(pts, 0.022, 8, false); };
  append(m.frame, ring(0.645)); append(m.frame, ring(0.155));
  // ручки-петли на торцах (как у настоящих матрасов)
  [-1, 1].forEach((sd) => [-0.35, 0.35].forEach((z) => append(m.frame, tube([[sd * 1.305, 0.44, z - 0.12], [sd * 1.35, 0.4, z - 0.08], [sd * 1.35, 0.4, z + 0.08], [sd * 1.305, 0.44, z + 0.12]], 0.016, 8))));
  // низкое основание-подиум, чтобы предмет не висел
  append(m.frame, transform(roundedBox(2.4, 0.12, 1.7, 0.04), [0, 0.06, 0]));
  m.frameMat = { name: 'piping', color: C('#6F879E'), rough: 0.75, metal: 0 };
  m.arms = [{ at: [-1.32, 0.5, 0.72], side: -1, len: 0.36 }, { at: [1.32, 0.5, 0.72], side: 1, len: 0.36 }];
  m.scale = 0.95;
  return m;
}
function chair(): Model {
  const fabric: Mat = { name: 'fabric', color: C('#B3A4C4'), rough: 0.95, metal: 0 };
  const m: Model = { id: 'chair', title: 'Стул', fabric, parts: [], frame: geo(), frameMat: { name: 'wood', color: C('#A0714B'), rough: 0.5, metal: 0 },
    faceNode: face(1.0, { tilt: -0.06 }), faceAt: [0, 1.45, -0.29], arms: [], anchor: [0, 2.0, -0.4], bodies: [], armMat: { name: 'arm', color: C('#A0714B'), rough: 0.6, metal: 0 } };
  rb(m, [0, 0.94, 0.02], [0.92, 0.14, 0.86], 0.07);
  rb(m, [0, 1.45, -0.38], [0.86, 0.68, 0.14], 0.07, -0.06);
  append(m.frame, transform(roundedBox(0.96, 0.08, 0.9, 0.03), [0, 0.83, 0.02]));
  [[-0.4, -0.37], [0.4, -0.37], [-0.4, 0.4], [0.4, 0.4]].forEach(([x, z]) => append(m.frame, transform(cylinder(0.038, 0.028, 0.8), [x, 0.4, z])));
  [-0.4, 0.4].forEach((x) => append(m.frame, transform(cylinder(0.032, 0.032, 0.95), [x, 1.3, -0.44])));
  m.bodies.push({ kind: 'rbox', c: [0, 0.83, 0.02], size: [0.96, 0.08, 0.9], r: 0.03 });
  [-0.4, 0.4].forEach((x) => m.bodies.push({ kind: 'rbox', c: [x, 1.3, -0.44], size: [0.07, 0.95, 0.07], r: 0.03 }));
  m.arms = [{ at: [-0.47, 1.55, -0.38], side: -1, len: 0.36 }, { at: [0.47, 1.55, -0.38], side: 1, len: 0.36 }];
  m.scale = 1.12;
  return m;
}
function other(): Model {
  const fabric: Mat = { name: 'fabric', color: C('#DDB96A'), rough: 0.95, metal: 0 };
  const m: Model = { id: 'other', title: 'Пуф', fabric, parts: [], frame: geo(), frameMat: { name: 'band', color: C('#8C7A55'), rough: 0.8, metal: 0 },
    faceNode: face(1.05, { tilt: -0.28 }), faceAt: [0, 0.78, 0.62], arms: [], anchor: [0, 1.5, 0.3], bodies: [], armMat: { name: 'arm', color: C('#CFAB5E'), rough: 0.9, metal: 0 } };
  m.parts.push(transform(ellipsoid(0.75, 0.5, 0.75, 40, 24), [0, 0.58, 0]));
  m.bodies.push({ kind: 'rbox', c: [0, 0.58, 0], size: [1.4, 0.95, 1.4], r: 0.45 });
  const pts: V3[] = Array.from({ length: 49 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return [Math.cos(a) * 0.735, 0.5, Math.sin(a) * 0.735] as V3; });
  append(m.frame, tube(pts, 0.035, 10, false));
  append(m.frame, transform(ellipsoid(0.06, 0.03, 0.06, 12, 8), [0, 1.075, 0]));
  m.arms = [{ at: [-0.76, 0.7, 0.12], side: -1, len: 0.36 }, { at: [0.76, 0.7, 0.12], side: 1, len: 0.36 }];
  return m;
}

/* ---------- проверка: руки не заходят в корпус ---------- */
function sdRoundBox(p: V3, b: Body) {
  const q = [0, 1, 2].map((k) => Math.abs(p[k] - b.c[k]) - (b.size[k] / 2 - b.r));
  const out = Math.hypot(...q.map((x) => Math.max(x, 0)));
  return out + Math.min(Math.max(q[0], q[1], q[2]), 0) - b.r;
}
const WAVE = { rest: 0, amp: 0.55 }; // экспортируется в extras: движок использует те же пределы
function checkArms(m: Model) {
  for (const a of m.arms) {
    const r = 0.034;
    for (let k = 0; k <= 20; k++) {
      const ang = (k / 20 * 2 - 1) * WAVE.amp; // поворот вокруг оси Z в плече
      for (let s = 0.12; s <= 1.0; s += 0.04) {
        const lx = a.side * a.len * 0.86 * s, ly = -a.len * 0.15 * s, lz = 0.1 * s;
        const c = Math.cos(ang * a.side), sn = Math.sin(ang * a.side);
        const p: V3 = [a.at[0] + lx * c - ly * sn, a.at[1] + lx * sn + ly * c, a.at[2] + lz];
        for (const b of m.bodies) {
          const d = sdRoundBox(p, b);
          if (d < r * 0.9) throw new Error(`[${m.id}] рука ${a.side < 0 ? 'L' : 'R'} заходит в корпус (угол ${ang.toFixed(2)}, d=${d.toFixed(3)})`);
        }
      }
    }
  }
}

/* ---------- запись GLB ---------- */
function toGLB(m: Model): Buffer {
  const fabricGeo = geo(); const parts = m.parts.map((g) => ({ g }));
  const { worldPerUv, rects } = atlasUV(parts);
  parts.forEach((p) => append(fabricGeo, p.g));
  const armNodes = m.arms.map((a) => ({ ...arm(a.side, a.len, m.armMat), t: a.at }));
  const scene: Node[] = [{ name: 'root', s: [m.scale ?? 1, m.scale ?? 1, m.scale ?? 1], extras: { title: m.title, worldPerUv, wave: WAVE, rects }, children: [
    { name: 'fabric', mesh: { geo: fabricGeo, mat: m.fabric } },
    { name: 'frame', mesh: { geo: m.frame, mat: m.frameMat } },
    { ...m.faceNode, t: m.faceAt },
    ...armNodes,
    { name: 'anchor', t: m.anchor }
  ] }];

  const bin: Buffer[] = []; let off = 0;
  const bufferViews: any[] = [], accessors: any[] = [], meshes: any[] = [], materials: any[] = [], nodes: any[] = [];
  const matIdx = new Map<string, number>();
  const view = (b: Buffer, target?: number) => { const pad = (4 - (b.length % 4)) % 4; bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) }); bin.push(b, Buffer.alloc(pad)); off += b.length + pad; return bufferViews.length - 1; };
  const acc = (arr: number[], type: 'VEC3' | 'VEC2' | 'SCALAR', comp: number, target: number, minmax = false) => {
    const b = comp === 5126 ? Buffer.from(new Float32Array(arr).buffer) : comp === 5125 ? Buffer.from(new Uint32Array(arr).buffer) : Buffer.from(new Uint16Array(arr).buffer);
    const n = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1; const a: any = { bufferView: view(b, target), componentType: comp, count: arr.length / n, type };
    if (minmax) { a.min = [0, 1, 2].map((k) => Math.min(...arr.filter((_, i) => i % 3 === k))); a.max = [0, 1, 2].map((k) => Math.max(...arr.filter((_, i) => i % 3 === k))); }
    accessors.push(a); return accessors.length - 1;
  };
  const matOf = (mt: Mat) => { if (!matIdx.has(mt.name + mt.color.join())) { materials.push({ name: mt.name, pbrMetallicRoughness: { baseColorFactor: [...mt.color, 1], metallicFactor: mt.metal, roughnessFactor: mt.rough } }); matIdx.set(mt.name + mt.color.join(), materials.length - 1); } return matIdx.get(mt.name + mt.color.join())!; };
  const addNode = (n: Node): number => {
    const o: any = { name: n.name };
    if (n.t) o.translation = n.t; if (n.r) o.rotation = n.r; if (n.s) o.scale = n.s; if (n.extras) o.extras = n.extras;
    if (n.mesh && n.mesh.geo.pos.length) {
      const g = n.mesh.geo; const big = g.pos.length / 3 > 65535;
      const attributes: any = { POSITION: acc(g.pos, 'VEC3', 5126, 34962, true), NORMAL: acc(g.nrm, 'VEC3', 5126, 34962) };
      if (g.uv.length) attributes.TEXCOORD_0 = acc(g.uv, 'VEC2', 5126, 34962);
      meshes.push({ name: n.name, primitives: [{ attributes, indices: acc(g.idx, 'SCALAR', big ? 5125 : 5123, 34963), material: matOf(n.mesh.mat) }] });
      o.mesh = meshes.length - 1;
    }
    nodes.push(o); const i = nodes.length - 1;
    if (n.children?.length) o.children = n.children.map(addNode);
    return i;
  };
  const roots = scene.map(addNode);
  const binBuf = Buffer.concat(bin);
  const gltf = { asset: { version: '2.0', generator: 'pompon build-models' }, scene: 0, scenes: [{ nodes: roots }], nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength: binBuf.length }] };
  let js = Buffer.from(JSON.stringify(gltf)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + binBuf.length, 8);
  const ch = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([header, ch(js.length, 0x4e4f534a), js, ch(binBuf.length, 0x004e4942), binBuf]);
}

const outDir = path.join(process.cwd(), 'models');
fs.mkdirSync(outDir, { recursive: true });
for (const build of [sofa, armchair, mattress, chair, other]) {
  const m = build();
  checkArms(m);
  const glb = toGLB(m);
  fs.writeFileSync(path.join(outDir, m.id + '.glb'), glb);
  const tris = (m.parts.reduce((a, g) => a + g.idx.length, 0) + m.frame.idx.length) / 3;
  console.log(`${m.id}.glb  ${(glb.length / 1024).toFixed(0)} КБ  ~${Math.round(tris)} треуг. (обивка+каркас)  руки: ок`);
}
