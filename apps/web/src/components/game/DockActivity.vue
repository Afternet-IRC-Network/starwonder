<script setup lang="ts">
/**
 * The ACTIVITY hub of the dock tab — what your trader is DOING with their dock time, and
 * the menu of things to do. The chips come first: "Buy & Sell" opens the market sheet
 * (App.vue owns it), the rest are one-tap selections from the idle goal list — the same
 * trader-level goals GoalEditor edits in full (target/blurb) from the Log. Under them,
 * the working trade errand (progress / ETA / scrub) and/or the status card: the goal as
 * a doing ("Working the room…") with the latest few log lines and a "more ››" into the
 * Log tab. Future dock activities ("Go pickpocketing", …) land here as more chips.
 */
import { ref, computed } from 'vue';
import {
  api,
  type GoalView,
  type IdleView,
  type LogEventView,
  type OrderResult,
  type OrderView,
  type MarketEntryView,
} from '../../api';
import { GOAL_LABELS, GOAL_DOING, GOAL_ICONS } from './goals';

const props = defineProps<{
  order: OrderView | null;
  market?: MarketEntryView[];
  goal: GoalView | null;
  goalKinds: string[];
  /** the trader's event feed, newest first — the card shows the top few */
  events?: LogEventView[] | null;
}>();
const emit = defineEmits<{ order: [res: OrderResult]; settled: [view: IdleView]; market: []; log: [] }>();

const recent = computed<LogEventView[]>(() => (props.events ?? []).slice(0, 3));

function ago(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

const busy = ref(false);
const error = ref('');

const commodityName = (id: string): string =>
  props.market?.find((m) => m.id === id)?.name ?? id;

const errandName = computed(() => (props.order ? commodityName(props.order.commodity) : ''));
const pct = computed(() =>
  props.order ? Math.round((props.order.filled / props.order.qty) * 100) : 0,
);

function inWhen(ts: number): string {
  const mins = Math.max(0, Math.round((ts - Date.now()) / 60_000));
  if (mins < 1) return 'moments';
  if (mins < 60) return `~${mins}m`;
  return `~${Math.floor(mins / 60)}h ${mins % 60}m`;
}
const eta = computed(() => {
  const o = props.order;
  if (!o) return '';
  if (o.etaAt) return `done in ${inWhen(o.etaAt)}`;
  if (o.nextFillAt) return `next fill in ${inWhen(o.nextFillAt)}`;
  if (o.limit) return 'holding at limit price';
  return 'working…';
});

// The goal as a status line — "Hunting for a bargain on Minerals…" — for the no-errand card.
const goalKind = computed(() => props.goal?.kind ?? 'idle');
const doingLine = computed(() => {
  const k = goalKind.value;
  const base = GOAL_DOING[k] ?? GOAL_LABELS[k] ?? k;
  if (k === 'bargain-hunt' && props.goal?.target) return `${base} on ${commodityName(props.goal.target)}…`;
  return `${base}…`;
});

// Call the errand off — what's already bought or sold, you keep.
async function callOff(): Promise<void> {
  if (busy.value || !props.order) return;
  busy.value = true;
  error.value = '';
  try {
    emit('order', await api.cancelOrder());
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// One-tap goal switch. A fresh pick starts plain (no target/blurb) — the Log's full
// editor is where the finer intent lives.
async function pickGoal(kind: string): Promise<void> {
  if (busy.value || kind === goalKind.value) return;
  busy.value = true;
  error.value = '';
  try {
    emit('settled', await api.setGoal({ kind }));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Things to do on the docks. ONE color rule: a lit chip is something you're doing
         right now — Buy & Sell lights while an errand works, the goal chip while it's set. -->
    <div class="flex flex-wrap gap-1.5">
      <button
        class="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors"
        :class="order
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-line text-muted hover:text-fg hover:border-fg/40'"
        @click="emit('market')"
      >⇄ Buy &amp; Sell</button>
      <button
        v-for="k in goalKinds"
        :key="k"
        :disabled="busy"
        class="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors disabled:opacity-50"
        :class="k === goalKind
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-line text-muted hover:text-fg hover:border-fg/40'"
        @click="pickGoal(k)"
      >{{ GOAL_ICONS[k] ?? '·' }} {{ GOAL_LABELS[k] ?? k }}</button>
    </div>

    <!-- An errand in progress -->
    <div
      v-if="order"
      class="rounded-xl border border-accent/50 bg-accent/10 px-3 py-2.5 flex flex-col gap-2"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-medium">
          {{ order.side === 'buy' ? 'Buying' : 'Selling' }} {{ errandName }}
          <span v-if="order.limit" class="ml-1 text-[10px] text-muted">limit {{ order.limit }} cr/t</span>
        </div>
        <button
          class="flex-shrink-0 text-[11px] text-muted underline hover:text-bad transition-colors"
          :disabled="busy"
          @click="callOff"
        >Scrub</button>
      </div>
      <div class="h-1.5 rounded-full bg-panel2 overflow-hidden">
        <div class="h-full bg-accent transition-all duration-500" :style="{ width: pct + '%' }" />
      </div>
      <div class="flex items-center justify-between text-[11px] text-muted">
        <span>
          <span class="text-fg font-mono">{{ order.filled }}</span> / {{ order.qty }}t
          {{ order.side === 'buy' ? 'bought' : 'sold' }}
          <span v-if="order.filled > 0"> · ~{{ order.avg }} cr avg</span>
        </span>
        <span>{{ eta }}</span>
      </div>
    </div>

    <!-- The downtime goal as a status line, with the latest reports beneath -->
    <div v-if="!order || recent.length" class="rounded-xl border border-dashed border-line bg-panel px-3 py-2.5">
      <template v-if="!order">
        <div class="text-sm" :class="goalKind === 'idle' ? 'text-muted' : 'text-fg/90'">{{ doingLine }}</div>
        <div v-if="goal?.blurb" class="text-[11px] text-muted/70 mt-0.5 italic">“{{ goal.blurb }}”</div>
      </template>
      <ul v-if="recent.length" class="flex flex-col gap-1" :class="!order ? 'mt-2 pt-2 border-t border-line/60' : ''">
        <li v-for="e in recent" :key="e.id" class="flex items-baseline gap-2 text-[11px]">
          <span class="flex-1 text-muted">{{ e.line }}</span>
          <span class="flex-shrink-0 text-muted/50 font-mono text-[10px]">{{ ago(e.at) }}</span>
        </li>
      </ul>
      <button
        class="block ml-auto mt-1.5 text-[10px] text-muted/60 hover:text-fg transition-colors"
        @click="emit('log')"
      >more ››</button>
    </div>

    <p v-if="error" class="text-bad text-xs">{{ error }}</p>
  </div>
</template>
