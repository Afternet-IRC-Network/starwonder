<script setup lang="ts">
/**
 * The Captain's Log tab — the home of the narrative. Top: the current downtime session
 * (docked / under way / adrift) with its running story and the trader-level goal. Below:
 * the full event history, grouped into chapters by place. The dock modal no longer owns
 * any of this; it shows only station-local state.
 */
import { computed, ref } from 'vue';
import { api, type IdleView, type LogEventView } from '../../api';
import GoalEditor from './GoalEditor.vue';

const props = defineProps<{
  view: IdleView | null;
  events: LogEventView[] | null;
}>();
const emit = defineEmits<{ settled: [view: IdleView]; cancelCourse: [] }>();

const showPrompt = ref(false);
const canceling = ref(false);

const statusTitle = computed(() => {
  const v = props.view;
  if (!v) return '…';
  if (v.mode === 'dock') return `Docked · ${v.stationName}`;
  if (v.mode === 'orbit') return `At anchor · ${v.planetName ?? v.stationName}`;
  if (v.mode === 'transit') return `Under way · ${v.course?.destination.name}`;
  return 'Adrift · deep space';
});

const statusLine = computed(() => {
  const v = props.view;
  if (!v) return '';
  if (v.mode === 'dock') return v.vibe ?? '';
  if (v.mode === 'orbit') return `riding at anchor · ${v.stationName} turning below`;
  if (v.mode === 'transit' && v.course) {
    const c = v.course;
    const eta = c.etaAt ? ` · arrives ~${clock(c.etaAt)}` : '';
    return `${c.hopsRemaining} jump${c.hopsRemaining === 1 ? '' : 's'} to go${eta}`;
  }
  return 'No station, no course — just you and the void.';
});

async function cancelCourse(): Promise<void> {
  if (canceling.value) return;
  canceling.value = true;
  try {
    const view = await api.cancelCourse();
    emit('settled', view);
  } catch {
    /* already landed / no course — the next poll sorts it out */
  } finally {
    canceling.value = false;
  }
}

function clock(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Chapters: consecutive events at the same place fold under one header (newest first).
const chapters = computed(() => {
  const out: { place: string; events: LogEventView[] }[] = [];
  for (const e of props.events ?? []) {
    const last = out[out.length - 1];
    if (last && last.place === e.station) last.events.push(e);
    else out.push({ place: e.station, events: [e] });
  }
  return out;
});
</script>

<template>
  <div class="text-[10px] uppercase tracking-[2px] text-muted px-1">Captain's log</div>

  <!-- Current session: where you are, the story so far, and the standing goal -->
  <div class="bg-panel border border-line rounded-2xl p-4 flex flex-col gap-3">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="text-sm font-semibold truncate">{{ statusTitle }}</div>
        <div class="text-[11px] text-muted italic mt-0.5">{{ statusLine }}</div>
      </div>
      <div v-if="view?.mode === 'dock'" class="flex gap-3 text-[11px] flex-shrink-0">
        <span :class="(view.standing ?? 0) >= 0 ? 'text-good' : 'text-bad'">
          standing {{ (view.standing ?? 0) > 0 ? '+' : '' }}{{ view.standing }}
        </span>
        <span :class="(view.heat ?? 0) > 2 ? 'text-bad' : 'text-muted'">heat {{ view.heat }}</span>
      </div>
      <button
        v-else-if="view?.mode === 'transit'"
        :disabled="canceling"
        class="flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-line text-muted hover:text-fg hover:border-accent disabled:opacity-40 transition-colors"
        @click="cancelCourse"
      >{{ canceling ? '…' : 'Drop out' }}</button>
    </div>

    <div class="bg-panel2/50 border border-line rounded-xl px-3 py-2.5">
      <div class="text-[10px] uppercase tracking-[2px] text-muted mb-1">The story so far</div>
      <p v-if="view?.narrative" class="text-[12px] leading-relaxed italic text-fg/90">{{ view.narrative }}</p>
      <p v-else class="text-[12px] text-muted italic">
        A quiet stretch, so far. The galaxy hums along without you.
      </p>
    </div>

    <div class="bg-panel2/50 border border-line rounded-xl px-3 py-2.5 flex flex-col gap-2">
      <div class="text-[10px] uppercase tracking-[2px] text-muted">Downtime goal</div>
      <GoalEditor
        v-if="view"
        :goal="view.goal"
        :goal-kinds="view.goalKinds"
        @saved="(v) => emit('settled', v)"
      />
    </div>

    <!-- Narrator prompt preview (temporary, until an API key exists) -->
    <div v-if="view?.narratePrompt" class="border border-dashed border-line rounded-xl overflow-hidden">
      <button
        class="w-full px-3 py-2 text-left text-[10px] uppercase tracking-[2px] text-muted hover:text-fg transition-colors"
        @click="showPrompt = !showPrompt"
      >{{ showPrompt ? '▾' : '▸' }} AI narrator prompt (preview — no API key yet)</button>
      <pre
        v-if="showPrompt"
        class="px-3 pb-3 text-[10px] leading-relaxed text-muted whitespace-pre-wrap font-mono max-h-64 overflow-y-auto"
      >{{ view.narratePrompt }}</pre>
    </div>
  </div>

  <!-- History, newest first, in chapters by place -->
  <div v-if="events === null" class="text-muted text-xs py-8 text-center">opening the log…</div>
  <div v-else-if="!events.length" class="text-muted text-xs py-8 text-center">
    Nothing yet — set a goal, plot a course, or just let some time pass. The galaxy will find you.
  </div>
  <div v-else class="flex flex-col gap-3">
    <div v-for="(ch, i) in chapters" :key="i">
      <div class="text-[10px] uppercase tracking-[2px] text-muted px-1 mb-1.5">{{ ch.place }}</div>
      <ul class="flex flex-col gap-1.5">
        <li v-for="e in ch.events" :key="e.id" class="bg-panel border border-line rounded-xl px-3 py-2">
          <div class="flex justify-between gap-2 text-[12px] leading-snug">
            <span>{{ e.line }}</span>
            <span class="font-mono text-[10px] text-muted flex-shrink-0 mt-0.5">{{ clock(e.at) }}</span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
