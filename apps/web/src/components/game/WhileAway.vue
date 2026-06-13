<script setup lang="ts">
/**
 * "While you were away" — the proactive narrative sheet. App.vue pops it (over whatever
 * tab is open) when the poll or a fresh login finds events newer than the last ones this
 * browser has seen: the story comes to you, you don't go dig for it. Dismissing marks
 * the events seen; the full history stays in the Captain's Log.
 */
import { computed, ref } from 'vue';
import { api, type IdleView, type LogEventView } from '../../api';
import GoalEditor from './GoalEditor.vue';

const props = defineProps<{
  view: IdleView;
  /** the unseen events, newest first */
  events: LogEventView[];
}>();
const emit = defineEmits<{ close: []; openLog: []; settled: [view: IdleView] }>();

const showGoal = ref(false);
const canceling = ref(false);

const title = computed(() => {
  const v = props.view;
  if (v.mode === 'transit') return `Under way to ${v.course?.destination.name}`;
  if (v.mode === 'dock') return `While you were away — ${v.stationName}`;
  if (v.mode === 'orbit') return `While you were away — over ${v.planetName ?? '…'}`;
  return 'While you were away';
});

const subtitle = computed(() => {
  const v = props.view;
  if (v.mode === 'transit' && v.course) {
    const c = v.course;
    const eta = c.etaAt ? ` · arrives ~${clock(c.etaAt)}` : '';
    return `${c.hopsRemaining} jump${c.hopsRemaining === 1 ? '' : 's'} to go${eta}`;
  }
  if (v.mode === 'dock') return v.vibe ?? '';
  if (v.mode === 'orbit') return `at anchor · ${v.stationName} below`;
  return 'drifting in open space';
});

async function cancelCourse(): Promise<void> {
  if (canceling.value) return;
  canceling.value = true;
  try {
    emit('settled', await api.cancelCourse());
  } catch {
    /* already landed — the next poll sorts it out */
  } finally {
    canceling.value = false;
  }
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex flex-col justify-end sm:justify-center bg-black/60 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div class="mx-auto w-full max-w-md bg-bg border-t sm:border border-line rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[80vh] overflow-hidden shadow-2xl shadow-black/50">
      <header class="flex items-center gap-2.5 px-4 py-3 border-b border-line flex-shrink-0">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold truncate"><span class="text-gold mr-1">✦</span>{{ title }}</div>
          <div class="text-[11px] text-muted italic">{{ subtitle }}</div>
        </div>
        <button
          v-if="view.mode === 'transit'"
          :disabled="canceling"
          class="flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-line text-muted hover:text-fg hover:border-accent disabled:opacity-40 transition-colors"
          @click="cancelCourse"
        >{{ canceling ? '…' : 'Drop out' }}</button>
        <button
          class="w-8 h-8 -mr-1 grid place-items-center rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors"
          aria-label="Dismiss"
          @click="emit('close')"
        >✕</button>
      </header>

      <div class="p-4 overflow-y-auto flex flex-col gap-3">
        <p v-if="view.narrative" class="text-[12px] leading-relaxed italic text-fg/90">
          {{ view.narrative }}
        </p>

        <ul v-if="events.length" class="flex flex-col gap-1">
          <li v-for="e in events" :key="e.id" class="flex gap-2 text-[11px] leading-snug">
            <span class="text-muted font-mono flex-shrink-0">{{ clock(e.at) }}</span>
            <span class="text-fg/85">{{ e.line }}</span>
          </li>
        </ul>

        <!-- Steer the downtime without leaving the sheet -->
        <div class="border border-line rounded-xl overflow-hidden">
          <button
            class="w-full px-3 py-2 text-left text-[10px] uppercase tracking-[2px] text-muted hover:text-fg transition-colors"
            @click="showGoal = !showGoal"
          >{{ showGoal ? '▾' : '▸' }} Downtime goal</button>
          <div v-if="showGoal" class="px-3 pb-3">
            <GoalEditor :goal="view.goal" :goal-kinds="view.goalKinds" @saved="(v) => emit('settled', v)" />
          </div>
        </div>

        <div class="flex gap-2 justify-end">
          <button
            class="px-3 py-1.5 rounded-lg text-xs text-muted underline hover:text-fg transition-colors"
            @click="emit('openLog')"
          >Open the log</button>
          <button
            class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-accent/15 border border-accent text-accent hover:bg-accent/25 transition-colors"
            @click="emit('close')"
          >Carry on</button>
        </div>
      </div>
    </div>
  </div>
</template>
