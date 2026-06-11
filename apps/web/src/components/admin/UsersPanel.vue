<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, type AdminUser, type AdminTrader } from '../../api';

// One table row per trader. Accounts with no trader still get a row (trader === null) so the
// full membership is visible — mirrors the LEFT-JOIN feel of the sector table.
interface Row {
  userId: number;
  username: string;
  isAdmin: boolean;
  userCreatedAt: number;
  trader: AdminTrader | null;
}

const users = ref<AdminUser[]>([]);
const error = ref('');
const loaded = ref(false);

async function load(): Promise<void> {
  try {
    const res = await api.adminUsers();
    users.value = res.users;
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

const traderCount = computed(() => users.value.reduce((n, u) => n + u.traders.length, 0));

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  for (const u of users.value) {
    const base = { userId: u.id, username: u.username, isAdmin: u.isAdmin, userCreatedAt: u.createdAt };
    if (u.traders.length === 0) out.push({ ...base, trader: null });
    else for (const t of u.traders) out.push({ ...base, trader: t });
  }
  return out;
});

// ── Search + sort (same shape as the sector table) ──
type SortKey = 'owner' | 'trader' | 'credits' | 'energy' | 'sector' | 'joined';
const search = ref('');
const sortKey = ref<SortKey>('owner');
const sortDir = ref<1 | -1>(1);

function sortBy(key: SortKey): void {
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1;
  else { sortKey.value = key; sortDir.value = 1; }
}
const sortArrow = (key: SortKey) =>
  sortKey.value === key ? (sortDir.value === 1 ? ' ▲' : ' ▼') : '';

function sortVal(r: Row, key: SortKey): number | string {
  switch (key) {
    case 'owner': return r.username.toLowerCase();
    case 'trader': return r.trader?.name.toLowerCase() ?? '';
    case 'credits': return r.trader?.credits ?? -1;
    case 'energy': return r.trader?.energy ?? -1;
    case 'sector': return r.trader?.currentSector ?? -1;
    case 'joined': return r.trader?.createdAt ?? r.userCreatedAt;
  }
}

const displayRows = computed<Row[]>(() => {
  const q = search.value.trim().toLowerCase();
  let r = rows.value;
  if (q) r = r.filter((x) =>
    x.username.toLowerCase().includes(q) ||
    (x.trader?.name.toLowerCase().includes(q) ?? false) ||
    (x.trader != null && String(x.trader.id) === q),
  );
  const key = sortKey.value;
  const dir = sortDir.value;
  return [...r].sort((a, b) => {
    const av = sortVal(a, key);
    const bv = sortVal(b, key);
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return a.userId - b.userId;
  });
});

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
</script>

<template>
  <div class="min-w-0">
    <p v-if="error" class="text-bad text-sm mb-3">{{ error }}</p>

    <div class="flex flex-wrap items-center gap-3 mb-3">
      <input
        v-model="search"
        placeholder="search account / trader / #id"
        class="flex-1 min-w-[200px] bg-panel2 border border-line rounded-lg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent transition-colors"
      />
      <span class="text-[11px] text-muted">{{ users.length }} accounts · {{ traderCount }} traders</span>
    </div>

    <div v-if="loaded" class="border border-line rounded-xl overflow-hidden">
      <div class="max-h-[68vh] overflow-auto">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-panel2 text-muted z-10">
            <tr class="text-left">
              <th class="px-3 py-2 font-medium cursor-pointer select-none" @click="sortBy('owner')">Account{{ sortArrow('owner') }}</th>
              <th class="px-3 py-2 font-medium cursor-pointer select-none" @click="sortBy('trader')">Trader{{ sortArrow('trader') }}</th>
              <th class="px-3 py-2 font-medium cursor-pointer select-none text-right" @click="sortBy('credits')">Credits{{ sortArrow('credits') }}</th>
              <th class="px-3 py-2 font-medium cursor-pointer select-none text-right" @click="sortBy('energy')">Energy{{ sortArrow('energy') }}</th>
              <th class="px-3 py-2 font-medium">Hold</th>
              <th class="px-3 py-2 font-medium cursor-pointer select-none text-right" @click="sortBy('sector')">Sector{{ sortArrow('sector') }}</th>
              <th class="px-3 py-2 font-medium cursor-pointer select-none" @click="sortBy('joined')">Joined{{ sortArrow('joined') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in displayRows" :key="`${r.userId}:${r.trader?.id ?? 'none'}`" class="border-t border-line hover:bg-panel2/60">
              <td class="px-3 py-1.5">
                <span class="font-medium">{{ r.username }}</span>
                <span v-if="r.isAdmin" class="ml-1.5 text-[10px] uppercase tracking-wide text-accent border border-accent/40 rounded px-1 py-px">admin</span>
                <span class="text-muted/60 font-mono"> · #{{ r.userId }}</span>
              </td>
              <td class="px-3 py-1.5">
                <template v-if="r.trader">
                  {{ r.trader.name }}<span class="text-muted/60 font-mono"> · #{{ r.trader.id }}</span>
                </template>
                <span v-else class="text-muted/50 italic">no trader</span>
              </td>
              <td class="px-3 py-1.5 text-right font-mono">
                <span v-if="r.trader" class="text-gold">{{ r.trader.credits.toLocaleString() }}</span>
                <span v-else class="text-muted/50">—</span>
              </td>
              <td class="px-3 py-1.5 text-right font-mono">
                <span v-if="r.trader" class="text-muted">{{ r.trader.energy }}<span class="text-muted/40">/{{ r.trader.energyCap }}</span></span>
                <span v-else class="text-muted/50">—</span>
              </td>
              <td class="px-3 py-1.5 font-mono text-muted">
                <span v-if="r.trader">{{ r.trader.holdUsed }}<span class="text-muted/40">/{{ r.trader.holdSize }}</span></span>
                <span v-else class="text-muted/50">—</span>
              </td>
              <td class="px-3 py-1.5 text-right font-mono text-accent">
                <span v-if="r.trader">#{{ r.trader.currentSector }}</span>
                <span v-else class="text-muted/50">—</span>
              </td>
              <td class="px-3 py-1.5 text-muted">{{ fmtDate(r.trader?.createdAt ?? r.userCreatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
