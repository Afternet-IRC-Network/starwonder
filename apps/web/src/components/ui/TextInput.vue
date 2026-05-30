<script setup lang="ts">
defineProps<{
  placeholder?: string;
  type?: string;
  autocomplete?: string;
  monospace?: boolean;
}>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <input
    v-model="model"
    :placeholder="placeholder"
    :type="type ?? 'text'"
    :autocomplete="autocomplete"
    :class="[
      'w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-fg',
      'outline-none focus:border-accent transition-colors placeholder:text-muted',
      monospace ? 'font-mono' : '',
    ]"
  />
</template>
