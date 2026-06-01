<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ActiveTrader } from '@starwonder/shared';
import { api, type SectorView } from '../../api';

const props = defineProps<{ sector: SectorView; trader: ActiveTrader }>();
const emit = defineEmits<{ traded: [trader: { credits: number; ship: ActiveTrader['ship'] }] }>();

const STATION_DESC: Record<string, string> = {
  trade: 'Trade hub',
  haven: 'Safe haven',
  outpost: 'Frontier outpost',
};

const qty = ref<Record<string, number>>({});
const busy = ref('');
const error = ref('');

const held = (id: string): number => props.trader.ship.cargo[id] ?? 0;
const used = computed(() =>
  Object.values(props.trader.ship.cargo).reduce((a, b) => a + b, 0),
);
const free = computed(() => props.trader.ship.holdSize - used.value);

function q(id: string): number {
  const v = qty.value[id];
  return v && v > 0 ? Math.floor(v) : 1;
}

async function trade(action: 'buy' | 'sell', commodity: string): Promise<void> {
  if (busy.value) return;
  error.value = '';
  busy.value = `${action}:${commodity}`;
  try {
    const res = await api.trade({ action, commodity, qty: q(commodity) });
    emit('traded', res.trader);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div v-if="!sector.station || !sector.market" class="text-center text-muted text-sm py-16">
    No station to dock with here.
  </div>

  <div v-else class="flex flex-col gap-3">
    <!-- Station header -->
    <div class="bg-panel border border-line rounded-xl px-3 py-2.5">
      <div class="text-sm font-semibold truncate">{{ sector.station.name }}</div>
      <div class="text-[11px] text-muted">
        {{ STATION_DESC[sector.station.stationType] ?? 'Station' }} · marketplace
      </div>
    </div>

    <!-- Trader bar -->
    <div class="flex justify-between text-[11px] text-muted px-1">
      <span><span class="text-gold font-semibold">{{ trader.credits }}</span> credits</span>
      <span>hold <span class="text-fg">{{ used }}</span> / {{ trader.ship.holdSize }}</span>
    </div>

    <p v-if="error" class="text-bad text-xs px-1">{{ error }}</p>

    <!-- Market table -->
    <div class="border border-line rounded-xl overflow-hidden">
      <table class="w-full text-xs">
        <thead class="bg-panel2 text-muted">
          <tr class="text-left">
            <th class="px-2.5 py-2 font-medium">Commodity</th>
            <th class="px-1 py-2 font-medium text-right">Buy</th>
            <th class="px-1 py-2 font-medium text-right">Sell</th>
            <th class="px-1 py-2 font-medium text-right">Held</th>
            <th class="px-1 py-2 font-medium text-center">Qty</th>
            <th class="px-2 py-2 font-medium text-right"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in sector.market" :key="m.id" class="border-t border-line">
            <td class="px-2.5 py-1.5">{{ m.name }}</td>
            <td class="px-1 py-1.5 text-right font-mono text-gold">{{ m.buy }}</td>
            <td class="px-1 py-1.5 text-right font-mono text-good">{{ m.sell }}</td>
            <td class="px-1 py-1.5 text-right font-mono" :class="held(m.id) ? 'text-fg' : 'text-muted/50'">{{ held(m.id) }}</td>
            <td class="px-1 py-1.5">
              <input
                type="number" min="1"
                :value="qty[m.id] ?? 1"
                @input="qty[m.id] = Number(($event.target as HTMLInputElement).value)"
                class="w-12 bg-panel2 border border-line rounded px-1 py-0.5 text-center text-fg outline-none focus:border-accent"
              />
            </td>
            <td class="px-2 py-1.5">
              <div class="flex gap-1 justify-end">
                <button
                  class="px-1.5 py-0.5 rounded border border-gold/40 text-gold text-[11px] disabled:opacity-30 hover:bg-gold/10"
                  :disabled="!!busy || trader.credits < m.buy || free < 1"
                  @click="trade('buy', m.id)"
                >buy</button>
                <button
                  class="px-1.5 py-0.5 rounded border border-good/40 text-good text-[11px] disabled:opacity-30 hover:bg-good/10"
                  :disabled="!!busy || held(m.id) < 1"
                  @click="trade('sell', m.id)"
                >sell</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-[10px] text-muted/60 px-1">
      Buy high-tech goods cheap in the core and sell them on the rim — and vice-versa for raw materials.
    </p>
  </div>
</template>
