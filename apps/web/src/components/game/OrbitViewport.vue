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
import { WORLD_CLASS_INFO } from '@starwonder/game-core';
import type { WheelOpts } from './wheel';
import { drawWheel } from './wheel';
import { hashStr, mulberry32, makePlanet } from './planet';

const props = defineProps<{ sector: SectorView }>();

// Atmosphere colour-coded by breathability (for the overlaid stat line).
const atmColor: Record<string, string> = {
  breathable: 'text-good',
  thin: 'text-muted',
  thick: 'text-accent',
  none: 'text-muted',
  toxic: 'text-bad',
  corrosive: 'text-bad',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── DOM refs ──────────────────────────────────────────────────────────────────
const starsRef  = ref<HTMLCanvasElement | null>(null);
const planetRef = ref<HTMLCanvasElement | null>(null);
const heroRef   = ref<HTMLCanvasElement | null>(null);

// Hash/RNG + the planet renderer live in ./planet (shared with the star-chart map).

// ── Planet display size ───────────────────────────────────────────────────────
// The drawn planet scales with its diameter. `size` is in Earth radii: ~88% of worlds
// are rocky and cluster in 0.3–1.8, while gas giants run 3.5–12. If we mapped the whole
// range evenly, every ordinary world would render near-identical and only gas giants
// would stand out — so we give the *common* rocky range the bulk of the visible band
// (0.3→1.8 ⇒ 60%→92% of the reference) and let the rare giants edge to the max (→100%).
// Tune MIN_SCALE to make the spread more/less dramatic.
const PLANET_PX = 180;
const MIN_SCALE = 0.6;          // smallest world, as a fraction of the reference size
const planetPx = computed(() => {
  const size = props.sector.planet?.size;
  if (!size) return PLANET_PX;
  const common = 0.92 - MIN_SCALE; // band reserved for rocky worlds (0.3–1.8)
  const scale = size <= 1.8
    ? MIN_SCALE + common * ((Math.min(size, 1.8) - 0.3) / 1.5)
    : 0.92 + 0.08 * Math.min(1, (size - 1.8) / (12 - 1.8));
  return Math.round(PLANET_PX * Math.max(MIN_SCALE, Math.min(1, scale)));
});

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

  // Planet — uses palette and spin from server-provided planet data. The name/type
  // labels are template-driven overlays (see below), not painted here.
  const planet = props.sector.planet;
  if (planet) {
    const frame = makePlanet(planetEl, props.sector.addr, planet.palette);
    frame(planet.spin);
  } else {
    planetEl.getContext('2d')!.clearRect(0, 0, planetEl.width, planetEl.height);
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
    <canvas ref="planetRef" class="planet" width="72"  height="72"
            :style="{ width: planetPx + 'px', height: planetPx + 'px' }" />
    <canvas ref="heroRef"   class="hero"   width="30"  height="30"  />

    <!-- Planet name — top-left identity -->
    <div v-if="sector.planet" class="pname">{{ sector.planet.name }}</div>

    <!-- World type — top-right toast -->
    <div v-if="sector.planet" class="ptype">
      {{ WORLD_CLASS_INFO[sector.planet.worldClass].label }}
    </div>
    <div v-else class="noplanet">no planetary bodies detected</div>

    <!-- Planet stats — overlaid along the bottom, under the planet -->
    <div v-if="sector.planet" class="pstats">
      <span>Atmo <span :class="atmColor[sector.planet.atmosphere] ?? 'text-fg'">{{ cap(sector.planet.atmosphere) }}</span></span>
      <span>{{ sector.planet.size }} R⊕</span>
      <span>{{ sector.planet.gravity }} g</span>
      <span>{{ sector.planet.dayHours }}h day</span>
      <span>{{ sector.planet.moons }} moon{{ sector.planet.moons === 1 ? '' : 's' }}</span>
    </div>
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
  /* width/height are bound inline (scaled by planet diameter) */
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
.pname {
  position: absolute;
  top: 9px;
  left: 12px;
  max-width: 58%;
  color: #eaf1ff;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.3px;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ptype {
  position: absolute;
  top: 8px;
  right: 10px;
  padding: 3px 8px;
  border-radius: 8px;
  background: rgba(20, 28, 46, 0.72);
  border: 1px solid #1f2a3d;
  color: #9fb2d4;
  font-size: 10px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  font-family: "DejaVu Sans Mono", Menlo, Consolas, monospace;
}
.pstats {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  column-gap: 12px;
  row-gap: 2px;
  padding: 0 10px;
  color: #8b9bbd;
  font-size: 11px;
  letter-spacing: 0.3px;
  font-family: "DejaVu Sans Mono", Menlo, Consolas, monospace;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.9);
}
.noplanet {
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
