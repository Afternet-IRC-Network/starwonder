<script setup lang="ts">
/**
 * The station marketplace, shown inside the dock modal (opened by tapping a station's
 * "In orbit" card). Each commodity expands into an action-scoped trade ticket: a Buy/Sell
 * toggle plus a quantity stepper / slider / Max, every control clamped to a real ceiling —
 * buying is bounded by free hold AND what you can afford; selling by what you actually hold.
 * The server is still authoritative; the clamps just stop the UI offering impossible trades.
 */
import { ref, computed, watch } from 'vue';
import type { ActiveTrader } from '@starwonder/shared';
import { api, type SectorView, type MarketEntry } from '../../api';

const props = defineProps<{ sector: SectorView; trader: ActiveTrader }>();
const emit = defineEmits<{ traded: [trader: { credits: number; ship: ActiveTrader['ship'] }] }>();

const openId = ref<string | null>(null); // the commodity whose trade ticket is expanded
const side = ref<'buy' | 'sell'>('buy');
const amount = ref(0);
const busy = ref(false);
const error = ref('');

const market = computed<MarketEntry[]>(() => props.sector.market ?? []);
const openEntry = computed(() => market.value.find((m) => m.id === openId.value) ?? null);

const held = (id: string): number => props.trader.ship.cargo[id] ?? 0;
const used = computed(() => Object.values(props.trader.ship.cargo).reduce((a, b) => a + b, 0));
const free = computed(() => props.trader.ship.holdSize - used.value);

// Action-aware ceilings — the whole point of the redesign.
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
  if (openId.value === m.id) { openId.value = null; return; }
  openId.value = m.id;
  error.value = '';
  // Default to whichever side is actually possible: buy if you can, else sell if you hold any.
  side.value = maxBuy(m) > 0 ? 'buy' : held(m.id) > 0 ? 'sell' : 'buy';
  amount.value = maxAmount.value >= 1 ? 1 : 0;
}
function setSide(s: 'buy' | 'sell'): void {
  side.value = s;
  if (amount.value < 1 && maxAmount.value >= 1) amount.value = 1;
  clamp();
}

// Holdings/credits change after a trade ⇒ keep the open ticket within its new ceiling.
watch(maxAmount, clamp);

async function confirm(): Promise<void> {
  const m = openEntry.value;
  if (!m || busy.value || amount.value < 1) return;
  error.value = '';
  busy.value = true;
  try {
    const res = await api.trade({ action: side.value, commodity: m.id, qty: amount.value });
    emit('traded', res.trader); // parent patches credits + ship → our ceilings recompute
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

    <p v-if="error" class="text-bad text-xs px-0.5">{{ error }}</p>

    <!-- Market list -->
    <ul class="flex flex-col gap-1.5">
      <li v-for="m in market" :key="m.id" class="rounded-xl border border-line bg-panel overflow-hidden">
        <!-- Row header — tap to open the trade ticket -->
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-panel2/50 transition-colors"
          @click="open(m)"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ m.name }}</div>
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
          <span
            class="text-muted text-xs transition-transform duration-200"
            :class="openId === m.id ? 'rotate-90' : ''"
          >›</span>
        </button>

        <!-- Trade ticket -->
        <div v-if="openId === m.id" class="border-t border-line bg-panel2/40 px-3 py-3 flex flex-col gap-3">
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

          <!-- Summary + confirm -->
          <div class="flex items-center justify-between gap-3">
            <div class="text-[11px] min-w-0 truncate">
              <span v-if="blockedReason" class="text-bad">{{ blockedReason }}</span>
              <span v-else class="text-muted">
                <span :class="side === 'buy' ? 'text-gold' : 'text-good'" class="font-mono">
                  {{ side === 'buy' ? '−' : '+' }}{{ total.toLocaleString() }} cr
                </span>
                · max {{ maxAmount }}
              </span>
            </div>
            <button
              class="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-30"
              :class="side === 'buy'
                ? 'border-gold text-gold bg-gold/10 hover:bg-gold/20'
                : 'border-good text-good bg-good/10 hover:bg-good/20'"
              :disabled="busy || amount < 1"
              @click="confirm"
            >{{ busy ? '…' : side === 'buy' ? `Buy ${amount}` : `Sell ${amount}` }}</button>
          </div>
        </div>
      </li>
    </ul>

    <p class="text-[10px] text-muted/60 px-0.5">
      Buy high-tech goods cheap in the core and sell them on the rim — and vice-versa for raw materials.
    </p>
  </div>
</template>
