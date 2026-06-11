<script setup lang="ts">
/**
 * The canonical "what's in this sector" presentation: the orbit viewport (planet name
 * top-left, world type top-right, planet stats overlaid along the bottom) plus the
 * "In orbit" station card below it — modelled on the d-modern-voxel mockup: the label
 * sits outside the card, which carries a little station-wheel icon, name, and subtitle.
 *
 * Shared by the game #sector tab and the admin Galaxy Explorer on purpose: the admin
 * inspector must show the exact same screen players see, so it's a faithful debug view.
 */
import { ref, watch, onMounted, nextTick } from 'vue';
import type { SectorView } from '../../api';
import OrbitViewport from './OrbitViewport.vue';
import ShipIcon from './ShipIcon.vue';
import { drawWheel, type WheelOpts } from './wheel';

const props = defineProps<{ sector: SectorView; dockable?: boolean }>();
const emit = defineEmits<{ dock: [] }>();

// Tapping the station card opens the dock — but only where that makes sense (the player's
// own current sector). The admin inspector and remote-sector previews leave `dockable` off,
// so the card stays an inert, identical-looking panel.
const canDock = (): boolean => !!props.dockable && !!props.sector.station;
function onDock(): void {
  if (canDock()) emit('dock');
}

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

      <component
        :is="canDock() ? 'button' : 'div'"
        type="button"
        class="w-full flex items-center gap-2.5 bg-panel border border-line rounded-xl px-3 py-2.5 text-left transition-colors"
        :class="canDock() ? 'cursor-pointer hover:border-accent hover:bg-panel2/50' : ''"
        @click="onDock"
      >
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
        <!-- Dock affordance — only when this is a station you can actually trade at -->
        <span v-if="canDock()" class="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold text-accent">
          Dock <span class="text-sm leading-none">›</span>
        </span>
      </component>
    </template>

    <!-- Other traders parked in this sector — independent of whether it's inhabited -->
    <template v-if="sector.traders && sector.traders.length">
      <div class="text-[10px] uppercase tracking-[2.5px] text-muted mt-3 mb-1.5">Also here</div>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="t in sector.traders"
          :key="t.id"
          class="flex items-center gap-2 bg-panel border border-line rounded-xl pl-1.5 pr-3 py-1.5"
        >
          <div class="w-[30px] h-[30px] rounded-lg grid place-items-center bg-panel2 border border-line overflow-hidden flex-shrink-0">
            <ShipIcon :seed="t.name" :size="26" />
          </div>
          <div class="text-[12px] font-medium truncate max-w-[140px]">{{ t.name }}</div>
        </div>
      </div>
    </template>
  </div>
</template>
