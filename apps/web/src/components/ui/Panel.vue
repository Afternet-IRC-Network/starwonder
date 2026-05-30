<script setup lang="ts">
withDefaults(defineProps<{ pad?: 'sm' | 'md' | 'lg' }>(), { pad: 'md' });
</script>

<template>
  <div
    :class="[
      'bg-panel border border-line rounded-2xl',
      pad === 'sm' ? 'p-3' : pad === 'lg' ? 'p-6' : 'p-4',
    ]"
  >
    <slot />
  </div>
</template>
