<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  status?: 'good' | 'warn' | 'bad';
}>();
</script>

<template>
  <div class="flex justify-between items-center py-1.5 border-b border-line last:border-b-0 text-xs">
    <span class="text-muted">{{ label }}</span>
    <span
      :class="[
        'font-bold font-mono',
        status === 'good' ? 'text-good' : status === 'warn' ? 'text-gold' : status === 'bad' ? 'text-bad' : 'text-fg',
      ]"
    >
      {{ value }}
    </span>
  </div>
</template>
