<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  generateGalaxy, sectorView, generatePlanet, generateStation,
  WORLD_CLASS_INFO, N, type Galaxy,
} from '@starwonder/game-core';
import { api, type SectorView, type AdminUniverseInfo, type PresenceMap } from '../api';
import GalaxyMap from '../components/admin-big-bang/GalaxyMap.vue';
import SectorDetail from '../components/game/SectorDetail.vue';
import ConfigPanel from '../components/admin/ConfigPanel.vue';
import UsersPanel from '../components/admin/UsersPanel.vue';
import AdminBigBang from './AdminBigBang.vue';

// Bubbled up so the app can refresh player state after a regenerate (everyone is reset).
const emit = defineEmits<{ 'universe-changed': [] }>();

// ── Universe + galaxy (computed client-side from the active universe's settings) ──
const universe = ref<AdminUniverseInfo | null>(null);
const galaxy = ref<Galaxy | null>(null);
const presence = ref<PresenceMap>({}); // sectorId → trader count, for the map's blue markers
const loadError = ref('');

type Tier = SectorView['dangerTier'];
interface Row {
  id: number; x: number; y: number;
  jumps: number; tier: Tier; inhabited: boolean;
  world: string; cls: string; atm: string; station: string; stationType: string;
}
const rows = ref<Row[]>([]);

async function loadExplorer(): Promise<void> {
  try {
    const u = await api.adminUniverse();
    universe.value = u;
    const g = generateGalaxy(u.settings);
    galaxy.value = g;

    // Best-effort: trader positions for the map's "players here" markers (don't block the map).
    api.adminPresence().then((p) => { presence.value = p.presence; }).catch(() => {});

    const out: Row[] = [];
    for (let id = 0; id < N; id++) {
      const v = sectorView(g, id);
      if (!v.exists) continue;
      if (v.inhabited) {
        const p = generatePlanet(u.settings.seed, id, v.rimT);
        const s = generateStation(u.settings.seed, id, v.rimT);
        out.push({ id, x: v.x, y: v.y, jumps: v.jumpsFromSol, tier: v.dangerTier,
          inhabited: true, world: p.name, cls: WORLD_CLASS_INFO[p.worldClass].label, atm: p.atmosphere,
          station: s.name, stationType: s.stationType });
      } else {
        out.push({ id, x: v.x, y: v.y, jumps: v.jumpsFromSol, tier: v.dangerTier,
          inhabited: false, world: '—', cls: '', atm: '', station: '—', stationType: '' });
      }
    }
    rows.value = out;
    select(0); // default to Sol
  } catch (e) {
    loadError.value = (e as Error).message;
  }
}

onMounted(loadExplorer);

// After a Big Bang from the embedded generate tab: reload the new universe and reset view.
async function onRegenerated(): Promise<void> {
  await loadExplorer();
  tab.value = 'map';
  emit('universe-changed');
}

// ── Selection (detail panel fetches authoritative server data, incl. overrides) ──
const tab = ref<'map' | 'table' | 'generate' | 'users' | 'settings'>('map');
const selectedId = ref<number | null>(null);
const selectedSector = ref<SectorView | null>(null);
const loadingDetail = ref(false);
let detailToken = 0;

async function select(id: number): Promise<void> {
  selectedId.value = id;
  const token = ++detailToken;
  loadingDetail.value = true;
  try {
    const s = await api.adminSector(id); // omniscient — even if this admin also plays a trader
    if (token === detailToken) selectedSector.value = s;
  } finally {
    if (token === detailToken) loadingDetail.value = false;
  }
}

// ── Map toggles ──
const showBlocked = ref(false);
const showWormholes = ref(true);
const showGradient = ref(true);

// ── Table: search, filter, sort ──
type SortKey = 'id' | 'world' | 'station' | 'type' | 'tier' | 'jumps';
const search = ref('');
const inhabitedOnly = ref(false);
const sortKey = ref<SortKey>('id');
const sortDir = ref<1 | -1>(1);

const TIER_RANK: Record<Tier, number> = { peaceful: 0, medium: 1, dangerous: 2, 'very-dangerous': 3 };

function sortBy(key: SortKey): void {
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1;
  else { sortKey.value = key; sortDir.value = 1; }
}

const displayRows = computed<Row[]>(() => {
  const q = search.value.trim().toLowerCase();
  let r = rows.value;
  if (inhabitedOnly.value) r = r.filter((x) => x.inhabited);
  if (q) r = r.filter((x) =>
    x.world.toLowerCase().includes(q) ||
    x.station.toLowerCase().includes(q) ||
    String(x.id) === q,
  );
  const key = sortKey.value;
  const dir = sortDir.value;
  return [...r].sort((a, b) => {
    const av: number | string = key === 'tier' ? TIER_RANK[a.tier] : key === 'type' ? a.stationType : a[key];
    const bv: number | string = key === 'tier' ? TIER_RANK[b.tier] : key === 'type' ? b.stationType : b[key];
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return a.id - b.id;
  });
});

const tierClass: Record<Tier, string> = {
  peaceful: 'text-good',
  medium: 'text-gold',
  dangerous: 'text-bad',
  'very-dangerous': 'text-bad',
};

const sortArrow = (key: SortKey) =>
  sortKey.value === key ? (sortDir.value === 1 ? ' ▲' : ' ▼') : '';
</script>

