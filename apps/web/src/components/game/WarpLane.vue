<script setup lang="ts">
/**
 * A single warp-lane chip on the star screen. Shows what the trader knows about the
 * destination: a tiny pixel-planet + name for a visited world, a dim dot for a visited
 * deep-space waypoint, or a "?" for somewhere not yet charted. The sector id is always
 * shown; energy isn't (every lane costs the same — it's in the HUD and gates the button).
 */
import { ref, watch, onMounted } from 'vue';
import type { LaneView } from '../../api';
import { planetSprite } from './planet';

const props = defineProps<{ lane: LaneView; disabled?: boolean }>();
const emit = defineEmits<{ go: [] }>();

const cvRef = ref<HTMLCanvasElement | null>(null);
function paint(): void {
  const el = cvRef.value;
  if (!el) return;
  const ctx = el.getContext('2d')!;
  ctx.clearRect(0, 0, el.width, el.height);
  const p = props.lane.planet;
  if (p) ctx.drawImage(planetSprite(`Sector #${props.lane.id}`, p.palette, 22, p.spin), 0, 0);
}
watch(() => props.lane, () => paint());
onMounted(paint);
</script>

<template>
  <button
    :disabled="disabled"
    class="flex-shrink-0 w-[132px] flex items-center gap-2 bg-panel2 border border-line rounded-xl p-2.5 text-left hover:border-accent transition-colors disabled:opacity-40"
    @click="emit('go')"
  >
    <div class="w-[22px] h-[22px] grid place-items-center flex-shrink-0">
      <canvas
        v-if="lane.planet"
        ref="cvRef"
        width="22"
        height="22"
        class="[image-rendering:pixelated] drop-shadow-[0_0_4px_rgba(90,160,200,0.45)]"
      />
      <span v-else-if="lane.visited" class="w-2 h-2 rounded-full bg-[#2c3c58]" />
      <span v-else class="text-muted text-sm font-bold leading-none">?</span>
    </div>
    <div class="min-w-0 flex-1">
      <div class="text-xs font-semibold truncate" :class="{ 'text-muted': !lane.visited }">
        <template v-if="lane.planet">{{ lane.planet.name }}</template>
        <template v-else-if="lane.visited">Deep space</template>
        <template v-else>Unscanned</template>
      </div>
      <div class="text-[10px] text-muted font-mono">#{{ lane.id }}</div>
    </div>
  </button>
</template>
