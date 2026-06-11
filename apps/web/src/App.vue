<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { MeResponse, ShipData } from '@starwonder/shared';
import { currentEnergy, DEFAULT_ENERGY } from '@starwonder/game-core';
import { api, type SectorView, type UniverseInfo, type MapView, type PresenceMap } from './api';
import AdminBigBang from './controllers/AdminBigBang.vue';
import AdminExplorer from './controllers/AdminExplorer.vue';
import OrbitPanel from './components/game/OrbitPanel.vue';
import PilotScreen from './components/game/PilotScreen.vue';
import DockMarket from './components/game/DockMarket.vue';
import StarChart from './components/game/StarChart.vue';
import WarpLane from './components/game/WarpLane.vue';

// ── State ───────────────────────────────────────────────────────────────────
const me = ref<MeResponse | null>(null);
const sector = ref<SectorView | null>(null);
const universe = ref<UniverseInfo | null>(null);
const mapView = ref<MapView | null>(null);
const mapPresence = ref<PresenceMap>({}); // sectorId → count of other traders, for the blue map pips
const booting = ref(true);

const at = computed(() => me.value?.activeTrader ?? null);

// ── Star-chart selection ──────────────────────────────────────────────────────
// `mapSelected` = a remote sector the player tapped on the map; null ⇒ following the
// current sector (its panel is the already-loaded `sector`). The map only ever shows
// sectors you've actually visited, so a tap always has authoritative detail to fetch.
const mapSelected = ref<number | null>(null);
const mapDetail = ref<SectorView | null>(null);
const mapDetailLoading = ref(false);

const panelSector = computed<SectorView | null>(() =>
  mapSelected.value == null ? sector.value : mapDetail.value,
);

function resetMapSelection() {
  mapSelected.value = null;
  mapDetail.value = null;
  travelError.value = '';
}

// Is this map node an unexplored frontier "?" (vs. a visited sector with real detail)?
function isFrontier(id: number): boolean {
  return mapView.value?.sectors.find((s) => s.id === id)?.fog === 'frontier';
}

function onMapSelect(id: number) {
  if (id === at.value?.currentSector) { resetMapSelection(); return; }
  mapSelected.value = id;
  mapDetail.value = null;
  travelError.value = '';
  // A frontier "?" has no charted detail to fetch — just select it so a course can be plotted.
  if (isFrontier(id)) { mapDetailLoading.value = false; return; }
  mapDetailLoading.value = true;
  api
    .sector(id)
    .then((s) => { mapDetail.value = s; })
    .catch(() => { mapDetail.value = null; })
    .finally(() => { mapDetailLoading.value = false; });
}

// ── Route plotting ────────────────────────────────────────────────────────────
// Cheapest-energy course over *known* space (lanes between known sectors + taken
// wormholes — exactly the `MapView.edges`). Display-only here; the actual travel below is
// authoritative, walking it one `/api/move` at a time.
function planRoute(
  view: MapView,
  from: number,
  to: number,
  moveCost = 1,
): { path: number[]; hops: number; energy: number } | null {
  // Lanes cost the flat move price; wormholes carry their own span-based cost on the edge.
  const adj = new Map<number, { to: number; cost: number }[]>();
  const nodes = new Set<number>([from]);
  for (const e of view.edges) {
    const cost = e.kind === 'wormhole' ? (e.cost ?? moveCost) : moveCost;
    nodes.add(e.a); nodes.add(e.b);
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, cost });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, cost });
  }
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  for (;;) {
    let u = -1, best = Infinity;
    for (const n of nodes) {
      if (done.has(n)) continue;
      const d = dist.get(n);
      if (d !== undefined && d < best) { best = d; u = n; }
    }
    if (u === -1 || u === to) break;
    done.add(u);
    for (const { to: v, cost } of adj.get(u) ?? []) {
      const nd = best + cost;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); }
    }
  }
  if (!dist.has(to)) return null;
  const path: number[] = [];
  for (let cur: number | undefined = to; cur !== undefined; cur = prev.get(cur)) {
    path.unshift(cur);
    if (cur === from) break;
  }
  if (path[0] !== from) return null;
  return { path, hops: path.length - 1, energy: dist.get(to)! };
}

const route = computed<{ path: number[]; hops: number; energy: number } | null>(() => {
  const target = mapSelected.value;
  if (target == null || !mapView.value || !at.value) return null;
  if (target === at.value.currentSector) return null;
  return planRoute(mapView.value, at.value.currentSector, target, universe.value?.costs.move);
});
const routePath = computed<number[]>(() => route.value?.path ?? []);
const canAffordRoute = computed(
  () => !!route.value && !!at.value && liveEnergy.value >= route.value.energy,
);

