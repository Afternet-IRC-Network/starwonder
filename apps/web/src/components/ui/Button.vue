<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost';
    disabled?: boolean;
    size?: 'sm' | 'md';
  }>(),
  { variant: 'primary', size: 'md' },
);
</script>

<template>
  <button
    :disabled="disabled"
    :class="[
      'rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
      size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
      variant === 'primary'
        ? 'bg-accent/15 border border-accent text-accent hover:bg-accent/25'
        : variant === 'secondary'
          ? 'bg-panel2 border border-line text-fg hover:border-accent hover:text-accent'
          : 'text-muted hover:text-fg underline',
    ]"
  >
    <slot />
  </button>
</template>
