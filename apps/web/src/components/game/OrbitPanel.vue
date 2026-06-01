<script setup lang="ts">
/**
 * The canonical "what's in this sector" presentation: the orbit viewport (planet name
 * top-left, world type top-right, planet stats overlaid along the bottom) plus the
 * "In orbit" station card below it — modelled on the d-modern-voxel mockup: the label
 * sits outside the card, which carries a little station-wheel icon, name, and subtitle.
 *
 * Shared by the game #star tab and the admin Galaxy Explorer on purpose: the admin
 * inspector must show the exact same screen players see, so it's a faithful debug view.
 */
import { ref, watch, onMounted, nextTick } from 'vue';
import type { SectorView } from '../../api';
import OrbitViewport from './OrbitViewport.vue';
import { drawWheel, type WheelOpts } from './wheel';

const props = defineProps<{ sector: SectorView }>();

// Short descriptor for the subtitle. Station names already end in "Station", so the
// subtitle must not repeat it ("Terra Station" / "haven station" reads badly).
const STATION_DESC: Record<string, string> = {
  trade: 'Trade hub',
  haven: 'Safe haven',
  outpost: 'Frontier outpost',
};

const iconRef = ref<HTMLCanvasElement | null>(null);

function drawIcon(): void {
  const el = iconRef.value;
  if (!el) return;
  const s = props.sector.station;
  if (!s) { el.getContext('2d')!.clearRect(0, 0, el.width, el.height); return; }
  const opts: WheelOpts = {
    tilt: s.tilt, spokes: s.spokes, spokeOuter: 0.99, spokeRot: 0.4,
    hue: s.hue, sat: s.sat, rings: [[1.0, s.rimWidth]], spokeW: s.spokeW, hub: s.hub, rot: 0.4,
  };
  drawWheel(el, opts);
}

watch(() => props.sector, () => nextTick(drawIcon));
onMounted(drawIcon);
</script>

<template>
  <div>
    <OrbitViewport :sector="sector" />

    <template v-if="sector.planet">
      <!-- Section label sits outside the card -->
      <div class="text-[10px] uppercase tracking-[2.5px] text-muted mt-3 mb-1.5">In orbit</div>

      <div class="flex items-center gap-2.5 bg-panel border border-line rounded-xl px-3 py-2.5">
        <!-- Station wheel icon -->
        <div class="w-[34px] h-[34px] rounded-lg grid place-items-center bg-panel2 border border-line overflow-hidden flex-shrink-0">
          <canvas ref="iconRef" width="30" height="30" class="[image-rendering:pixelated]" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold truncate">
            {{ sector.station ? sector.station.name : 'No station' }}
          </div>
          <div v-if="sector.station" class="text-[11px] text-muted">
            {{ STATION_DESC[sector.station.stationType] ?? 'Station' }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