const traveling = ref(false);
const travelError = ref('');
async function travelRoute() {
  const r = route.value;
  if (!r || traveling.value || !me.value?.activeTrader) return;
  traveling.value = true;
  travelError.value = '';
  const t = me.value.activeTrader;
  let ok = true;
  let arrival: SectorView | null = null;
  let chartedDest = false;
  try {
    // Walk the course hop-by-hop; each move is validated server-side.
    for (let i = 1; i < r.path.length; i++) {
      const res = await api.move({ to: r.path[i] });
      t.currentSector = res.trader.currentSector;
      t.energy = res.trader.energy;
      t.energyUpdatedAt = res.trader.energyUpdatedAt;
      t.credits = res.trader.credits;
      t.ship = res.trader.ship;
      sector.value = res.sector;
      arrival = res.sector;
      chartedDest = res.discovered; // only the final hop's flag matters for the on-arrival toast
    }
  } catch (e) {
    travelError.value = (e as Error).message;
    ok = false;
  }
  // Fog grew as far as we got — refresh the chart either way.
  try { const m = await api.map(); mapView.value = m; mapPresence.value = m.presence; } catch { /* keep stale view */ }
  traveling.value = false;
  if (ok) {
    resetMapSelection();
    navigate('sector'); // arrived → drop back to the sector screen at the destination
    // Toast fires for the sector you're actually looking at — never an unseen sector mid-route.
    if (chartedDest && arrival) announceDiscovery(arrival);
  }
  // On failure: stay on the map so the route + error stay visible.
}

// ── Hash router ───────────────────────────────────────────────────────────────
const GAME_TABS = ['sector', 'map', 'ship', 'log'] as const;
type GameTab = (typeof GAME_TABS)[number];
const AUTH_PAGES = ['login', 'register'] as const;

