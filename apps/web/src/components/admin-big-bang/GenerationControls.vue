<script setup lang="ts">
import RangeSlider from '../ui/RangeSlider.vue';
import TextInput from '../ui/TextInput.vue';
import Button from '../ui/Button.vue';
import Checkbox from '../ui/Checkbox.vue';

defineProps<{ finding: boolean }>();
const emit = defineEmits<{ 'find-seed': [] }>();

const seed = defineModel<string>('seed', { required: true });
const starVal = defineModel<number>('starVal', { required: true });
const laneVal = defineModel<number>('laneVal', { required: true });
const biasVal = defineModel<number>('biasVal', { required: true });
const whVal = defineModel<number>('whVal', { required: true });
const showBlocked = defineModel<boolean>('showBlocked', { required: true });
const showWormholes = defineModel<boolean>('showWormholes', { required: true });
const showGradient = defineModel<boolean>('showGradient', { required: true });
</script>

<template>
  <div class="space-y-4">
    <!-- Seed row -->
    <div>
      <label class="text-xs text-muted block mb-1.5">Seed</label>
      <div class="flex gap-2">
        <TextInput v-model="seed" placeholder="seed" :monospace="true" class="flex-1" />
        <Button variant="secondary" size="sm" :disabled="finding" @click="emit('find-seed')">
          {{ finding ? '…' : '🎲 find' }}
        </Button>
      </div>
      <p class="text-[10px] text-muted mt-1">🎲 finds a seed where Sol can reach ≥ 90% of sectors</p>
    </div>

    <RangeSlider
      v-model="starVal"
      label="Star likelihood"
      :display-value="(starVal / 100).toFixed(2)"
      :min="0" :max="100"
    />
    <RangeSlider
      v-model="laneVal"
      label="Lane open prob."
      :display-value="(laneVal / 100).toFixed(2)"
      :min="0" :max="100"
    />
    <RangeSlider
      v-model="biasVal"
      label="Core bias"
      :display-value="(biasVal / 100).toFixed(2)"
      :min="0" :max="100"
      hint="Tilts lane probability by distance from Sol — denser core, frayed rim. Mean stays ≈ lane prob."
    />
    <RangeSlider
      v-model="whVal"
      label="Wormholes"
      :display-value="String(whVal)"
      :min="0" :max="80"
    />

    <!-- Display toggles -->
    <div class="flex flex-wrap gap-x-5 gap-y-2 pt-1 border-t border-line">
      <Checkbox v-model="showGradient" label="danger gradient" />
      <Checkbox v-model="showWormholes" label="wormholes" />
      <Checkbox v-model="showBlocked" label="blocked lanes" />
    </div>
  </div>
</template>