<template>
  <div class="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto">
    <!-- Header -->
    <header class="mb-5 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <div class="text-[10px] font-semibold uppercase tracking-[2px] text-muted">Admin · Explorer</div>
        <h1 class="text-2xl font-bold tracking-tight mt-1">Galaxy Explorer</h1>
        <p v-if="universe" class="text-xs text-muted mt-1 font-mono">
          seed <span class="text-accent">{{ universe.seed }}</span> ·
          {{ universe.reachable }} / {{ universe.size }} sectors reachable
        </p>
      </div>
      <a href="#sector" class="text-muted text-xs underline hover:text-fg transition-colors mt-1">← Back to game</a>
    </header>

    <p v-if="loadError" class="text-bad text-sm mb-4">{{ loadError }}</p>

    <!-- Tab switch -->
    <div class="inline-flex rounded-lg border border-line bg-panel p-0.5 mb-4">
      <button
        v-for="t in (['map', 'table', 'generate', 'users', 'settings'] as const)" :key="t"
        :class="['px-4 py-1.5 text-xs font-medium rounded-md capitalize transition-colors',
          tab === t ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg']"
        @click="tab = t"
      >{{ t }}</button>
    </div>

    <!-- GENERATE — the Big Bang UI, embedded as a first-class tab -->
    <AdminBigBang
      v-if="tab === 'generate'"
      embedded
      :universe-exists="true"
      @done="onRegenerated"
    />

    <!-- USERS — accounts + the traders they run -->
    <UsersPanel v-else-if="tab === 'users'" />

    <!-- SETTINGS — live operational config knobs -->
    <ConfigPanel v-else-if="tab === 'settings'" />

    <div v-else class="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
      <!-- Main column -->
      <div class="min-w-0">
        <!-- MAP -->
        <template v-if="tab === 'map'">
          <div class="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px] text-muted">
            <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" v-model="showWormholes" /> wormholes</label>
            <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" v-model="showGradient" /> danger</label>
            <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" v-model="showBlocked" /> blocked lanes</label>
            <span class="text-muted/60">click a sector to inspect</span>
          </div>
          <GalaxyMap
            v-if="galaxy"
            :galaxy="galaxy"
            :show-blocked="showBlocked"
            :show-wormholes="showWormholes"
            :show-gradient="showGradient"
            :selected="selectedId"
            :presence="presence"
            @select="select"
          />
        </template>

        <!-- TABLE -->
        <template v-else>
          <div class="flex flex-wrap items-center gap-3 mb-3">
            <input
              v-model="search"
              placeholder="search world / station / #id"
              class="flex-1 min-w-[200px] bg-panel2 border border-line rounded-lg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent transition-colors"
            />
            <label class="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
              <input type="checkbox" v-model="inhabitedOnly" /> inhabited only
            </label>
            <span class="text-[11px] text-muted">{{ displayRows.length }} rows</span>
          </div>

          <div class="border border-line rounded-xl overflow-hidden">
            <div class="max-h-[68vh] overflow-auto">
              <table class="w-full text-xs">
                <thead class="sticky top-0 bg-panel2 text-muted z-10">
                  <tr class="text-left">
                    <th class="px-3 py-2 font-medium cursor-pointer select-none" @click="sortBy('id')">Sector{{ sortArrow('id') }}</th>
                    <th class="px-3 py-2 font-medium cursor-pointer select-none" @click="sortBy('world')">World{{ sortArrow('world') }}</th>
                    <th class="px-3 py-2 font-medium cursor-pointer select-none" @click="sortBy('station')">Station{{ sortArrow('station') }}</th>
                    <th class="px-3 py-2 font-medium cursor-pointer select-none" @click="sortBy('type')">Type{{ sortArrow('type') }}</th>
                    <th class="px-3 py-2 font-medium cursor-pointer select-none" @click="sortBy('tier')">Danger{{ sortArrow('tier') }}</th>
                    <th class="px-3 py-2 font-medium cursor-pointer select-none text-right" @click="sortBy('jumps')">Jumps{{ sortArrow('jumps') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="r in displayRows" :key="r.id"
                    :class="['border-t border-line cursor-pointer transition-colors',
                      selectedId === r.id ? 'bg-accent/10' : 'hover:bg-panel2/60']"
                    @click="select(r.id)"
                  >
                    <td class="px-3 py-1.5 font-mono text-accent">#{{ r.id }}</td>
                    <td class="px-3 py-1.5">
                      <span v-if="r.inhabited">{{ r.world }}</span>
                      <span v-else class="text-muted/50">{{ r.world }}</span>
                      <span v-if="r.cls" class="text-muted/60"> · {{ r.cls }}</span>
                    </td>
                    <td class="px-3 py-1.5">
                      <span v-if="r.inhabited">{{ r.station }}</span>
                      <span v-else class="text-muted/50">{{ r.station }}</span>
                    </td>
                    <td class="px-3 py-1.5 capitalize">
                      <span v-if="r.inhabited">{{ r.stationType }}</span>
                      <span v-else class="text-muted/50">—</span>
                    </td>
                    <td :class="['px-3 py-1.5 capitalize', tierClass[r.tier]]">{{ r.tier.replace('-', ' ') }}</td>
                    <td class="px-3 py-1.5 text-right font-mono text-muted">{{ r.jumps }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>

      <!-- Detail sidebar -->
      <div class="lg:sticky lg:top-6">
        <SectorDetail :sector="selectedSector" :loading="loadingDetail" />
      </div>
    </div>
  </div>
</template>
