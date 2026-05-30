<script setup lang="ts">
/**
 * Voxel/pixel orbit viewport — ported from d-modern-voxel.html mockup.
 *
 * Planet and station visual params come from the sector object (server-computed,
 * DB-overridable). The renderer stays purely visual — it takes what the server says
 * and draws it.
 */
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import type { SectorView } from '../../api';
import type { WheelOpts } from './wheel';
import { drawWheel } from './wheel';

const props = defineProps<{ sector: SectorView }>();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const starsRef  = ref<HTMLCanvasElement | null>(null);
const planetRef = ref<HTMLCanvasElement | null>(null);
const heroRef   = ref<HTMLCanvasElement | null>(null);
const ptypeRef  = ref<HTMLDivElement   | null>(null);

// ── Hash / RNG ────────────────────────────────────────────────────────────────
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Planet palettes (verbatim from mockup) ────────────────────────────────────
const PALETTES: Record<string, number[][]> = {
  ocean: [[16,34,86],[24,64,140],[36,120,168],[58,158,150],[120,180,110],[210,216,190]],
  lava:  [[40,12,12],[96,22,18],[170,52,24],[224,110,36],[250,196,90],[255,238,170]],
  ice:   [[24,40,70],[44,78,120],[96,150,190],[150,200,224],[210,232,244],[245,250,255]],
  arid:  [[48,30,18],[96,60,30],[150,100,52],[196,150,86],[222,190,130],[244,228,186]],
};

// ── Planet renderer (verbatim from mockup) ────────────────────────────────────
function makePlanet(canvas: HTMLCanvasElement, seedStr: string, palette: string) {
  const rng = mulberry32(hashStr(seedStr + '|planet'));
  const N   = canvas.width;
  const ctx = canvas.getContext('2d')!;
  const R   = N / 2 - 1, cx = N / 2, cy = N / 2;
  const pal = PALETTES[palette] ?? PALETTES.ocean;
  const bands: { fx: number; fy: number; ph: number; a: number }[] = [];
  for (let i = 0; i < 4; i++)
    bands.push({ fx: 1 + rng() * 4, fy: 1 + rng() * 4, ph: rng() * 6.283, a: 0.5 + rng() });
  const bayer = [[0, 2], [3, 1]];
  const lx = -0.55, ly = -0.5, lz = 0.66;

  return function frame(spin: number) {
    const img = ctx.createImageData(N, N);
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const x = (px - cx) / R, y = (py - cy) / R;
        const r2 = x * x + y * y;
        const idx = (py * N + px) * 4;
        if (r2 > 1) { img.data[idx + 3] = 0; continue; }
        const z   = Math.sqrt(1 - r2);
        const lat = Math.asin(Math.max(-1, Math.min(1, y)));
        const lon = Math.atan2(x, z) + spin;
        let t = 0, amp = 0;
        for (const b of bands) { t += b.a * Math.sin(b.fx * lon + b.fy * lat + b.ph); amp += b.a; }
        t = (t / amp + 1) / 2;
        const L = Math.max(0.06, x * lx + y * ly + z * lz);
        const f = t * (pal.length - 1) * 0.72 + L * (pal.length - 1) * 0.55
                + (bayer[py & 1][px & 1] / 4 - 0.5);
        const pi = Math.max(0, Math.min(pal.length - 1, Math.round(f)));
        const [r, g, bl] = pal[pi];
        const lit = 0.4 + L * 0.8;
        img.data[idx]     = Math.min(255, r  * lit);
        img.data[idx + 1] = Math.min(255, g  * lit);
        img.data[idx + 2] = Math.min(255, bl * lit);
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };
}

// ── Station opts from sector data ─────────────────────────────────────────────
const stationOpts = computed<WheelOpts | null>(() => {
  const s = props.sector.station;
  if (!s) return null;
  return {
    tilt:       s.tilt,
    spokes:     s.spokes,
    spokeOuter: 0.99,
    spokeRot:   0.4,
    hue:        s.hue,
    sat:        s.sat,
    rings:      [[1.0, s.rimWidth]],
    spokeW:     s.spokeW,
    hub:        s.hub,
  };
});

