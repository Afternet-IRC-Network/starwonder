<script setup lang="ts">
defineProps<{ label: string }>();
const model = defineModel<boolean>({ required: true });
</script>

<template>
  <label class="flex items-center gap-2 text-xs text-muted hover:text-fg cursor-pointer transition-colors select-none">
    <input v-model="model" type="checkbox" class="accent-accent w-3.5 h-3.5 rounded" />
    {{ label }}
  </label>
</template>
