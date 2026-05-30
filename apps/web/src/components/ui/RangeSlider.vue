<script setup lang="ts">
defineProps<{
  label: string;
  displayValue: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}>();

const model = defineModel<number>({ required: true });
</script>

<template>
  <div>
    <label class="flex justify-between items-baseline text-xs mb-1.5">
      <span class="text-muted">{{ label }}</span>
      <span class="text-accent font-bold font-mono">{{ displayValue }}</span>
    </label>
    <input
      v-model.number="model"
      type="range"
      :min="min ?? 0"
      :max="max ?? 100"
      :step="step ?? 1"
      class="w-full h-1.5 rounded-full appearance-none bg-panel2 accent-accent cursor-pointer"
    />
    <p v-if="hint" class="text-[10px] text-muted mt-1 leading-relaxed">{{ hint }}</p>
  </div>
</template>
