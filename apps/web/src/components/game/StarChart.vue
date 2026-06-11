<script setup lang="ts">
/**
 * Player star chart — the fog-of-war map as a voxel starfield (see mockup
 * map-player-3-starfield.html). Renders a server-authored `MapView` of the sectors the
 * trader has *visited*: inhabited ones as their actual pixel-planet, empties as waypoint
 * dots, lanes between them + taken wormholes as trails. The lane-neighbours of visited space
 * arrive as `fog: 'frontier'` "?" nodes — the edge of the known galaxy, which you can tap to
 * plot a course at and fly into (wormhole far-ends stay hidden until taken, so they're never
 * frontier). Drag to pan, scroll to zoom; a tap emits `select` so the parent can show the
 * sector panel (or, for a frontier "?", just plot the route). No danger overlay — that's
 * server geometry, kept off the chart.
 *
 * Distinct from the admin `GalaxyMap` (a technical scatter for debugging generation) on
 * purpose: this is the exploration experience. The sector *panel* under it still reuses the
 * shared `OrbitPanel`, so "what's in this sector" stays single-sourced.
 */
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { MapView, PresenceMap } from '../../api';
import { planetSprite } from './planet';

const props = defineProps<{
  view: MapView;
  current: number;
  selected: number | null;
  /** ordered sector ids of a plotted course (current → target) to highlight; [] = none */
  route?: number[];
  /** sectorId → count of *other* traders parked there (drives the blue "players here" pip) */
  presence?: PresenceMap;
}>();
const emit = defineEmits<{ select: [id: number] }>();

type Node = MapView['sectors'][number];

const wrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

// id → node, rebuilt whenever the fog view changes.
const byId = new Map<number, Node>();
function indexNodes(): void {
  byId.clear();
  for (const n of props.view.sectors) byId.set(n.id, n);
}

// Camera: world centre in sector-grid coords + zoom in px per sector unit. Default is
// "centred on you, comfortably zoomed in" — adjacent sectors are 1 grid unit apart, so the
// zoom sets how much clear space sits between worlds (sprites stay a fixed pixel size). The
// bubble runs off-screen and you drag to roam.
const cam = { cx: 16, cy: 16, zoom: 46 };
const MIN_Z = 12, MAX_Z = 110;
function centerOnCurrent(): void {
  const n = byId.get(props.current);
  if (n) { cam.cx = n.x; cam.cy = n.y; }
}

// Representative glow colour per palette (the mid-ramp tone of each in ./planet).
const GLOW: Record<string, string> = {
  ocean: '58,158,150', lava: '224,110,36', ice: '150,200,224',
  arid: '196,150,86', rock: '120,120,128', gas: '214,176,120',
};

// Screen-space ambience starfield (does not pan — pure atmosphere).
const stars: [number, number, number][] = [];
{ let a = 0x9e3779b1 >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < 120; i++) stars.push([rnd(), rnd(), rnd()]); }