// ── Planet type label ─────────────────────────────────────────────────────────
const PLANET_LABELS: Record<string, string> = {
  ocean: 'ocean world · breathable atmosphere',
  lava:  'volcanic world · hostile surface',
  ice:   'ice world · frozen wastes',
  arid:  'arid world · sparse biosphere',
};

// ── Scene init + animation loop ───────────────────────────────────────────────
let raf: number | null = null;

function initScene() {
  if (raf !== null) { cancelAnimationFrame(raf); raf = null; }

  const starsEl  = starsRef.value;
  const planetEl = planetRef.value;
  const heroEl   = heroRef.value;
  if (!starsEl || !planetEl || !heroEl) return;

  // Starfield — seeded per sector
  const sc   = starsEl.getContext('2d')!;
  const srng = mulberry32(hashStr(String(props.sector.id) + '|stars'));
  sc.clearRect(0, 0, starsEl.width, starsEl.height);
  for (let i = 0; i < 110; i++) {
    sc.globalAlpha = 0.2 + srng() * 0.7;
    sc.fillStyle   = '#bcd6ff';
    sc.fillRect((srng() * 420) | 0, (srng() * 230) | 0, srng() < 0.08 ? 2 : 1, 1);
  }
  sc.globalAlpha = 1;

  // Planet — uses palette and spin from server-provided planet data
  const planet = props.sector.planet;
  if (planet) {
    const frame = makePlanet(planetEl, props.sector.addr, planet.palette);
    frame(planet.spin);
    if (ptypeRef.value) {
      const prefix = props.sector.id === 0 ? 'EARTH — ' : '';
      ptypeRef.value.textContent = prefix + (PLANET_LABELS[planet.palette] ?? '');
    }
  } else {
    planetEl.getContext('2d')!.clearRect(0, 0, planetEl.width, planetEl.height);
    if (ptypeRef.value) ptypeRef.value.textContent = 'no planetary body detected';
  }

  // Station wheel — uses params from server-provided station data, slowly spinning
  const opts = stationOpts.value;
  if (opts) {
    let rot = 0;
    (function loop() {
      drawWheel(heroEl, { ...opts, rot });
      rot += 0.004;
      raf = requestAnimationFrame(loop);
    })();
  } else {
    heroEl.getContext('2d')!.clearRect(0, 0, heroEl.width, heroEl.height);
  }
}

watch(() => props.sector, initScene);
onMounted(initScene);
onUnmounted(() => { if (raf !== null) cancelAnimationFrame(raf); });
</script>

<template>
  <div class="viewport">
    <canvas ref="starsRef"  class="stars"  width="420" height="230" />
    <canvas ref="planetRef" class="planet" width="72"  height="72"  />
    <canvas ref="heroRef"   class="hero"   width="30"  height="30"  />
    <div    ref="ptypeRef"  class="ptype"                            />
  </div>
</template>

<style scoped>
.viewport {
  position: relative;
  border: 1px solid #1f2a3d;
  border-radius: 14px;
  background: radial-gradient(60% 60% at 50% 42%, #0e1730, #080c16);
  overflow: hidden;
  height: 230px;
}
.stars {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.55;
}
.planet {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  width: 180px;
  height: 180px;
  image-rendering: pixelated;
  filter: drop-shadow(0 0 14px rgba(90, 160, 200, 0.45));
}
.hero {
  position: absolute;
  width: 30px;
  height: 30px;
  image-rendering: pixelated;
  left: 60%;
  top: 30%;
  filter: drop-shadow(0 0 5px rgba(120, 180, 220, 0.6));
}
.ptype {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  text-align: center;
  color: #5d6b85;
  font-size: 11px;
  font-family: "DejaVu Sans Mono", Menlo, Consolas, monospace;
  letter-spacing: 0.5px;
}
</style>
