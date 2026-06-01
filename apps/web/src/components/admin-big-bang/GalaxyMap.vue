<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { SIDE, fullMapView, type Galaxy, type MapView } from '@starwonder/game-core';

const props = defineProps<{
  /** admin: the full galaxy — enables the blocked-lane overlay and derives a full view */
  galaxy?: Galaxy;
  /** player: a fogged view from the server (takes precedence over `galaxy`) */
  view?: MapView;
  /** "you are here" marker */
  current?: number | null;
  showBlocked?: boolean;
  showWormholes?: boolean;
  showGradient?: boolean;
  /** highlighted sector id (explorer); null/undefined = none */
  selected?: number | null;
}>();

const emit = defineEmits<{ select: [id: number] }>();

const wrapperRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

// One renderer, two data sources: an explicit fogged view, or the full galaxy expanded
// into an omniscient view. Everything below draws purely from `view`.
const view = computed<MapView | null>(() =>
  props.view ?? (props.galaxy ? fullMapView(props.galaxy) : null),
);

const posById = computed(() => {
  const m = new Map<number, { x: number; y: number }>();
  for (const n of view.value?.sectors ?? []) m.set(n.id, { x: n.x, y: n.y });
  return m;
});

// Map a canvas click to a known sector at that grid cell and emit it.
function onClick(e: MouseEvent): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const size = canvas.clientWidth;
  if (!size) return;
  const rect = canvas.getBoundingClientRect();
  const MARGIN = 16;
  const CELL = (size - 2 * MARGIN) / SIDE;
  const gx = Math.round((e.clientX - rect.left - MARGIN) / CELL - 0.5);
  const gy = Math.round((e.clientY - rect.top - MARGIN) / CELL - 0.5);
  for (const n of view.value?.sectors ?? []) {
    if (n.x === gx && n.y === gy) {
      emit('select', n.id);
      return;
    }
  }
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const v = view.value;

  const size = canvas.clientWidth;
  if (!size) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  const MARGIN = 16;
  const CELL = (size - 2 * MARGIN) / SIDE;
  const px = (x: number) => MARGIN + (x + 0.5) * CELL;
  const py = (y: number) => MARGIN + (y + 0.5) * CELL;

  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, size, size);
  if (!v) return;

  // Danger gradient overlay (per-node, works for fog + full)
  if (props.showGradient) {
    for (const n of v.sectors) {
      const dv = n.danger;
      ctx.fillStyle = `hsla(${135 - dv * 135}, 72%, ${50 - dv * 16}%, 0.28)`;
      ctx.fillRect(MARGIN + n.x * CELL, MARGIN + n.y * CELL, CELL, CELL);
    }
  }

  // Blocked (closed) lanes — admin debug overlay, needs the full galaxy
  const g = props.galaxy;
  if (props.showBlocked && g) {
    const whKeys = new Set(g.wormholes.map((w) => `${Math.min(w.a, w.b)}-${Math.max(w.a, w.b)}`));
    ctx.strokeStyle = '#3a2230';
    ctx.lineWidth = 0.7;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (let d = 0; d < g.dist.length; d++) {
      if (g.dist[d] < 0) continue;
      const { x, y } = g.layout.xy[d];
      for (const [dx, dy] of [[1, 0], [0, 1]] as [number, number][]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= SIDE || ny >= SIDE) continue;
        const nd = g.layout.d[ny * SIDE + nx];
        if (g.dist[nd] < 0) continue;
        const key = `${Math.min(d, nd)}-${Math.max(d, nd)}`;
        if (!g.adj[d].includes(nd) || whKeys.has(key)) {
          ctx.moveTo(px(x), py(y));
          ctx.lineTo(px(g.layout.xy[nd].x), py(g.layout.xy[nd].y));
        }
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Open lanes
  ctx.strokeStyle = '#3f7e78';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const e of v.edges) {
    if (e.kind !== 'lane') continue;
    const a = posById.value.get(e.a), b = posById.value.get(e.b);
    if (!a || !b) continue;
    ctx.moveTo(px(a.x), py(a.y));
    ctx.lineTo(px(b.x), py(b.y));
  }
  ctx.stroke();

  // Wormholes (curved gold arcs)
  if (props.showWormholes) {
    for (const e of v.edges) {
      if (e.kind !== 'wormhole') continue;
      const a = posById.value.get(e.a), b = posById.value.get(e.b);
      if (!a || !b) continue;
      const x1 = px(a.x), y1 = py(a.y);
      const x2 = px(b.x), y2 = py(b.y);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const dx = x2 - x1, dy = y2 - y1;
      ctx.strokeStyle = 'rgba(232,181,74,.38)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(mx - dy * 0.12, my + dx * 0.12, x2, y2);
      ctx.stroke();
    }
  }

  // Sector dots
  for (const n of v.sectors) {
    if (n.id === 0) continue; // Sol drawn specially below
    const cx = px(n.x), cy = py(n.y);
    if (n.fog === 'frontier') {
      ctx.fillStyle = '#1c2740';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.3, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.fillStyle = n.inhabited ? '#cdd9ee' : '#26344d';
    ctx.beginPath();
    ctx.arc(cx, cy, n.inhabited ? 2.2 : 1.4, 0, Math.PI * 2);
    ctx.fill();
    // unexplored-wormhole marker
    if (n.unexploredWormhole) {
      ctx.strokeStyle = 'rgba(232,181,74,.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Selection ring (explorer)
  if (props.selected != null && posById.value.has(props.selected)) {
    const p = posById.value.get(props.selected)!;
    ctx.strokeStyle = '#7fdbff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // "You are here"
  if (props.current != null && posById.value.has(props.current)) {
    const p = posById.value.get(props.current)!;
    ctx.strokeStyle = '#9be37f';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), 4.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Sol marker
  const sol = posById.value.get(0);
  if (sol) {
    const cx0 = px(sol.x), cy0 = py(sol.y);
    ctx.fillStyle = '#e8b54a';
    ctx.beginPath();
    ctx.arc(cx0, cy0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,181,74,.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx0, cy0, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8b54a';
    ctx.font = `${Math.max(8, CELL * 0.55)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('Sol', cx0, cy0 - 8);
  }
}

watch(
  () => [props.galaxy, props.view, props.current, props.showBlocked, props.showWormholes, props.showGradient, props.selected] as const,
  () => draw(),
);

onMounted(() => {
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(wrapperRef.value!);
  onUnmounted(() => ro.disconnect());
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div ref="wrapperRef" class="relative aspect-square w-full rounded-xl overflow-hidden bg-[#070b14] border border-line">
      <canvas ref="canvasRef" class="absolute inset-0 w-full h-full" style="cursor: crosshair" @click="onClick" />
    </div>

    <!-- Legend -->
    <div class="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-[11px] text-muted">
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-2 h-2 rounded-full bg-fg opacity-80"></span> star
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-2 h-2 rounded-full" style="background:#26344d"></span> empty sector
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-4 h-0.5 rounded" style="background:#3f7e78"></span> open lane
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-4 h-0.5 rounded" style="background:#e8b54a; opacity:.7"></span> wormhole
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-2 h-2 rounded-full bg-good"></span> calm →
        <span class="inline-block w-2 h-2 rounded-full bg-bad ml-0.5"></span> danger
      </span>
    </div>
  </div>
</template>
