<script setup lang="ts">
/**
 * The canonical "you are docked" presentation — OrbitPanel's counterpart for the dock tab:
 * the dock-bay scene (station name, type, and vibe overlaid) plus the "Berthed" card with
 * the station icon, this place's feelings about you (standing / heat), and the Undock
 * action. The narrative itself stays in the Captain's Log; the marketplace is composed
 * below this panel by App.vue.
 */
import type { SectorView } from '../../api';
import DockScene from './DockScene.vue';
import StationIcon from './StationIcon.vue';

defineProps<{
  sector: SectorView;
  vibe?: string | null;
  standing?: number;
  heat?: number;
  shipSeed?: string;
  busy?: boolean;
}>();
defineEmits<{ undock: [] }>();

const STATION_DESC: Record<string, string> = {
  trade: 'Trade hub',
  haven: 'Safe haven',
  outpost: 'Frontier outpost',
};
</script>

<template>
  <div v-if="sector.station">
    <DockScene :sector="sector" :vibe="vibe" :ship-seed="shipSeed" />

    <div class="text-[10px] uppercase tracking-[2.5px] text-muted mt-3 mb-1.5">Berthed</div>

    <div class="w-full flex items-center gap-2.5 bg-panel border border-line rounded-xl px-3 py-2.5">
      <div class="w-[34px] h-[34px] rounded-lg grid place-items-center bg-panel2 border border-line overflow-hidden flex-shrink-0">
        <StationIcon :station="sector.station" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold truncate">{{ sector.station.name }}</div>
        <div class="text-[11px] text-muted">
          {{ STATION_DESC[sector.station.stationType] ?? 'Station' }}
          · <span :class="(standing ?? 0) >= 0 ? 'text-good' : 'text-bad'">
            standing {{ (standing ?? 0) > 0 ? '+' : '' }}{{ standing ?? 0 }}</span>
          · <span :class="(heat ?? 0) > 2 ? 'text-bad' : ''">heat {{ heat ?? 0 }}</span>
        </div>
      </div>
      <!-- Cast off: back to anchor in orbit. Leaving scrubs any working order. -->
      <button
        class="flex-shrink-0 px-3 py-1.5 rounded-lg border border-line text-[11px] font-semibold text-muted hover:text-bad hover:border-bad/60 transition-colors disabled:opacity-50"
        :disabled="busy"
        @click="$emit('undock')"
      >Undock</button>
    </div>
  </div>
</template>
