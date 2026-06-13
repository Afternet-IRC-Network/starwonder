<script setup lang="ts">
/**
 * Small station-wheel glyph — the same procedural wheel as the orbit viewport, sized for
 * a card. Shared by the "In orbit" card (OrbitPanel) and the "Berthed" card (DockPanel).
 */
import { ref, watch, onMounted, nextTick } from 'vue';
import type { StationData } from '../../api';
import { drawWheel, type WheelOpts } from './wheel';

const props = defineProps<{ station: StationData | null | undefined; size?: number }>();

const cvRef = ref<HTMLCanvasElement | null>(null);

function draw(): void {
  const el = cvRef.value;
  if (!el) return;
  const s = props.station;
  if (!s) { el.getContext('2d')!.clearRect(0, 0, el.width, el.height); return; }
  const opts: WheelOpts = {
    tilt: s.tilt, spokes: s.spokes, spokeOuter: 0.99, spokeRot: 0.4,
    hue: s.hue, sat: s.sat, rings: [[1.0, s.rimWidth]], spokeW: s.spokeW, hub: s.hub, rot: 0.4,
  };
  drawWheel(el, opts);
}

watch(() => props.station, () => nextTick(draw));
onMounted(draw);
</script>

<template>
  <canvas ref="cvRef" :width="size ?? 30" :height="size ?? 30" class="[image-rendering:pixelated]" />
</template>
