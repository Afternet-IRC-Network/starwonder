<script setup lang="ts">
/**
 * The station market, on the dock tab. Browsing is the list; ACTING is an errand: tap a
 * listing and a ticket sheet opens where you send yourself off to buy or sell it ("Go buy
 * 5t"). The idle sim then works the errand chunk by haggled chunk, paced by energy alone —
 * a rested trader bursts most of it on the spot, a broke one fills it while you wander off
 * (docs/0-Projects/trading.md). One errand at a time; the running one shows in the
 * ACTIVITY section above (DockActivity), not here. The server is still authoritative;
 * the clamps just stop the UI offering impossible errands.
 */
import { ref, computed, watch } from 'vue';
import type { ActiveTrader } from '@starwonder/shared';
import {
  api,
  type OrderResult,
  type OrderView,
  type SectorView,
  type MarketEntry,
  type MarketEntryView,
} from '../../api';

// "your price" tag — a rumour/condition has skewed this commodity for YOU, time-boxed.
function nudgeLabel(m: MarketEntryView): string {
  if (!m.nudge) return '';
  const dir = m.nudge.pct < 0 ? `−${-m.nudge.pct}%` : `+${m.nudge.pct}%`;
  if (!m.nudge.expiresAt) return `your price ${dir}`;
  const hrs = Math.max(0, Math.round((m.nudge.expiresAt - Date.now()) / 3_600_000));
  return `your price ${dir} · ~${hrs}h`;
}

const props = defineProps<{ sector: SectorView; trader: ActiveTrader; order: OrderView | null }>();
const emit = defineEmits<{ order: [res: OrderResult] }>();

const openId = ref<string | null>(null); // the commodity whose ticket sheet is open
const side = ref<'buy' | 'sell'>('buy');
const amount = ref(0);
const limit = ref<number | null>(null); // optional per-ton price rail
const busy = ref(false);
const error = ref('');

const market = computed<MarketEntryView[]>(() => props.sector.market ?? []);
const openEntry = computed(() => market.value.find((m) => m.id === openId.value) ?? null);

const held = (id: string): number => props.trader.ship.cargo[id] ?? 0;
const used = computed(() => Object.values(props.trader.ship.cargo).reduce((a, b) => a + b, 0));
const free = computed(() => props.trader.ship.holdSize - used.value);

// Ceilings are estimates (every chunk haggles its own price) — buying is bounded by free
// hold and roughly what you can afford; selling by what you actually hold.
const maxBuy = (m: MarketEntry): number =>
  Math.max(0, Math.min(free.value, Math.floor(props.trader.credits / m.buy)));
const maxSell = (m: MarketEntry): number => held(m.id);
const maxAmount = computed(() => {
  const m = openEntry.value;
  if (!m) return 0;
  return side.value === 'buy' ? maxBuy(m) : maxSell(m);
});
const sliderMax = computed(() => Math.max(maxAmount.value, 1));

const total = computed(() => {
  const m = openEntry.value;
  if (!m) return 0;
  return amount.value * (side.value === 'buy' ? m.buy : m.sell);
});

// Why the current side can't be actioned (drives the disabled-state hint).
const blockedReason = computed(() => {
  if (props.order) return 'An activity is already under way';
  if (maxAmount.value >= 1) return '';
  if (side.value === 'sell') return 'None to sell';
  return free.value < 1 ? 'Hold full' : 'Not enough credits';
});

function clamp(): void {
  amount.value = Math.max(0, Math.min(Math.floor(amount.value || 0), maxAmount.value));
}
function onInput(e: Event): void {
  amount.value = Number((e.target as HTMLInputElement).value);
  clamp();
}
function step(d: number): void {
  amount.value += d;
  clamp();
}
function setMax(): void {
  amount.value = maxAmount.value;
}

function open(m: MarketEntry): void {
  openId.value = m.id;
  error.value = '';
  limit.value = null;
  // Default to whichever side is actually possible: buy if you can, else sell if you hold any.
  side.value = maxBuy(m) > 0 ? 'buy' : held(m.id) > 0 ? 'sell' : 'buy';
  amount.value = maxAmount.value >= 1 ? 1 : 0;
}
function close(): void {
  if (!busy.value) openId.value = null;
}
function setSide(s: 'buy' | 'sell'): void {
  side.value = s;
  if (amount.value < 1 && maxAmount.value >= 1) amount.value = 1;
  clamp();
}

