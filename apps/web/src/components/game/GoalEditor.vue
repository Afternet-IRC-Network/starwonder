<script setup lang="ts">
/**
 * The downtime-goal selector — trader-level, so it lives wherever the story is shown
 * (Captain's Log, the while-you-were-away sheet) rather than inside the dock modal.
 * Saving settles elapsed beats under the OLD goal first (server-side), then applies.
 */
import { computed, ref, watch } from 'vue';
import { COMMODITY_SPEC } from '@starwonder/game-core';
import { api, type GoalView, type IdleView } from '../../api';
import { GOAL_LABELS } from './goals';

const props = defineProps<{ goal: GoalView | null; goalKinds: string[] }>();
const emit = defineEmits<{ saved: [view: IdleView] }>();

const goalKind = ref('idle');
const goalTarget = ref('');
const goalBlurb = ref('');
const busy = ref(false);
const error = ref('');

watch(
  () => props.goal,
  (g) => {
    goalKind.value = g?.kind ?? 'idle';
    goalTarget.value = g?.target ?? '';
    goalBlurb.value = g?.blurb ?? '';
  },
  { immediate: true },
);

const goalDirty = computed(() => {
  const g = props.goal;
  return (
    goalKind.value !== (g?.kind ?? 'idle') ||
    (goalKind.value === 'bargain-hunt' && goalTarget.value !== (g?.target ?? '')) ||
    goalBlurb.value !== (g?.blurb ?? '')
  );
});

async function saveGoal(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const view = await api.setGoal({
      kind: goalKind.value,
      target: goalKind.value === 'bargain-hunt' && goalTarget.value ? goalTarget.value : undefined,
      blurb: goalBlurb.value || undefined,
    });
    emit('saved', view);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex gap-2">
      <select
        v-model="goalKind"
        class="flex-1 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
      >
        <option v-for="k in props.goalKinds" :key="k" :value="k">{{ GOAL_LABELS[k] ?? k }}</option>
      </select>
      <select
        v-if="goalKind === 'bargain-hunt'"
        v-model="goalTarget"
        class="flex-1 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
      >
        <option value="">any commodity</option>
        <option v-for="c in COMMODITY_SPEC" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </div>
    <input
      v-model="goalBlurb"
      maxlength="200"
      placeholder="in your own words (for the narrator)…"
      class="bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
    />
    <button
      v-if="goalDirty"
      :disabled="busy"
      class="self-end px-3 py-1.5 rounded-lg text-xs font-semibold border border-accent text-accent bg-accent/10 hover:bg-accent/20 disabled:opacity-40 transition-colors"
      @click="saveGoal"
    >{{ busy ? '…' : 'Set goal' }}</button>
    <p v-if="error" class="text-bad text-xs">{{ error }}</p>
  </div>
</template>
