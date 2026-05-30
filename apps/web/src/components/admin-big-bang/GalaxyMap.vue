<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { dangerCurve, SIDE, N, type Galaxy } from '@starwonder/game-core';

const props = defineProps<{
  galaxy: Galaxy;
  showBlocked: boolean;
  showWormholes: boolean;
  showGradient: boolean;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

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

  const g = props.galaxy;
  const lay = g.layout;
  const live = (d: number) => g.dist[d] >= 0;

  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, size, size);

  // Build open lane set and wormhole set
  const whKeys = new Set(g.wormholes.map((w) => `${Math.min(w.a, w.b)}-${Math.max(w.a, w.b)}`));
  const openLaneKeys = new Set<string>();
  for (let d = 0; d < N; d++) {
    for (const nd of g.adj[d]) {
      const key = `${Math.min(d, nd)}-${Math.max(d, nd)}`;
      if (!whKeys.has(key)) openLaneKeys.add(key);
    }
  }

  // Danger gradient overlay
  if (props.showGradient) {
    for (let d = 0; d < N; d++) {
      if (!live(d)) continue;
      const { x, y } = lay.xy[d];
      const dv = dangerCurve(g.sdist[d] / g.maxD);
      ctx.fillStyle = `hsla(${135 - dv * 135}, 72%, ${50 - dv * 16}%, 0.28)`;
      ctx.fillRect(MARGIN + x * CELL, MARGIN + y * CELL, CELL, CELL);
    }
  }

  // Blocked lanes
  if (props.showBlocked) {
    ctx.strokeStyle = '#3a2230';
    ctx.lineWidth = 0.7;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (let d = 0; d < N; d++) {
      if (!live(d)) continue;
      const { x, y } = lay.xy[d];
      for (const [dx, dy] of [[1, 0], [0, 1]] as [number, number][]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= SIDE || ny >= SIDE) continue;
        const nd = lay.d[ny * SIDE + nx];
        if (!live(nd)) continue;
        const key = `${Math.min(d, nd)}-${Math.max(d, nd)}`;
        if (!openLaneKeys.has(key)) {
          ctx.moveTo(px(x), py(y));
          ctx.lineTo(px(lay.xy[nd].x), py(lay.xy[nd].y));
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
  for (const key of openLaneKeys) {
    const i = key.indexOf('-');
    const a = +key.slice(0, i);
    const b = +key.slice(i + 1);
    if (!live(a) || !live(b)) continue;
    ctx.moveTo(px(lay.xy[a].x), py(lay.xy[a].y));
    ctx.lineTo(px(lay.xy[b].x), py(lay.xy[b].y));
  }
  ctx.stroke();

  // Wormholes (curved gold arcs)
  if (props.showWormholes) {
    for (const w of g.wormholes) {
      if (!live(w.a) || !live(w.b)) continue;
      const x1 = px(lay.xy[w.a].x), y1 = py(lay.xy[w.a].y);
      const x2 = px(lay.xy[w.b].x), y2 = py(lay.xy[w.b].y);
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
  for (let d = 0; d < N; d++) {
    if (!live(d)) continue;
    const { x, y } = lay.xy[d];
    const star = g.inhabited[d] === 1;
    ctx.fillStyle = star ? '#cdd9ee' : '#26344d';
    ctx.beginPath();
    ctx.arc(px(x), py(y), star ? 2.2 : 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sol marker
  const cx0 = px(lay.xy[0].x), cy0 = py(lay.xy[0].y);
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

watch(
  () => [props.galaxy, props.showBlocked, props.showWormholes, props.showGradient] as const,
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
      <canvas ref="canvasRef" class="absolute inset-0 w-full h-full" style="cursor: crosshair" />
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
      <span class="text-muted/60">blank = void</span>
    </div>
  </div>
</template>