// Holdings/credits change as errands fill ⇒ keep the open ticket within its ceiling.
watch(maxAmount, clamp);

// Send yourself off — the errand lands in the ACTIVITY section (a rested pool may finish
// it on the spot, in which case it never even shows as running).
async function confirm(): Promise<void> {
  const m = openEntry.value;
  if (!m || busy.value || amount.value < 1 || props.order) return;
  error.value = '';
  busy.value = true;
  try {
    const res = await api.placeOrder({
      side: side.value,
      commodity: m.id,
      qty: amount.value,
      ...(limit.value && limit.value > 0 ? { limit: Math.floor(limit.value) } : {}),
    });
    openId.value = null;
    emit('order', res); // parent patches credits/ship/energy + refreshes the story
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="!sector.station || !market.length" class="text-center text-muted text-sm py-12">
    No marketplace here.
  </div>

  <div v-else class="flex flex-col gap-3">
    <!-- Trader status -->
    <div class="flex items-center justify-between text-xs px-0.5">
      <div>
        <span class="text-gold font-semibold font-mono">{{ trader.credits.toLocaleString() }}</span>
        <span class="text-muted"> credits</span>
      </div>
      <div class="text-muted">
        hold <span class="text-fg font-mono">{{ used }}</span> / {{ trader.ship.holdSize }}
      </div>
    </div>

    <!-- Market list — tap a listing to open its ticket -->
    <ul class="flex flex-col gap-1.5">
      <li v-for="m in market" :key="m.id" class="rounded-xl border border-line bg-panel overflow-hidden">
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-panel2/50 transition-colors"
          @click="open(m)"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">
              {{ m.name }}
              <span
                v-if="m.nudge"
                class="ml-1 px-1.5 py-px rounded-full border text-[9px] font-semibold align-middle"
                :class="m.nudge.pct < 0 ? 'border-good/60 bg-good/10 text-good' : 'border-bad/60 bg-bad/10 text-bad'"
              >{{ nudgeLabel(m) }}</span>
            </div>
            <div class="text-[11px] mt-0.5">
              <span class="text-gold font-mono">{{ m.buy }}</span><span class="text-muted"> buy</span>
              <span class="text-muted"> · </span>
              <span class="text-good font-mono">{{ m.sell }}</span><span class="text-muted"> sell</span>
            </div>
          </div>
          <div class="text-right leading-tight">
            <div class="text-[9px] uppercase tracking-[1.5px] text-muted">held</div>
            <div class="text-sm font-mono" :class="held(m.id) ? 'text-fg' : 'text-muted/40'">{{ held(m.id) }}</div>
          </div>
          <span class="text-muted text-xs">›</span>
        </button>
      </li>
    </ul>

    <p class="text-[10px] text-muted/60 px-0.5">
      Buy high-tech goods cheap in the core and sell them on the rim, and vice-versa for raw materials.
    </p>

    <!-- ── Ticket sheet ── send yourself to go buy / sell the tapped commodity -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="openEntry"
        class="fixed inset-0 z-40 flex flex-col justify-end sm:justify-center bg-black/60 backdrop-blur-sm"
        @click.self="close"
      >
        <div class="mx-auto w-full max-w-md bg-bg border-t sm:border border-line rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[88vh] overflow-hidden shadow-2xl shadow-black/50">
          <!-- Title bar -->
          <header class="flex items-center gap-2.5 px-4 py-3 border-b border-line flex-shrink-0">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold truncate">
                {{ openEntry.name }}
                <span
                  v-if="openEntry.nudge"
                  class="ml-1 px-1.5 py-px rounded-full border text-[9px] font-semibold align-middle"
                  :class="openEntry.nudge.pct < 0 ? 'border-good/60 bg-good/10 text-good' : 'border-bad/60 bg-bad/10 text-bad'"
                >{{ nudgeLabel(openEntry) }}</span>
              </div>
              <div class="text-[11px] text-muted">
                <span class="text-gold font-mono">{{ openEntry.buy }}</span> buy ·
                <span class="text-good font-mono">{{ openEntry.sell }}</span> sell ·
                held {{ held(openEntry.id) }}t
              </div>
            </div>
            <button
              class="w-8 h-8 -mr-1 grid place-items-center rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors"
              aria-label="Close ticket"
              @click="close"
            >✕</button>
          </header>

          <div class="p-4 flex flex-col gap-3 overflow-y-auto">
            <!-- Buy / Sell toggle -->
            <div class="grid grid-cols-2 gap-1 p-0.5 bg-panel2 rounded-lg border border-line">
              <button
                class="py-1.5 rounded-md text-xs font-semibold transition-colors"
                :class="side === 'buy' ? 'bg-gold/15 text-gold' : 'text-muted hover:text-fg'"
                @click="setSide('buy')"
              >Buy</button>
              <button
                class="py-1.5 rounded-md text-xs font-semibold transition-colors"
                :class="side === 'sell' ? 'bg-good/15 text-good' : 'text-muted hover:text-fg'"
                @click="setSide('sell')"
              >Sell</button>
            </div>

            <!-- Quantity stepper -->
            <div class="flex items-center gap-2">
              <button
                class="w-8 h-8 rounded-lg border border-line bg-panel grid place-items-center text-lg leading-none disabled:opacity-30 hover:border-accent transition-colors"
                :disabled="amount <= 0"
                @click="step(-1)"
              >−</button>
              <input
                type="number" min="0" :max="maxAmount" inputmode="numeric"
                :value="amount"
                class="flex-1 h-8 min-w-0 bg-panel border border-line rounded-lg text-center text-sm font-mono text-fg outline-none focus:border-accent"
                @input="onInput"
              />
              <button
                class="w-8 h-8 rounded-lg border border-line bg-panel grid place-items-center text-lg leading-none disabled:opacity-30 hover:border-accent transition-colors"
                :disabled="amount >= maxAmount"
                @click="step(1)"
              >+</button>
              <button
                class="px-2.5 h-8 rounded-lg border border-line bg-panel text-[11px] text-muted disabled:opacity-30 hover:border-accent hover:text-fg transition-colors"
                :disabled="maxAmount < 1"
                @click="setMax"
              >Max</button>
            </div>

            <!-- Slider -->
            <input
              type="range" min="0" :max="sliderMax" :value="amount" :disabled="maxAmount < 1"
              class="w-full accent-accent disabled:opacity-40"
              @input="onInput"
            />

            <!-- Optional price rail: ceiling when buying, floor when selling -->
            <div class="flex items-center gap-2 text-[11px] text-muted">
              <label class="flex-shrink-0" for="order-limit">
                {{ side === 'buy' ? 'Pay at most' : 'Accept at least' }}
              </label>
              <input
                id="order-limit" type="number" min="1" inputmode="numeric" placeholder="no limit"
                :value="limit ?? ''"
                class="w-24 h-7 bg-panel border border-line rounded-lg text-center text-xs font-mono text-fg outline-none focus:border-accent"
                @input="limit = Number(($event.target as HTMLInputElement).value) || null"
              />
              <span>cr / ton</span>
            </div>

            <!-- Summary + go -->
            <div class="flex items-center justify-between gap-3">
              <div class="text-[11px] min-w-0 truncate">
                <span v-if="blockedReason" class="text-bad">{{ blockedReason }}</span>
                <span v-else class="text-muted">
                  <span :class="side === 'buy' ? 'text-gold' : 'text-good'" class="font-mono">
                    {{ side === 'buy' ? '−' : '+' }}{{ total.toLocaleString() }} cr
                  </span>
                  · max {{ maxAmount }} · haggled per fill
                </span>
              </div>
              <button
                class="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-30"
                :class="side === 'buy'
                  ? 'border-gold text-gold bg-gold/10 hover:bg-gold/20'
                  : 'border-good text-good bg-good/10 hover:bg-good/20'"
                :disabled="busy || amount < 1 || !!props.order"
                @click="confirm"
              >{{ busy ? '…' : side === 'buy' ? `Buy ${amount}t` : `Sell ${amount}t` }}</button>
            </div>

            <p v-if="error" class="text-bad text-xs">{{ error }}</p>

            <p class="text-[10px] text-muted/60">
              Fills run a few tons at a time, as energy allows — each one haggled on the
              spot. A scrubbed activity keeps whatever has already filled.
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