let nodeScreen: { id: number; sx: number; sy: number; fog: string }[] = [];
let pulse = 0;
let raf: number | null = null;

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: string, lw: number): void {
  ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
}
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, rgb: string, r: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},.45)`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}
function label(ctx: CanvasRenderingContext2D, x: number, y: number, txt: string, col: string): void {
  ctx.fillStyle = col; ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(txt, x, y + 13);
}

function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas) { raf = requestAnimationFrame(draw); return; }
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!ctx || !w) { raf = requestAnimationFrame(draw); return; }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const P = (x: number, y: number) => ({ x: (x - cam.cx) * cam.zoom + w / 2, y: (y - cam.cy) * cam.zoom + h / 2 });

  // ambience
  for (const [a, b, c] of stars) { ctx.globalAlpha = 0.12 + c * 0.45; ctx.fillStyle = '#bcd6ff'; ctx.fillRect((a * w) | 0, (b * h) | 0, c < 0.1 ? 2 : 1, 1); }
  ctx.globalAlpha = 1;

  // edges
  for (const e of props.view.edges) {
    const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b) continue;
    const pa = P(a.x, a.y), pb = P(b.x, b.y);
    if (e.kind === 'wormhole') {
      ctx.strokeStyle = 'rgba(232,181,74,.5)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, dx = pb.x - pa.x, dy = pb.y - pa.y;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(mx - dy * 0.14, my + dx * 0.14, pb.x, pb.y); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(90,209,201,.22)'; ctx.setLineDash([]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // plotted route highlight — a bright course laid over the lanes/wormholes it follows
  const route = props.route;
  if (route && route.length > 1) {
    const kindOf = new Map<string, string>();
    for (const e of props.view.edges) kindOf.set(`${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`, e.kind);
    const seg = (a: { x: number; y: number }, b: { x: number; y: number }, wormhole: boolean) => {
      const pa = P(a.x, a.y), pb = P(b.x, b.y);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y);
      if (wormhole) {
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, dx = pb.x - pa.x, dy = pb.y - pa.y;
        ctx.quadraticCurveTo(mx - dy * 0.14, my + dx * 0.14, pb.x, pb.y);
      } else ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    };
    for (let i = 1; i < route.length; i++) {
      const a = byId.get(route[i - 1]), b = byId.get(route[i]); if (!a || !b) continue;
      const wormhole = kindOf.get(`${Math.min(route[i - 1], route[i])}-${Math.max(route[i - 1], route[i])}`) === 'wormhole';
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(125,225,210,.22)'; ctx.lineWidth = 6; seg(a, b, wormhole);          // underglow
      if (wormhole) ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(160,240,210,.95)'; ctx.lineWidth = 2.2; seg(a, b, wormhole);          // bright core
    }
    ctx.setLineDash([]);
  }

  // nodes
  nodeScreen = [];
  for (const n of props.view.sectors) {
    const s = P(n.x, n.y);
    if (n.fog === 'frontier') {
      ctx.strokeStyle = 'rgba(120,140,170,.55)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#8a9bbd'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', s.x, s.y);
    } else if (n.planet) {
      const isSol = n.id === 0;
      glow(ctx, s.x, s.y, isSol ? '232,181,74' : (GLOW[n.planet.palette] ?? '90,160,200'), 18);
      const sz = isSol ? 26 : 20;
      ctx.drawImage(planetSprite(`Sector #${n.id}`, n.planet.palette, sz, n.planet.spin), s.x - sz / 2, s.y - sz / 2);
      if (isSol) ring(ctx, s.x, s.y, 16, 'rgba(232,181,74,.9)', 1.4);
      else if (n.unexploredWormhole) ring(ctx, s.x, s.y, sz / 2 + 3, 'rgba(232,181,74,.8)', 1.2);
      label(ctx, s.x, s.y, isSol ? 'Sol' : n.planet.name, isSol ? '#e8b54a' : '#cdd9ee');
    } else {
      // visited deep-space waypoint
      ctx.fillStyle = '#2c3c58'; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, 7); ctx.fill();
      if (n.unexploredWormhole) ring(ctx, s.x, s.y, 8, 'rgba(232,181,74,.8)', 1.2);
    }
    if (n.id === props.selected && n.id !== props.current) ring(ctx, s.x, s.y, 14, 'rgba(90,209,201,.95)', 1.6);
    if (n.id === props.current) {
      const pr = 15 + Math.sin(pulse) * 2.5;
      ring(ctx, s.x, s.y, pr, `rgba(155,227,127,${0.75 + 0.25 * Math.sin(pulse)})`, 1.8);
    }
    // Other players parked here → a blue pip at the node's upper-right (count if >1).
    const others = props.presence?.[n.id] ?? 0;
    if (others > 0) {
      const off = n.planet ? (n.id === 0 ? 13 : 10) : 6;
      const px = s.x + off, py = s.y - off, pr = others > 1 ? 6.5 : 3.8;
      ctx.fillStyle = 'rgba(91,140,255,.96)'; ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(10,18,40,.9)'; ctx.lineWidth = 1; ctx.stroke();
      if (others > 1) {
        ctx.fillStyle = '#eaf0ff'; ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(others), px, py);
      }
    }
    nodeScreen.push({ id: n.id, sx: s.x, sy: s.y, fog: n.fog });
  }

  pulse += 0.08;
  raf = requestAnimationFrame(draw);
}

// ── interaction: drag to pan, scroll to zoom, tap to select ────────────────────
let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
function onDown(e: PointerEvent): void {
  drag = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy, moved: false };
  canvasRef.value?.setPointerCapture(e.pointerId);
  canvasRef.value?.classList.add('grabbing');
}
function onMove(e: PointerEvent): void {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  cam.cx = drag.cx - dx / cam.zoom; cam.cy = drag.cy - dy / cam.zoom;
}
function onUp(e: PointerEvent): void {
  const wasDrag = drag?.moved; drag = null;
  canvasRef.value?.classList.remove('grabbing');
  if (wasDrag) return;
  const canvas = canvasRef.value; if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let best: { id: number } | null = null, bd = Infinity;
  for (const n of nodeScreen) { const d = Math.hypot(n.sx - mx, n.sy - my); if (d < bd) { bd = d; best = n; } }
  if (best && bd <= 24) emit('select', best.id);
}
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  cam.zoom = Math.max(MIN_Z, Math.min(MAX_Z, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
}

watch(() => props.view, indexNodes);
watch(() => props.current, centerOnCurrent);

onMounted(() => {
  indexNodes();
  centerOnCurrent();
  raf = requestAnimationFrame(draw);
});
onUnmounted(() => { if (raf !== null) cancelAnimationFrame(raf); });
</script>

<template>
  <div ref="wrapRef" class="chart">
    <canvas
      ref="canvasRef"
      class="sky"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @wheel="onWheel"
    />
    <div class="hint">drag to pan · scroll to zoom · tap a world to inspect</div>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  height: 268px;
  border: 1px solid #1f2a3d;
  border-radius: 14px;
  background: radial-gradient(70% 70% at 50% 45%, #0e1730, #070b14);
  overflow: hidden;
}
.sky { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.sky.grabbing { cursor: grabbing; }
.hint {
  position: absolute; left: 0; right: 0; bottom: 6px; text-align: center;
  color: #5d6b85; font-size: 10px; pointer-events: none;
}
</style>
