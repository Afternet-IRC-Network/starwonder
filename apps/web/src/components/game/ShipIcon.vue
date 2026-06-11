<script setup lang="ts">
/** A trader's little voxel ship, rendered from its name (see ./ship). Used in the
 *  "Also here" roster; the canvas is drawn small and CSS-upscaled for a crisp voxel look. */
import { ref, watch, onMounted, nextTick } from 'vue';
import { drawShip, shipHue } from './ship';

const props = withDefaults(defineProps<{ seed: string; size?: number }>(), { size: 26 });
const el = ref<HTMLCanvasElement | null>(null);

function render(): void {
  if (el.value) drawShip(el.value, props.seed, shipHue(props.seed));
}
onMounted(render);
watch(() => props.seed, () => nextTick(render));
</script>

<template>
  <canvas ref="el" :width="size" :height="size" class="w-full h-full [image-rendering:pixelated]" />
</template>
