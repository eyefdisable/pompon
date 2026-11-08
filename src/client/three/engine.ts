/**
 * Небольшой WebGL2-движок «Помпона»: загрузка GLB, сцена с мебелью, планарная тень,
 * вращение пальцем/мышью с ограничениями, сброс ракурса, анимации лица и рук,
 * рендер только по необходимости, raycast + UV-маска для игры с пятнами.
 */
import { m4, mul, perspective, lookAt, fromTRS, quatAxis, quatMul, invert, normalMat, xform, project, shadowMatrix, norm, unproject, type M4, type V3 } from './math';
import type { CategoryId } from '../../shared/config';

interface Mesh { vao: WebGLVertexArrayObject; count: number; type: number; color: number[]; rough: number; isFabric: boolean;
  cpu?: { pos: Float32Array; nrm: Float32Array; uv: Float32Array | null; idx: Uint16Array | Uint32Array } }
interface Node { name: string; t: V3; r: [number, number, number, number]; s: V3; mesh?: Mesh; children: Node[]; world: M4; extras?: any;
  baseR: [number, number, number, number]; baseS: V3; baseT: V3 }
interface Model { id: CategoryId; root: Node; byName: Map<string, Node>; meshes: Node[]; radius: number; height: number; rects: number[][]; worldPerUv: number;
  mask?: { data: Uint8Array; tex: WebGLTexture; initial: number; dirty: boolean } }

export interface StageOptions { faces: boolean; reducedMotion: boolean; dprMax?: number }
export interface Anchor { x: number; y: number; eyesY: number; visible: boolean }
export interface StageEvents { onReady?(): void; onError?(kind: 'nowebgl' | 'load' | 'lost', detail?: string): void; onAnchor?(a: Anchor): void; onProgress?(p: number): void }