const hash = ref(window.location.hash.replace(/^#/, '') || '');

function navigate(page: string) {
  if (window.location.hash.replace(/^#/, '') === page) return;
  window.location.hash = page;
}

onMounted(() => {
  window.addEventListener('hashchange', () => {
    hash.value = window.location.hash.replace(/^#/, '') || '';
  });
});

// ── Derived view ──────────────────────────────────────────────────────────────
const view = computed(() => {
  if (!me.value) return 'auth';
  const m = me.value;
  if (m.user.isAdmin && !m.universeExists) return 'admin-setup';
  if (m.user.isAdmin && hash.value === 'admin') return 'admin-explore';
  if (!m.universeExists) return 'no-universe';
  if (!m.activeTrader) return 'pilot';
  return 'game';
});

const mode = computed(() => (hash.value === 'register' ? 'register' : 'login'));
const gameTab = computed<GameTab>(() =>
  (GAME_TABS as readonly string[]).includes(hash.value) ? (hash.value as GameTab) : 'sector',
);

// ── Navigation sync ───────────────────────────────────────────────────────────
watch(view, (newView, oldView) => {
  if (booting.value) return;
  if (newView === 'auth' && !(AUTH_PAGES as readonly string[]).includes(hash.value)) {
    navigate('login');
  } else if (newView === 'admin-setup' && hash.value !== 'admin') {
    navigate('admin');
  } else if (newView === 'game' && oldView !== 'game') {
    if (!sector.value) loadGame();
    if (!(GAME_TABS as readonly string[]).includes(hash.value)) navigate('sector');
  }
});

// Lazily load the fog map when the map tab is opened.
watch([gameTab, view], async ([tab, v]) => {
  if (v === 'game' && tab === 'map' && !mapView.value) {
    try {
      const m = await api.map();
      mapView.value = m;
      mapPresence.value = m.presence;
    } catch { /* ignore — shown as empty */ }
  }
});

// ── Game data ─────────────────────────────────────────────────────────────────
async function loadGame() {
  if (!at.value) return;
  [universe.value, sector.value] = await Promise.all([
    api.universe(),
    api.sector(at.value.currentSector),
  ]);
}

const moveError = ref('');
const moving = ref(false);

// "New sector charted" toast — fired on the *arrival event* (the move's `discovered` flag),
// not the sector's visited state, so it never re-fires when you flip back to the Sector tab.
// Auto-dismisses; shows over the orbit viewport.
const discovery = ref<string | null>(null);
let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
function announceDiscovery(sec: SectorView) {
  discovery.value = sec.planet
    ? `New system charted · ${sec.planet.name}`
    : `Uncharted space surveyed · ${sec.addr}`;
  if (discoveryTimer) clearTimeout(discoveryTimer);
  discoveryTimer = setTimeout(() => { discovery.value = null; }, 4500);
}

async function move(body: { to: number } | { wormhole: number }) {
  if (moving.value || !me.value?.activeTrader) return;
  moving.value = true;
  moveError.value = '';
  try {
    const res = await api.move(body);
    const t = me.value.activeTrader;
    t.currentSector = res.trader.currentSector;
    t.energy = res.trader.energy;
    t.energyUpdatedAt = res.trader.energyUpdatedAt;
    t.credits = res.trader.credits;
    t.ship = res.trader.ship;
    sector.value = res.sector;
    if (res.discovered) announceDiscovery(res.sector);
    mapView.value = null; // fog grew — refetch on next map view
    resetMapSelection(); // map follows you to the new sector
  } catch (e) {
    moveError.value = (e as Error).message;
  } finally {
    moving.value = false;
  }
}

function onTraded(trader: { credits: number; ship: ShipData }) {
  if (!me.value?.activeTrader) return;
  me.value.activeTrader.credits = trader.credits;
  me.value.activeTrader.ship = trader.ship;
}

// ── Dock modal ──────────────────────────────────────────────────────────────────
// Reached by tapping a station's "In orbit" card (no more bottom-nav "dock" tab, since a
// sector could host more than one station later). Always docks the trader's *current*
// sector; leaving the sector closes it.
const STATION_DESC: Record<string, string> = {
  trade: 'Trade hub',
  haven: 'Safe haven',
  outpost: 'Frontier outpost',
};
const dockOpen = ref(false);
function openDock() {
  if (sector.value?.station) dockOpen.value = true;
}
watch(() => at.value?.currentSector, () => { dockOpen.value = false; });

// ── Auth ────────────────────────────────────────────────────────────────────
const username = ref('');
const password = ref('');
const gate = ref('');
const formError = ref('');
const busy = ref(false);

async function submit() {
  formError.value = '';
  busy.value = true;
  try {
    me.value =
      mode.value === 'register'
        ? await api.register({ gate: gate.value, username: username.value, password: password.value })
        : await api.login({ username: username.value, password: password.value });
    if (view.value === 'game') await loadGame();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function logout() {
  await api.logout();
  me.value = null;
  sector.value = null;
  mapView.value = null;
  dockOpen.value = false;
}

async function onPilotReady(m: MeResponse) {
  me.value = m;
  await loadGame();
  navigate('sector');
}

async function onBigBangDone() {
  me.value = await api.me();
  navigate('admin');
}

async function onUniverseChanged() {
  me.value = await api.me();
  sector.value = null;
  mapView.value = null;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
onMounted(async () => {
  me.value = await api.me();
  // Public — also tells us if this is a fresh deploy with no world yet.
  try { universe.value = await api.universe(); } catch { /* offline — handled below */ }
  if (view.value === 'game') await loadGame();
  booting.value = false;

  if (view.value === 'auth') {
    // Fresh instance (no world yet) → default to register so the first admin can sign up;
    // once a world exists, returning players land on login.
    if (!(AUTH_PAGES as readonly string[]).includes(hash.value)) {
      navigate(universe.value?.exists ? 'login' : 'register');
    }
  } else if (view.value === 'admin-setup') {
    if (hash.value !== 'admin') navigate('admin');
  } else if (view.value === 'admin-explore') {
    // keep #admin
  } else if (view.value === 'game') {
    if (!(GAME_TABS as readonly string[]).includes(hash.value)) navigate('sector');
  }
});

// ── Live energy ─────────────────────────────────────────────────────────────────
// Energy is a timestamp, not a timer (same model as the server): we hold the value the
// server settled to `energyUpdatedAt` and recompute the current value locally on a clock
// tick, so the bar refills on its own with no poll. Every action (move/travel) hands back a
// fresh {energy, energyUpdatedAt}, re-anchoring the computation. `now` advances on an
// interval; browsers pause it on a hidden tab, so it jumps to the real time on return — the
// bar is correct the instant you look at it. The server stays authoritative on every spend.
const now = ref(Date.now());
let energyTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => { energyTimer = setInterval(() => { now.value = Date.now(); }, 5000); });
onUnmounted(() => { if (energyTimer) clearInterval(energyTimer); });

const liveEnergy = computed(() =>
  at.value
    ? currentEnergy({ value: at.value.energy, updatedAt: at.value.energyUpdatedAt }, DEFAULT_ENERGY, now.value).value
    : 0,
);

// ── Misc ──────────────────────────────────────────────────────────────────────
const energyPct = computed(() =>
  at.value ? Math.round((liveEnergy.value / at.value.energyCap) * 100) : 0,
);
const holdUsed = computed(() =>
  at.value ? Object.values(at.value.ship.cargo).reduce((a, b) => a + b, 0) : 0,
);
</script>

<template>
  <!-- Boot splash -->
  <div v-if="booting" class="min-h-screen grid place-items-center text-muted text-sm">
    loading…
  </div>

  <!-- ── Auth ── -->
  <div v-else-if="view === 'auth'" class="min-h-screen grid place-items-center p-4 bg-bg">
    <div class="w-full max-w-sm bg-panel border border-line rounded-2xl p-6">
      <h1 class="text-lg font-bold tracking-wide">StarWonder</h1>
      <p class="text-xs text-muted mt-1 mb-5">
        {{ mode === 'register'
          ? 'Create an account. You need the gate password to join.'
          : 'Welcome back.' }}
      </p>

      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <input
          v-model="username"
          placeholder="username"
          autocomplete="username"
          class="bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors"
        />
        <input
          v-model="password"
          type="password"
          placeholder="password"
          :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
          class="bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors"
        />
        <input
          v-if="mode === 'register'"
          v-model="gate"
          placeholder="gate password"
          class="bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors"
        />
        <button
          :disabled="busy"
          class="bg-accent/15 border border-accent text-accent rounded-lg px-3 py-2 font-semibold text-sm disabled:opacity-50 hover:bg-accent/25 transition-colors"
        >
          {{ busy ? '…' : mode === 'register' ? 'Create account' : 'Log in' }}
        </button>
      </form>

      <p v-if="formError" class="text-bad text-xs mt-3">{{ formError }}</p>

      <button
        class="text-muted text-xs mt-4 underline hover:text-fg transition-colors"
        @click="navigate(mode === 'register' ? 'login' : 'register')"
      >
        {{ mode === 'register' ? 'Have an account? Log in' : 'New here? Create an account' }}
      </button>
    </div>
  </div>

  <!-- ── Admin setup ── -->
  <AdminBigBang
    v-else-if="view === 'admin-setup'"
    :universe-exists="me?.universeExists"
    @done="onBigBangDone"
  />

  <!-- ── Admin explorer ── -->
  <AdminExplorer v-else-if="view === 'admin-explore'" @universe-changed="onUniverseChanged" />

  <!-- ── No universe (non-admin) ── -->
  <div v-else-if="view === 'no-universe'" class="min-h-screen grid place-items-center p-4 text-center">
    <div class="max-w-xs">
      <h1 class="text-lg font-bold">The galaxy isn't ready yet</h1>
      <p class="text-sm text-muted mt-2">An admin needs to run the Big Bang. Check back soon.</p>
      <button class="text-muted text-xs mt-4 underline hover:text-fg" @click="logout">log out</button>
    </div>
  </div>

  <!-- ── Pilot screen ── -->
  <PilotScreen
    v-else-if="view === 'pilot' && me"
    :me="me"
    @ready="onPilotReady"
    @logout="logout"
  />

  <!-- ── Game ── -->
  <div v-else-if="view === 'game' && at" class="min-h-screen mx-auto max-w-md flex flex-col">

    <header class="px-4 pt-4 pb-3 border-b border-line flex-shrink-0">
      <div class="flex items-center justify-between">
        <div class="font-mono text-sm text-accent">{{ sector?.addr ?? '—' }}</div>
        <div class="flex items-center gap-3">
          <span class="text-[11px] text-muted">{{ at.name }}</span>
          <button
            v-if="me?.user.isAdmin"
            class="text-muted text-xs underline hover:text-fg transition-colors"
            @click="navigate('admin')"
          >admin</button>
          <button class="text-muted text-xs underline hover:text-fg transition-colors" @click="logout">
            log out
          </button>
        </div>
      </div>
      <div class="mt-3 flex items-center gap-3">
        <div class="flex-1">
          <div class="flex justify-between text-[11px] text-muted mb-1">
            <span>Energy</span><span>{{ liveEnergy }} / {{ at.energyCap }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-panel2 overflow-hidden">
            <div class="h-full bg-accent transition-all duration-300" :style="{ width: energyPct + '%' }" />
          </div>
        </div>
        <div class="text-right">
          <div class="text-[11px] text-muted">Credits</div>
          <div class="text-sm text-gold font-mono">{{ at.credits }}</div>
        </div>
      </div>
    </header>

    <main class="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">

      <!-- Sector tab -->
      <template v-if="gameTab === 'sector'">
        <div class="relative">
          <OrbitPanel v-if="sector" :sector="sector" dockable @dock="openDock" />
          <div v-else class="h-[230px] rounded-2xl border border-line bg-[#080c16] grid place-items-center text-muted text-xs">
            loading…
          </div>
          <!-- First-visit toast — fades in over the viewport, auto-dismisses -->
          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-500 ease-in"
            leave-to-class="opacity-0 -translate-y-1"
          >
            <div
              v-if="discovery"
              class="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0e1730]/90 border border-accent/60 text-[11px] font-semibold text-fg backdrop-blur-sm shadow-lg shadow-black/40 whitespace-nowrap"
            >
              <span class="text-gold">✦</span> {{ discovery }}
            </div>
          </Transition>
        </div>

        <p v-if="moveError" class="text-bad text-xs px-1">{{ moveError }}</p>

        <div v-if="sector">
          <div class="text-[10px] uppercase tracking-[2px] text-muted mb-2 px-1">Warp lanes</div>
          <div class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
            <!-- Lanes -->
            <WarpLane
              v-for="lane in (sector.lanes ?? [])"
              :key="'l' + lane.id"
              :lane="lane"
              :disabled="moving || liveEnergy < (universe?.costs.move ?? 1)"
              @go="move({ to: lane.id })"
            />
            <!-- Wormholes -->
            <button
              v-for="(w, i) in sector.wormholeExits"
              :key="'w' + i"
              :disabled="moving || liveEnergy < w.cost"
              class="flex-shrink-0 min-w-[108px] border rounded-xl p-3 text-left transition-colors disabled:opacity-40"
              style="background:#161226;border-color:#5a4a1e"
              @click="w.to != null ? move({ to: w.to }) : move({ wormhole: w.ref })"
            >
              <div class="font-bold text-sm font-mono text-gold">
                <template v-if="w.to != null">◌ #{{ w.to }}</template>
                <template v-else>◌ unknown</template>
              </div>
              <div class="text-[10px] text-muted mt-1">{{ w.cost }} ⚡ · wormhole</div>
            </button>
            <div v-if="!sector.neighbors.length && !sector.wormholeExits.length"
              class="flex-shrink-0 min-w-[108px] bg-panel2 border border-dashed border-line rounded-xl p-3">
              <div class="text-sm text-muted">isolated</div>
              <div class="text-[10px] text-muted mt-1">no open lanes</div>
            </div>
          </div>
        </div>
      </template>

      <!-- Map tab -->
      <template v-else-if="gameTab === 'map'">
        <div class="text-[10px] uppercase tracking-[2px] text-muted px-1">Known space</div>
        <StarChart
          v-if="mapView"
          :view="mapView"
          :current="at.currentSector"
          :selected="mapSelected"
          :route="routePath"
          :presence="mapPresence"
          @select="onMapSelect"
        />
        <div v-else class="h-[268px] rounded-2xl border border-line bg-[#070b14] grid place-items-center text-muted text-xs">
          loading map…
        </div>

        <!-- Selected sector — the shared sector view (incl. the "also here" roster) -->
        <template v-if="mapView">
          <div
            v-if="mapDetailLoading && !panelSector"
            class="h-[230px] rounded-2xl border border-line bg-[#080c16] grid place-items-center text-muted text-xs"
          >
            scanning sector…
          </div>
          <div v-else-if="panelSector">
            <div class="text-[10px] uppercase tracking-[2px] text-muted mb-2 px-1">
              {{ panelSector.id === at.currentSector ? 'You are here' : 'Inspecting' }}
            </div>
            <OrbitPanel :sector="panelSector" :dockable="panelSector.id === at.currentSector" @dock="openDock" />
          </div>
          <div v-else-if="mapSelected != null && isFrontier(mapSelected)">
            <div class="text-[10px] uppercase tracking-[2px] text-muted mb-2 px-1">Unexplored</div>
            <div class="bg-panel border border-dashed border-line rounded-2xl p-5 text-center">
              <div class="text-2xl text-muted font-bold leading-none mb-2">?</div>
              <div class="text-sm font-semibold">Uncharted sector</div>
              <p class="text-[11px] text-muted mt-1">Plot a course and fly there to discover what's waiting.</p>
            </div>
          </div>

          <!-- Route to the selected sector — sibling of OrbitPanel, so it sits under "In orbit" -->
          <div v-if="mapSelected != null && mapSelected !== at.currentSector">
            <div class="text-[10px] uppercase tracking-[2.5px] text-muted mt-3 mb-1.5">Route</div>
            <template v-if="route">
              <div class="flex items-center gap-3 bg-panel border border-line rounded-xl px-3 py-2.5">
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold">
                    {{ route.hops }} hop{{ route.hops === 1 ? '' : 's' }} · {{ route.energy }} ⚡
                  </div>
                  <div class="text-[11px]" :class="canAffordRoute ? 'text-muted' : 'text-bad'">
                    <template v-if="canAffordRoute">{{ liveEnergy }} ⚡ available</template>
                    <template v-else>need {{ route.energy }} ⚡ · only {{ liveEnergy }} available</template>
                  </div>
                </div>
                <button
                  :disabled="!canAffordRoute || traveling"
                  class="flex-shrink-0 rounded-lg px-4 py-2 text-sm font-semibold bg-accent/15 border border-accent text-accent disabled:opacity-40 hover:bg-accent/25 transition-colors"
                  @click="travelRoute"
                >{{ traveling ? 'travelling…' : 'Travel here' }}</button>
              </div>
              <p v-if="travelError" class="text-bad text-xs mt-1 px-1">{{ travelError }}</p>
            </template>
            <div v-else class="bg-panel border border-dashed border-line rounded-xl px-3 py-2.5 text-[11px] text-muted">
              No charted route — explore a path there first.
            </div>
          </div>
        </template>
      </template>

      <!-- Ship tab -->
      <template v-else-if="gameTab === 'ship'">
        <div class="bg-panel border border-line rounded-2xl p-4">
          <div class="text-sm font-semibold mb-2">{{ at.name }}'s ship</div>
          <div class="flex justify-between text-[11px] text-muted mb-3">
            <span>Cargo hold</span><span>{{ holdUsed }} / {{ at.ship.holdSize }} tons</span>
          </div>
          <div v-if="holdUsed === 0" class="text-muted text-xs">Cargo hold empty.</div>
          <ul v-else class="text-sm flex flex-col gap-1">
            <li v-for="(qty, id) in at.ship.cargo" :key="id" class="flex justify-between">
              <span class="capitalize">{{ id }}</span><span class="font-mono text-muted">{{ qty }}</span>
            </li>
          </ul>
        </div>
      </template>

      <!-- Log tab -->
      <div v-else class="flex-1 grid place-items-center text-muted text-sm py-16">
        {{ gameTab }} · coming soon
      </div>

    </main>

    <nav class="border-t border-line grid grid-cols-4 flex-shrink-0">
      <button
        v-for="tab in GAME_TABS"
        :key="tab"
        :class="['py-3 text-[11px] capitalize transition-colors', gameTab === tab ? 'text-accent' : 'text-muted hover:text-fg']"
        @click="navigate(tab)"
      >{{ tab }}</button>
    </nav>

    <!-- ── Dock modal ── opened by tapping a station; trades the current sector -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="dockOpen && sector?.station"
        class="fixed inset-0 z-30 flex flex-col justify-end sm:justify-center bg-black/60 backdrop-blur-sm"
        @click.self="dockOpen = false"
      >
        <div class="mx-auto w-full max-w-md bg-bg border-t sm:border border-line rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[88vh] overflow-hidden shadow-2xl shadow-black/50">
          <!-- Title bar -->
          <header class="flex items-center gap-2.5 px-4 py-3 border-b border-line flex-shrink-0">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold truncate">{{ sector.station.name }}</div>
              <div class="text-[11px] text-muted">
                {{ STATION_DESC[sector.station.stationType] ?? 'Station' }} · marketplace
              </div>
            </div>
            <button
              class="w-8 h-8 -mr-1 grid place-items-center rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors"
              aria-label="Close dock"
              @click="dockOpen = false"
            >✕</button>
          </header>
          <div class="p-4 overflow-y-auto">
            <DockMarket :sector="sector" :trader="at" @traded="onTraded" />
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>