const VS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec2 a_uv;
uniform mat4 u_vp, u_model; uniform mat3 u_nm;
out vec3 v_n; out vec3 v_w; out vec2 v_uv;
void main(){ vec4 w = u_model * vec4(a_pos,1.0); v_w = w.xyz; v_n = normalize(u_nm * a_nrm); v_uv = a_uv; gl_Position = u_vp * w; }`;
const FS = `#version 300 es
precision highp float;
in vec3 v_n; in vec3 v_w; in vec2 v_uv; out vec4 o;
uniform vec3 u_color, u_eye, u_light; uniform float u_rough, u_fabric, u_dirtOn, u_dark; uniform sampler2D u_mask;
void main(){
  vec3 n = normalize(v_n); if(!gl_FrontFacing) n = -n;
  vec3 v = normalize(u_eye - v_w); vec3 l = normalize(u_light);
  float ndl = dot(n,l); float wrap = max((ndl + 0.45) / 1.45, 0.0);
  vec3 sky = mix(vec3(0.62,0.66,0.70), vec3(0.32,0.36,0.40), u_dark), ground = mix(vec3(0.42,0.38,0.33), vec3(0.18,0.17,0.16), u_dark);
  vec3 amb = mix(ground, sky, n.y*0.5+0.5);
  vec3 base = u_color;
  if (u_dirtOn > 0.5 && u_fabric > 0.5) { float m = texture(u_mask, v_uv).r; base = mix(base, vec3(0.27,0.18,0.09), smoothstep(0.0, 0.6, m)*0.9); }
  vec3 h = normalize(l+v); float sp = pow(max(dot(n,h),0.0), mix(64.0, 8.0, u_rough)) * (1.0-u_rough) * 0.6;
  float sheen = pow(1.0 - max(dot(n,v),0.0), 3.0) * 0.18 * u_fabric;
  vec3 c = base * (amb*0.75 + wrap*vec3(1.0,0.97,0.92)*1.05) + sp + sheen*vec3(1.0);
  c = c / (c + vec3(0.85)) * 1.7; // мягкий тонмаппинг
  o = vec4(pow(c, vec3(1.0/2.2)), 1.0);
}`;
const SVS = `#version 300 es
layout(location=0) in vec3 a_pos; uniform mat4 u_vp, u_model; uniform mat4 u_shadow;
void main(){ gl_Position = u_vp * u_shadow * u_model * vec4(a_pos,1.0); }`;
const SFS = `#version 300 es
precision mediump float; uniform float u_a; out vec4 o; void main(){ o = vec4(0.0,0.0,0.0,u_a); }`;
const BVS = `#version 300 es
layout(location=0) in vec3 a_pos; uniform mat4 u_vp; uniform vec3 u_scale; out vec2 v_p;
void main(){ v_p = a_pos.xz; gl_Position = u_vp * vec4(a_pos.x*u_scale.x, 0.001, a_pos.z*u_scale.z, 1.0); }`;
const BFS = `#version 300 es
precision mediump float; in vec2 v_p; uniform float u_a; out vec4 o;
void main(){ float d = length(v_p); float a = smoothstep(1.0, 0.0, d); o = vec4(0.0,0.0,0.0, a*a*u_a); }`;

const MASK = 512;
const LIGHT: V3 = norm([0.32, 1.0, 0.42]);
const DEFAULT_VIEW = { yaw: -0.42, pitch: 0.2, dist: 1 };

export class Stage {
  private gl!: WebGL2RenderingContext;
  private prog!: { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
  private sprog!: { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
  private bprog!: { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
  private blobVao!: WebGLVertexArrayObject;
  private emptyMask!: WebGLTexture;
  private models = new Map<CategoryId, Model>();
  private loading = new Map<CategoryId, Promise<Model>>();
  private current: Model | null = null; private leaving: Model | null = null;
  private trans = { t: 1, from: 0 };
  private view = { ...DEFAULT_VIEW }; private target = { ...DEFAULT_VIEW }; private vel = 0;
  private pointer = { x: 0, y: 0 };
  private anim = { waveStart: -1e9, blinkStart: -1e9 };
  private raf = 0; private visible = true; private destroyed = false;
  private dpr = 1; private w = 1; private h = 1;
  private vp: M4 = m4(); private eye: V3 = [0, 0, 0];
  private ro?: ResizeObserver; private io?: IntersectionObserver; private blinkTimer = 0;
  mode: 'rotate' | 'clean' = 'rotate';
  dirtEnabled = false;
  private dark = 0;

  constructor(private canvas: HTMLCanvasElement, private opts: StageOptions, private ev: StageEvents = {}) {}

  /** Возвращает false, если WebGL2 недоступен (интерфейс покажет постер). */
  init(): boolean {
    const gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true, stencil: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    if (!gl) { this.ev.onError?.('nowebgl'); return false; }
    this.gl = gl;
    try {
      this.prog = this.program(VS, FS, ['u_vp', 'u_model', 'u_nm', 'u_color', 'u_eye', 'u_light', 'u_rough', 'u_fabric', 'u_dirtOn', 'u_mask', 'u_dark']);
      this.sprog = this.program(SVS, SFS, ['u_vp', 'u_model', 'u_shadow', 'u_a']);
      this.bprog = this.program(BVS, BFS, ['u_vp', 'u_scale', 'u_a']);
    } catch (e: any) { this.ev.onError?.('nowebgl', e?.message); return false; }
    this.blobVao = this.quad();
    this.emptyMask = this.maskTexture(new Uint8Array(MASK * MASK));
    this.canvas.addEventListener('webglcontextlost', this.onLost, false);
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.canvas);
    this.io = new IntersectionObserver((es) => { this.visible = es[0]?.isIntersecting ?? true; if (this.visible) this.invalidate(); }, { threshold: 0.01 });
    this.io.observe(this.canvas);
    document.addEventListener('visibilitychange', this.onVis);
    this.resize();
    this.scheduleBlink();
    return true;
  }
  private onVis = () => { if (!document.hidden) this.invalidate(); };
  private onLost = (e: Event) => { e.preventDefault(); this.ev.onError?.('lost'); cancelAnimationFrame(this.raf); };

  destroy() {
    this.destroyed = true; cancelAnimationFrame(this.raf); clearTimeout(this.blinkTimer);
    this.ro?.disconnect(); this.io?.disconnect(); document.removeEventListener('visibilitychange', this.onVis);
    this.unbindInput?.();
    (this.gl?.getExtension('WEBGL_lose_context'))?.loseContext();
  }

  setOptions(o: Partial<StageOptions>) { Object.assign(this.opts, o); this.invalidate(); }
  setDark(d: boolean) { this.dark = d ? 1 : 0; this.invalidate(); }

  /* ---------- загрузка ---------- */
  preload(ids: CategoryId[], base = '/models/', version = '') { return Promise.all(ids.map((id) => this.load(id, base, version))); }
  load(id: CategoryId, base = '/models/', version = ''): Promise<Model> {
    if (this.models.has(id)) return Promise.resolve(this.models.get(id)!);
    if (!this.loading.has(id)) {
      const p = fetch(`${base}${id}.glb${version ? '?v=' + version : ''}`).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then((buf) => { const m = this.parse(id, buf); this.models.set(id, m); return m; })
        .catch((e) => { this.loading.delete(id); throw e; });
      this.loading.set(id, p);
    }
    return this.loading.get(id)!;
  }

  /** Плавная смена предмета. Быстрые повторные переключения: побеждает последний запрос. */
  private want: CategoryId | null = null;
  async show(id: CategoryId) {
    this.want = id;
    let m: Model;
    try { m = await this.load(id); } catch (e: any) { if (this.want === id) this.ev.onError?.('load', e?.message); return; }
    if (this.want !== id || this.destroyed) return;
    if (this.current === m) return;
    this.leaving = this.current && this.trans.t > 0.35 ? this.current : this.leaving;
    this.current = m;
    this.trans = { t: this.opts.reducedMotion ? 1 : 0, from: performance.now() };
    if (!this.opts.reducedMotion) this.anim.waveStart = performance.now() + 250;
    this.ev.onReady?.();
    this.invalidate();
  }

  resetView() { this.target = { ...DEFAULT_VIEW }; if (this.opts.reducedMotion) this.view = { ...DEFAULT_VIEW }; this.vel = 0; this.invalidate(); }
  greet() { if (!this.opts.reducedMotion) { this.anim.waveStart = performance.now(); this.invalidate(); } }

  /* ---------- игра: пятна в UV-маске ---------- */
  enableDirt(seed = 1) {
    const m = this.current; if (!m) return;
    const data = new Uint8Array(MASK * MASK);
    const fabric = m.byName.get('fabric')!.mesh!.cpu!;
    let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    // выбираем видимые сверху/спереди треугольники и рисуем пятна внутри их прямоугольника атласа
    const tri = fabric.idx.length / 3; let placed = 0, guard = 0;
    const fabNode = m.byName.get('fabric')!;
    // три прохода с ослаблением условий, чтобы пятна были всегда (и только на видимой обивке)
    for (const pass of [0, 1, 2]) {
      while (placed < 9 && guard++ < 5000 * (pass + 1)) {
        const t = Math.floor(rnd() * tri) * 3; const [a, b, c] = [fabric.idx[t], fabric.idx[t + 1], fabric.idx[t + 2]];
        // нормаль из вершин (не зависит от порядка обхода): в основном фронтальные поверхности — их лучше видно
        const n = norm([fabric.nrm[a * 3] + fabric.nrm[b * 3] + fabric.nrm[c * 3], fabric.nrm[a * 3 + 1] + fabric.nrm[b * 3 + 1] + fabric.nrm[c * 3 + 1], fabric.nrm[a * 3 + 2] + fabric.nrm[b * 3 + 2] + fabric.nrm[c * 3 + 2]]);
        // только плоская часть подушек (на скруглениях UV-проекция растянута); в основном фронт — его лучше видно
        const flat = Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])) > 0.985;
        if (!flat) continue;
        if (pass < 2 && n[2] < 0.9 && !(n[1] > 0.9 && rnd() < 0.35)) continue;
        const u = (fabric.uv![a * 2] + fabric.uv![b * 2] + fabric.uv![c * 2]) / 3, v = (fabric.uv![a * 2 + 1] + fabric.uv![b * 2 + 1] + fabric.uv![c * 2 + 1]) / 3;
        const rect = this.rectAt(m, u, v); if (!rect) continue;
        const rad = ((pass === 0 ? 0.15 : 0.11) + rnd() * 0.1) / m.worldPerUv;
        const margin = pass === 0 ? rad * 0.5 : 0;
        if (u - margin < rect[0] || u + margin > rect[0] + rect[2] || v - margin < rect[1] || v + margin > rect[1] + rect[3]) continue;
        // пятно только там, где его видно с начального ракурса: луч из камеры попадает в это же место
        const P = fabric.pos; const c3: V3 = [(P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3];
        const sp = project(this.vp, xform(fabNode.world, c3));
        const hit = this.raycast((sp[0] * 0.5 + 0.5) * this.w, (0.5 - sp[1] * 0.5) * this.h);
        if (!hit || Math.hypot(hit.uv[0] - u, hit.uv[1] - v) > rad * 0.4) continue;
        this.paint(data, u, v, rad, rect, 1, rnd); placed++;
      }
      if (placed >= 5) break;
    }
    let initial = 0; for (let i = 0; i < data.length; i++) initial += data[i];
    if (m.mask) this.gl.deleteTexture(m.mask.tex);
    m.mask = { data, tex: this.maskTexture(data), initial: Math.max(1, initial), dirty: false };
    this.dirtEnabled = true; this.ev.onProgress?.(0); this.invalidate();
  }
  disableDirt() { this.dirtEnabled = false; this.invalidate(); }

  private rectAt(m: Model, u: number, v: number) { return m.rects.find((r) => u >= r[0] && u <= r[0] + r[2] && v >= r[1] && v <= r[1] + r[3]); }
  private paint(data: Uint8Array, u: number, v: number, rad: number, rect: number[], sign: 1 | -1, rnd?: () => number) {
    const x0 = Math.floor(Math.max(rect[0], u - rad) * MASK), x1 = Math.ceil(Math.min(rect[0] + rect[2], u + rad) * MASK);
    const y0 = Math.floor(Math.max(rect[1], v - rad) * MASK), y1 = Math.ceil(Math.min(rect[1] + rect[3], v + rad) * MASK);
    const wob = rnd ? [rnd() * 6, rnd() * 6, 0.2 + rnd() * 0.25] : [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const du = x / MASK - u, dv = y / MASK - v; const ang = Math.atan2(dv, du);
      const r = rad * (1 + wob[2] * Math.sin(ang * 3 + wob[0]) * 0.5 + wob[2] * Math.sin(ang * 5 + wob[1]) * 0.3);
      const d = Math.hypot(du, dv) / r; if (d >= 1) continue;
      const k = (1 - d * d);
      const i = y * MASK + x;
      if (sign > 0) data[i] = Math.min(255, Math.max(data[i], Math.round(255 * Math.min(1, k * 1.6))));
      else data[i] = Math.max(0, data[i] - Math.round(110 * Math.min(1, k * 1.5)));
    }
  }
  /** Луч из точки экрана → ближайшее пересечение (обивка заслоняется каркасом/лицом). */
  private raycast(cx: number, cy: number): { uv: [number, number] } | null {
    const m = this.current; if (!m) return null;
    const ndcX = (cx / this.w) * 2 - 1, ndcY = 1 - (cy / this.h) * 2;
    const inv = invert(this.vp);
    const p0 = unproject(inv, [ndcX, ndcY, -1]), p1 = unproject(inv, [ndcX, ndcY, 1]);
    let best = Infinity, hit: { uv: [number, number] } | null = null;
    for (const node of m.meshes) {
      const cpu = node.mesh!.cpu; if (!cpu) continue;
      const invW = invert(node.world);
      const o = xform(invW, [p0[0], p0[1], p0[2]]), e = xform(invW, [p1[0], p1[1], p1[2]]);
      const d: V3 = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
      const P = cpu.pos, I = cpu.idx;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
        const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-9) continue;
        const id = 1 / det; const tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
        const u = (tx * px + ty * py + tz * pz) * id; if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * id; if (v < 0 || u + v > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * id;
        if (dist > 0 && dist < best) {
          best = dist;
          if (node.mesh!.isFabric && cpu.uv) {
            const ia = I[t] * 2, ib = I[t + 1] * 2, ic = I[t + 2] * 2, w = 1 - u - v;
            hit = { uv: [cpu.uv[ia] * w + cpu.uv[ib] * u + cpu.uv[ic] * v, cpu.uv[ia + 1] * w + cpu.uv[ib + 1] * u + cpu.uv[ic + 1] * v] };
          } else hit = null;
        }
      }
    }
    return hit;
  }
  /** Стирание вдоль штриха: точки через каждые ~6 px, чтобы быстрый жест не оставлял пропусков. */
  private scrub(cx: number, cy: number, from?: { x: number; y: number }) {
    const m = this.current; if (!m?.mask || !this.dirtEnabled) return;
    const steps = from ? Math.max(1, Math.ceil(Math.hypot(cx - from.x, cy - from.y) / 6)) : 1;
    let any = false;
    for (let i = 1; i <= steps; i++) {
      const x = from ? from.x + (cx - from.x) * (i / steps) : cx, y = from ? from.y + (cy - from.y) * (i / steps) : cy;
      const h = this.raycast(x, y); if (!h) continue;
      const rect = this.rectAt(m, h.uv[0], h.uv[1]); if (!rect) continue;
      this.paint(m.mask.data, h.uv[0], h.uv[1], 0.15 / m.worldPerUv, rect, -1); any = true;
    }
    if (!any) return;
    m.mask.dirty = true;
    let sum = 0; const d = m.mask.data; for (let i = 0; i < d.length; i++) sum += d[i];
    this.ev.onProgress?.(Math.min(1, 1 - sum / m.mask.initial));
    this.invalidate();
  }

  /* ---------- ввод ---------- */
  private unbindInput?: () => void;
  private bindInput() {
    const c = this.canvas; const pts = new Map<number, { x: number; y: number }>(); let last = 0; let pinch = 0;
    const local = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => { pts.set(e.pointerId, local(e)); c.setPointerCapture(e.pointerId); last = performance.now(); this.vel = 0;
      if (this.mode === 'clean') { const p = local(e); this.scrub(p.x, p.y); } };
    const move = (e: PointerEvent) => {
      const p = local(e);
      this.pointer = { x: (p.x / this.w) * 2 - 1, y: 1 - (p.y / this.h) * 2 };
      const prev = pts.get(e.pointerId);
      if (!prev) { if (e.pointerType === 'mouse' && this.opts.faces) this.invalidate(); return; }
      if (pts.size === 2) {
        pts.set(e.pointerId, p); const [a, b] = [...pts.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.target.dist = Math.min(1.35, Math.max(0.7, this.target.dist * (pinch / dist))); pinch = dist; this.invalidate(); return;
      }
      pts.set(e.pointerId, p);
      if (this.mode === 'clean') { this.scrub(p.x, p.y, prev); return; }
      const dx = p.x - prev.x, dy = p.y - prev.y; const now = performance.now();
      this.target.yaw += dx * 0.0105; this.vel = (dx * 0.0105) / Math.max(8, now - last) * 16; last = now;
      if (e.pointerType === 'mouse') this.target.pitch = Math.min(0.62, Math.max(0.02, this.target.pitch + dy * 0.005));
      this.invalidate();
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; if (performance.now() - last > 80) this.vel = 0; this.invalidate(); };
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); this.target.dist = Math.min(1.35, Math.max(0.7, this.target.dist * (1 + e.deltaY * 0.002))); this.invalidate(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') this.target.yaw -= 0.25; else if (e.key === 'ArrowRight') this.target.yaw += 0.25;
      else if (e.key === 'ArrowUp') this.target.pitch = Math.min(0.62, this.target.pitch + 0.08); else if (e.key === 'ArrowDown') this.target.pitch = Math.max(0.02, this.target.pitch - 0.08);
      else if (e.key === '0' || e.key === 'Home') this.resetView(); else return;
      e.preventDefault(); this.invalidate();
    };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false }); c.addEventListener('keydown', key);
    this.unbindInput = () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); c.removeEventListener('wheel', wheel); c.removeEventListener('keydown', key); };
  }

  /* ---------- цикл рендера (только когда есть что менять) ---------- */
  invalidate = () => { if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.frame); };
  private scheduleBlink() {
    clearTimeout(this.blinkTimer);
    if (this.opts.reducedMotion) return;
    this.blinkTimer = window.setTimeout(() => { this.anim.blinkStart = performance.now(); this.invalidate(); this.scheduleBlink(); }, 3500 + Math.random() * 4500);
  }
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.opts.dprMax ?? 1.75);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.invalidate();
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.visible || document.hidden || !this.current) return;
    let busy = false;
    // камера: плавное приближение к цели + инерция вращения
    if (Math.abs(this.vel) > 0.0004) { this.target.yaw += this.vel; this.vel *= 0.92; busy = true; } else this.vel = 0;
    const k = this.opts.reducedMotion ? 1 : 0.2;
    for (const key of ['yaw', 'pitch', 'dist'] as const) { const d = this.target[key] - this.view[key]; this.view[key] += d * k; if (Math.abs(d) > 0.0005) busy = true; }
    if (this.trans.t < 1) { this.trans.t = Math.min(1, (now - this.trans.from) / 420); busy = true; if (this.trans.t >= 1) this.leaving = null; }
    busy = this.animate(this.current, now) || busy;
    if (this.current.mask?.dirty) { this.uploadMask(this.current.mask); }
    this.draw();
    if (busy) this.invalidate();
  };

  private animate(m: Model, now: number): boolean {
    let busy = false;
    const wave = (now - this.anim.waveStart) / 1000;
    const amp = (m.root.extras?.wave?.amp ?? 0.55);
    for (const side of ['armL', 'armR']) {
      const n = m.byName.get(side); if (!n) continue;
      const sgn = side === 'armL' ? -1 : 1;
      let a = 0;
      if (wave >= 0 && wave < 1.6) { a = Math.sin(wave * Math.PI * 3.2) * amp * Math.sin(Math.min(1, wave / 1.6) * Math.PI) * (side === 'armR' ? 1 : 0.35); busy = true; }
      n.r = quatMul(n.baseR, quatAxis([0, 0, 1], a * sgn));
    }
    const blink = (now - this.anim.blinkStart) / 150;
    const sy = blink >= 0 && blink < 2 ? Math.max(0.12, Math.abs(1 - blink)) : 1; if (blink >= 0 && blink < 2) busy = true;
    for (const e of ['eyeL', 'eyeR']) { const n = m.byName.get(e); if (n) n.s = [n.baseS[0], n.baseS[1] * sy, n.baseS[2]]; }
    for (const pName of ['pupilL', 'pupilR']) {
      const n = m.byName.get(pName); if (!n) continue;
      n.t = [n.baseT[0] + this.pointer.x * 0.012, n.baseT[1] + this.pointer.y * 0.01, n.baseT[2]];
    }
    return busy;
  }

  private updateWorld(n: Node, parent: M4) {
    n.world = mul(parent, fromTRS(n.t, n.r, n.s));
    for (const c of n.children) this.updateWorld(c, n.world);
  }

  private draw() {
    const gl = this.gl; const m = this.current!;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const aspect = this.w / this.h;
    // камера вписывает ограничивающую сферу предмета (с руками) и по вертикали, и по горизонтали
    const halfV = 0.3, halfH = Math.atan(Math.tan(halfV) * aspect);
    const dist = (m.radius / Math.sin(Math.min(halfV, halfH))) * (aspect > 1 ? 0.8 : 0.9) * this.view.dist;
    const tgt: V3 = [0, m.height * 0.46, 0];
    this.eye = [tgt[0], tgt[1] + Math.sin(this.view.pitch) * dist, tgt[2] + Math.cos(this.view.pitch) * dist];
    this.vp = mul(perspective(0.6, aspect, 0.1, 60), lookAt(this.eye, tgt));

    const list: [Model, number][] = [];
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    if (this.leaving && this.trans.t < 1) list.push([this.leaving, Math.max(0.001, 1 - ease(Math.min(1, this.trans.t * 2.2)))]);
    const tIn = this.trans.t; const back = tIn < 1 ? 1 + 0.08 * Math.sin(tIn * Math.PI) : 1;
    list.push([m, Math.max(0.001, ease(tIn) * back)]);

    for (const [model, sc] of list) {
      const rootS = model.root.baseS;
      model.root.s = [rootS[0] * sc, rootS[1] * sc, rootS[2] * sc];
      model.root.r = quatAxis([0, 1, 0], this.view.yaw);
      this.updateWorld(model.root, m4());
    }
    // 1) мягкое контактное пятно и 2) планарная тень (stencil — без двойного затемнения)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.bprog.p); gl.uniformMatrix4fv(this.bprog.u.u_vp, false, this.vp);
    for (const [model, sc] of list) {
      gl.uniform3f(this.bprog.u.u_scale, model.radius * 0.95 * sc, 1, model.radius * 0.62 * sc);
      gl.uniform1f(this.bprog.u.u_a, this.dark ? 0.5 : 0.22);
      gl.bindVertexArray(this.blobVao); gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    gl.useProgram(this.sprog.p); gl.uniformMatrix4fv(this.sprog.u.u_vp, false, this.vp); gl.uniformMatrix4fv(this.sprog.u.u_shadow, false, shadowMatrix(LIGHT));
    gl.uniform1f(this.sprog.u.u_a, this.dark ? 0.3 : 0.12);
    for (const [model] of list) for (const n of this.visibleMeshes(model)) {
      gl.uniformMatrix4fv(this.sprog.u.u_model, false, n.world); gl.bindVertexArray(n.mesh!.vao); gl.drawElements(gl.TRIANGLES, n.mesh!.count, n.mesh!.type, 0);
    }
    gl.disable(gl.STENCIL_TEST);
    // 3) сами предметы
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    const P = this.prog; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.u_vp, false, this.vp); gl.uniform3fv(P.u.u_eye, this.eye); gl.uniform3fv(P.u.u_light, LIGHT); gl.uniform1f(P.u.u_dark, this.dark);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(P.u.u_mask, 0);
    for (const [model] of list) for (const n of this.visibleMeshes(model)) {
      const me = n.mesh!;
      gl.uniformMatrix4fv(P.u.u_model, false, n.world); gl.uniformMatrix3fv(P.u.u_nm, false, normalMat(n.world));
      gl.uniform3fv(P.u.u_color, me.color); gl.uniform1f(P.u.u_rough, me.rough); gl.uniform1f(P.u.u_fabric, me.isFabric ? 1 : 0);
      const dirt = this.dirtEnabled && me.isFabric && model === m && m.mask;
      gl.uniform1f(P.u.u_dirtOn, dirt ? 1 : 0); gl.bindTexture(gl.TEXTURE_2D, dirt ? m.mask!.tex : this.emptyMask);
      gl.bindVertexArray(me.vao); gl.drawElements(gl.TRIANGLES, me.count, me.type, 0);
    }
    gl.bindVertexArray(null);
    // 4) якорь реплики: проекция точки над головой и глаз — в CSS-пикселях
    const anchor = m.byName.get('anchor'), eye = m.byName.get('eyeL');
    if (anchor && this.ev.onAnchor) {
      const a = project(this.vp, xform(anchor.world, [0, 0, 0])); const e = eye ? project(this.vp, xform(eye.world, [0, 0, 0])) : a;
      this.ev.onAnchor({ x: (a[0] * 0.5 + 0.5) * this.w, y: (0.5 - a[1] * 0.5) * this.h, eyesY: (0.5 - e[1] * 0.5) * this.h, visible: this.trans.t > 0.8 });
    }
  }
  private visibleMeshes(m: Model) {
    return m.meshes.filter((n) => this.opts.faces || !(n.extras?.facePart));
  }

  /* ---------- GLB ---------- */
  private parse(id: CategoryId, buf: ArrayBuffer): Model {
    const gl = this.gl; const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Не GLB');
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    const binOff = 20 + jsonLen + 8;
    const accessor = (i: number) => {
      const a = json.accessors[i], v = json.bufferViews[a.bufferView]; const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type as 'SCALAR'] * a.count;
      const off = binOff + (v.byteOffset || 0) + (a.byteOffset || 0);
      return a.componentType === 5126 ? new Float32Array(buf.slice(off, off + n * 4)) : a.componentType === 5125 ? new Uint32Array(buf.slice(off, off + n * 4)) : new Uint16Array(buf.slice(off, off + n * 2));
    };
    const meshCache = new Map<number, Mesh>();
    const makeMesh = (mi: number, name: string): Mesh => {
      if (meshCache.has(mi)) return meshCache.get(mi)!;
      const prim = json.meshes[mi].primitives[0]; const mat = json.materials[prim.material];
      const pos = accessor(prim.attributes.POSITION) as Float32Array, nrm = accessor(prim.attributes.NORMAL) as Float32Array;
      const uv = prim.attributes.TEXCOORD_0 !== undefined ? accessor(prim.attributes.TEXCOORD_0) as Float32Array : null;
      const idx = accessor(prim.indices) as Uint16Array | Uint32Array;
      const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
      const attr = (loc: number, data: Float32Array, size: number) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
      attr(0, pos, 3); attr(1, nrm, 3); if (uv) attr(2, uv, 2); else { gl.disableVertexAttribArray(2); gl.vertexAttrib2f(2, 0, 0); }
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const c = mat.pbrMetallicRoughness.baseColorFactor;
      const isFabric = name === 'fabric';
      const mesh: Mesh = { vao, count: idx.length, type: idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, color: [c[0], c[1], c[2]], rough: mat.pbrMetallicRoughness.roughnessFactor ?? 0.8, isFabric,
        cpu: name === 'fabric' || name === 'frame' ? { pos, nrm, uv, idx } : undefined };
      meshCache.set(mi, mesh); return mesh;
    };
    const byName = new Map<string, Node>(); const meshes: Node[] = [];
    const build = (i: number, facePart: boolean): Node => {
      const j = json.nodes[i];
      const isFace = facePart || j.name === 'face' || j.name === 'armL' || j.name === 'armR';
      const n: Node = { name: j.name, t: j.translation ?? [0, 0, 0], r: j.rotation ?? [0, 0, 0, 1], s: j.scale ?? [1, 1, 1], children: [], world: m4(), extras: { ...(j.extras || {}), facePart: isFace },
        baseR: j.rotation ?? [0, 0, 0, 1], baseS: j.scale ?? [1, 1, 1], baseT: j.translation ?? [0, 0, 0] };
      if (j.mesh !== undefined) { n.mesh = makeMesh(j.mesh, j.name); meshes.push(n); }
      byName.set(j.name, n);
      n.children = (j.children || []).map((c: number) => build(c, isFace));
      return n;
    };
    const root = build(json.scenes[0].nodes[0], false);
    const fab = json.accessors[json.meshes[json.nodes.find((n: any) => n.name === 'fabric').mesh].primitives[0].attributes.POSITION];
    const sc = root.s[0];
    const hx = Math.max(Math.abs(fab.min[0]), Math.abs(fab.max[0])) + 0.3, hz = Math.max(Math.abs(fab.min[2]), Math.abs(fab.max[2])), hy = fab.max[1] * 0.56;
    const radius = Math.hypot(hx, hy, hz) * sc;
    const ext = root.extras || {};
    return { id, root, byName, meshes, radius, height: fab.max[1] * sc, rects: ext.rects ?? [], worldPerUv: ext.worldPerUv ?? 1 };
  }

  /* ---------- служебное ---------- */
  private program(vs: string, fs: string, names: string[]) {
    const gl = this.gl; const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    return { p, u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])) };
  }
  private quad() {
    const gl = this.gl; const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null); return vao;
  }
  private maskTexture(data: Uint8Array) {
    const gl = this.gl; const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MASK, MASK, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private uploadMask(mask: NonNullable<Model['mask']>) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, mask.tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MASK, MASK, gl.RED, gl.UNSIGNED_BYTE, mask.data); mask.dirty = false;
  }
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
}
