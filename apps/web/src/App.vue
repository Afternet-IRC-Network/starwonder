<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { MeResponse } from '@starwonder/shared';
import { currentEnergy, DEFAULT_ENERGY } from '@starwonder/game-core';
import {
  api,
  onVersionChange,
  type SectorView,
  type UniverseInfo,
  type MapView,
  type PresenceMap,
  type IdleView,
  type LogEventView,
  type OrderResult,
} from './api';
import AdminBigBang from './controllers/AdminBigBang.vue';
import AdminExplorer from './controllers/AdminExplorer.vue';
import OrbitPanel from './components/game/OrbitPanel.vue';
import PilotScreen from './components/game/PilotScreen.vue';
import DockMarket from './components/game/DockMarket.vue';
import DockActivity from './components/game/DockActivity.vue';
import DockPanel from './components/game/DockPanel.vue';
import StarChart from './components/game/StarChart.vue';
import WarpLane from './components/game/WarpLane.vue';
import CaptainsLog from './components/game/CaptainsLog.vue';
import WhileAway from './components/game/WhileAway.vue';

// ── Version freshness ─────────────────────────────────────────────────────────
// The API layer flags when any response carries a newer server build stamp (a redeploy
// happened under this tab). Hidden tab → just reload; nobody's watching and they come
// back to a fresh page. Visible → a banner asks, so we never yank a screen mid-thought.
const updateReady = ref(false);
function reloadPage(): void {
  window.location.reload();
}
onVersionChange(() => {
  if (document.hidden) reloadPage();
  else updateReady.value = true;
});

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
  mapSelected.value = id;
  mapDetail.value = null;
  travelError.value = '';
  // A frontier "?" has no charted detail to fetch — just select it so a course can be plotted.
  if (isFrontier(id)) { mapDetailLoading.value = false; return; }
  // Tapping your own sector shows its world/station too — its detail is already loaded for
  // the Sector tab, so reuse it (no refetch, no "scanning" flash); the route block stays
  // hidden for the current sector, and the "Also here" roster is off on the map.
  if (id === at.value?.currentSector && sector.value) {
    mapDetail.value = sector.value;
    mapDetailLoading.value = false;
    return;
  }
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

const travelError = ref('');

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
  // Settle downtime + learn what happened while away (pops the sheet / badges the log).
  await pollIdle();
}

// ── Downtime: the poll, the unread badge, and the while-you-were-away sheet ──
// One mechanism covers every way of coming back: a fresh login, a restored tab, or a
// browser simply left open. Every ~60s (and immediately when the tab becomes visible)
// we settle server-side and diff the event feed against the last id this browser has
// seen (localStorage). Anything new pops the WhileAway sheet over whatever tab is open —
// unless you're already reading the log, or the dock modal is up. Dismissing marks seen.
const idleView = ref<IdleView | null>(null);
const logEvents = ref<LogEventView[] | null>(null);
const awayOpen = ref(false);

const seenKey = computed(() => (at.value ? `sw-seen-${at.value.id}` : ''));
const lastSeenId = ref(0);
watch(seenKey, (k) => { lastSeenId.value = k ? Number(localStorage.getItem(k) ?? 0) : 0; }, { immediate: true });

const unreadEvents = computed<LogEventView[]>(() =>
  (logEvents.value ?? []).filter((e) => e.id > lastSeenId.value),
);
const unreadCount = computed(() => unreadEvents.value.length);

function markSeen() {
  const maxId = Math.max(0, ...(logEvents.value ?? []).map((e) => e.id), lastSeenId.value);
  lastSeenId.value = maxId;
  if (seenKey.value) localStorage.setItem(seenKey.value, String(maxId));
}

let polling = false;
async function pollIdle(): Promise<void> {
  if (polling || view.value !== 'game' || !me.value?.activeTrader) return;
  polling = true;
  try {
    const [iv, lg] = await Promise.all([api.idle(), api.log()]);
    idleView.value = iv;
    logEvents.value = lg.events;
    const t = me.value?.activeTrader;
    if ((t && iv.currentSector !== t.currentSector) || unreadCount.value > 0) {
      // The autopilot moved us and/or downtime changed credits/cargo/energy — refresh
      // `me`; the currentSector watch below re-syncs the sector panel and the chart.
      const m = await api.me();
      if (m) me.value = m;
    }
    if (unreadCount.value > 0) {
      if (gameTab.value === 'log') markSeen(); // already reading it
      else if (!(docked.value && gameTab.value === 'sector')) awayOpen.value = true; // not over the dock screen
    }
  } catch { /* offline / no trader — try again next tick */ }
  polling = false;
}

let idleTimer: ReturnType<typeof setInterval> | null = null;
function onVisible(): void {
  if (!document.hidden) pollIdle(); // restored tab → catch up right away
}
onMounted(() => {
  idleTimer = setInterval(() => { if (!document.hidden) pollIdle(); }, 60_000);
  document.addEventListener('visibilitychange', onVisible);
});
onUnmounted(() => {
  if (idleTimer) clearInterval(idleTimer);
  document.removeEventListener('visibilitychange', onVisible);
});

function dismissAway(): void {
  awayOpen.value = false;
  markSeen();
}
function awayToLog(): void {
  awayOpen.value = false;
  markSeen();
  navigate('log');
}

// Opening the log refreshes + marks everything seen.
watch([gameTab, view], async ([tab, v]) => {
  if (v === 'game' && tab === 'log') {
    await pollIdle();
    markSeen();
  }
});

// A settle (goal change, course cancel) can hand back a fresh view and change credits.
async function onIdleSettled(fresh?: IdleView) {
  if (fresh) idleView.value = fresh;
  const m = await api.me();
  if (m) me.value = m;
  try { logEvents.value = (await api.log()).events; } catch { /* keep stale */ }
  markSeen();
}

// ── Plotted course (transit) ──────────────────────────────────────────────────
const inTransit = computed(() => idleView.value?.mode === 'transit');
// The remaining course, drawn on the chart whenever nothing else is selected.
const courseRemaining = computed<number[]>(() => {
  const c = idleView.value?.course;
  return c ? c.path.slice(c.leg) : [];
});
const chartRoute = computed<number[]>(() =>
  mapSelected.value != null ? routePath.value : courseRemaining.value,
);

const plottingCourse = ref(false);
// Discovery toast for course-flown arrivals: remembered here, fired by the position
// watch once the newly-charted sector's detail is actually on screen.
const pendingDiscovery = ref<number | null>(null);

// ONE travel mechanic: every journey is a course. The settle flies it greedily — as far
// as the banked energy pool allows *immediately*, then regen paces the rest — so a tap
// with a charged tank feels like an instant jump, and a broke tap just waits to depart.
async function setCourse(path: number[], discoverTarget: number | null = null) {
  if (plottingCourse.value) return;
  plottingCourse.value = true;
  travelError.value = '';
  moveError.value = '';
  try {
    const view = await api.setCourse(path);
    pendingDiscovery.value = discoverTarget;
    resetMapSelection(); // the course line takes over from the plotted-route line
    await onIdleSettled(view); // the burst may have moved us / robbed us — sync everything
  } catch (e) {
    travelError.value = (e as Error).message;
    moveError.value = (e as Error).message;
  }
  plottingCourse.value = false;
}

// A lane / known-wormhole tap on the sector screen = a 1-hop course. Instant when the
// drive can pay, "charging to jump" when it can't — never an error.
function jumpTo(dest: number, visited: boolean) {
  if (!at.value) return;
  setCourse([at.value.currentSector, dest], visited ? null : dest);
}

// How long a quoted route would spend charging en route, given the live pool.
const routeWaitMin = computed(() => {
  const r = route.value;
  if (!r || !at.value) return 0;
  const deficit = Math.max(0, r.energy - liveEnergy.value);
  return Math.ceil((deficit * (at.value.energyTickSeconds ?? 360)) / 60);
});

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
  pollIdle(); // the move re-anchored the downtime session — refresh the story state
}

// An order intent settled (place / scrub) — the burst may have moved credits, cargo AND
// energy. Patch the HUD, sync the personal prices, refresh the story, and mark our own
// fills seen (they shouldn't pop the while-away sheet later).
async function onOrder(res: OrderResult) {
  marketOpen.value = false; // errand sent (or called off) — back to the activity card
  const t = me.value?.activeTrader;
  if (t) {
    t.credits = res.trader.credits;
    t.ship = res.trader.ship;
    t.energy = res.trader.energy;
    t.energyCap = res.trader.energyCap;
    t.energyUpdatedAt = res.trader.energyUpdatedAt;
  }
  if (sector.value) sector.value.market = res.market;
  await pollIdle();
  markSeen();
}

// ── Docked state ─────────────────────────────────────────────────────────────────
// Docking is formal in the UI: while docked, the "sector" tab IS the dock tab — the
// dock-bay screen replaces the orbit view until you undock or set out.
const docking = ref(false);
const docked = computed(() => idleView.value?.mode === 'dock');

// Tapping the station card DOCKS you (an intent — you stay docked until you undock or
// set out); the sector tab flips to the dock screen either way.
async function openDock() {
  if (!sector.value?.station || docking.value) return;
  navigate('sector');
  if (docked.value) {
    pollIdle(); // settle the stay so standing/heat are current
    return;
  }
  docking.value = true;
  try {
    const view = await api.dock();
    await onIdleSettled(view);
  } catch { /* in transit / no station — the next poll sorts the UI out */ }
  docking.value = false;
}

// The market sheet — Buy & Sell is one activity among several, so the listings live
// behind a chip rather than on the tab itself. Closes itself when the dock ends.
const marketOpen = ref(false);
watch(docked, (d) => { if (!d) marketOpen.value = false; });

// Cast off: back to anchor in orbit. Scrubs any working order (leaving is leaving).
async function undock() {
  if (docking.value) return;
  docking.value = true;
  try {
    const view = await api.undock();
    await onIdleSettled(view);
  } catch { /* already at anchor */ }
  docking.value = false;
}

// Position is SERVER-authoritative — the autopilot can move the ship while any tab (or
// none) is open. Whatever updated `me` (a move, a poll, a goal save), this watch is the
// one place that re-syncs the sector panel and the chart to where the trader actually is.
watch(() => at.value?.currentSector, async (cur) => {
  if (cur == null || sector.value?.id === cur) return;
  try { sector.value = await api.sector(cur); } catch { /* keep stale — retried next poll */ }
  mapView.value = null; // fog may have grown — refetch lazily (or now, if we're looking at it)
  resetMapSelection();
  if (gameTab.value === 'map') {
    try { const m = await api.map(); mapView.value = m; mapPresence.value = m.presence; } catch { /* next open */ }
  }
  // A jump into the unknown landed and its detail is on screen — fire the charted toast.
  if (pendingDiscovery.value != null && sector.value?.id === pendingDiscovery.value) {
    announceDiscovery(sector.value);
    pendingDiscovery.value = null;
  }
});

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

// Conditions (measles!) stretch the regen clock — tick at the trader's effective rate.
const energyCfg = computed(() => ({
  cap: at.value?.energyCap ?? DEFAULT_ENERGY.cap,
  perTickSeconds: at.value?.energyTickSeconds ?? DEFAULT_ENERGY.perTickSeconds,
  amountPerTick: DEFAULT_ENERGY.amountPerTick,
}));
const regenSlowed = computed(
  () => (at.value?.energyTickSeconds ?? DEFAULT_ENERGY.perTickSeconds) > DEFAULT_ENERGY.perTickSeconds,
);
const liveEnergy = computed(() =>
  at.value
    ? currentEnergy({ value: at.value.energy, updatedAt: at.value.energyUpdatedAt }, energyCfg.value, now.value).value
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
  <!-- New build live — one tap to get off the stale bundle (hidden tabs reload themselves) -->
  <button
    v-if="updateReady"
    class="fixed top-0 inset-x-0 z-50 px-4 py-2 bg-accent text-bg text-xs font-bold text-center shadow-lg"
    @click="reloadPage"
  >
    ✦ StarWonder updated — tap to reload
  </button>

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

  <!-- ── Game ── fixed-height shell: main scrolls, the tab bar stays pinned -->
  <div v-else-if="view === 'game' && at" class="h-[100dvh] mx-auto max-w-md flex flex-col">

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
            <span>Energy<span v-if="regenSlowed" class="text-gold" title="A condition is slowing your recovery"> · slowed</span></span>
            <span>{{ liveEnergy }} / {{ at.energyCap }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-panel2 overflow-hidden">
            <div
              class="h-full transition-all duration-300"
              :class="regenSlowed ? 'bg-gold/70' : 'bg-accent'"
              :style="{ width: energyPct + '%' }"
            />
          </div>
        </div>
        <div class="text-right">
          <div class="text-[11px] text-muted">Credits</div>
          <div class="text-sm text-gold font-mono">{{ at.credits }}</div>
        </div>
      </div>
      <!-- Active conditions — hover for what they do and how they end -->
      <div v-if="at.conditions?.length" class="mt-2 flex flex-wrap gap-1.5">
        <span
          v-for="c in at.conditions"
          :key="c.id"
          :title="c.blurb"
          class="px-2 py-0.5 rounded-full border border-gold/50 bg-gold/10 text-gold text-[10px] font-semibold cursor-help"
        >{{ c.label }}</span>
      </div>
      <!-- Course banner — the autopilot is flying; tap for the story (cancel lives there) -->
      <button
        v-if="inTransit && idleView?.course"
        class="mt-2 w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border border-accent/50 bg-accent/10 text-left hover:bg-accent/20 transition-colors"
        @click="navigate('log')"
      >
        <span class="text-accent text-[11px] font-semibold truncate">
          ⟶ Under way to {{ idleView.course.destination.name }}
        </span>
        <span class="ml-auto text-[10px] text-muted flex-shrink-0">
          {{ idleView.course.hopsRemaining }} jump{{ idleView.course.hopsRemaining === 1 ? '' : 's' }} left
        </span>
      </button>
    </header>

    <main class="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">

      <!-- Sector tab — becomes the DOCK tab while berthed: the bay scene + marketplace
           replace the orbit view until you undock or set out -->
      <template v-if="gameTab === 'sector' && docked && sector?.station">
        <DockPanel
          :sector="sector"
          :vibe="idleView?.vibe"
          :standing="idleView?.standing"
          :heat="idleView?.heat"
          :ship-seed="at.name"
          :busy="docking"
          @undock="undock"
        />
        <!-- What you're up to on the docks — the working errand (or your goal), plus the
             things-to-do chips: Buy & Sell opens the market sheet, the rest set the goal -->
        <div>
          <div class="text-[10px] uppercase tracking-[2.5px] text-muted mb-1.5">Activity</div>
          <DockActivity
            :order="idleView?.order ?? null"
            :market="sector.market"
            :goal="idleView?.goal ?? null"
            :goal-kinds="idleView?.goalKinds ?? []"
            :events="logEvents"
            @order="onOrder"
            @settled="onIdleSettled"
            @market="marketOpen = true"
            @log="navigate('log')"
          />
        </div>
      </template>

      <!-- Sector tab -->
      <template v-else-if="gameTab === 'sector'">
        <div class="relative">
          <OrbitPanel v-if="sector" :sector="sector" dockable :docked="docked" @dock="openDock" />
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
            <!-- Lanes — a tap is a 1-hop course: instant when charged, queued when not -->
            <WarpLane
              v-for="lane in (sector.lanes ?? [])"
              :key="'l' + lane.id"
              :lane="lane"
              :disabled="moving || plottingCourse"
              @go="jumpTo(lane.id, lane.visited)"
            />
            <!-- Wormholes — known ones course through; blind jumps need energy NOW
                 (the autopilot won't fly into the unknown) -->
            <button
              v-for="(w, i) in sector.wormholeExits"
              :key="'w' + i"
              :disabled="moving || plottingCourse || (w.to == null && liveEnergy < w.cost)"
              class="flex-shrink-0 min-w-[108px] border rounded-xl p-3 text-left transition-colors disabled:opacity-40"
              style="background:#161226;border-color:#5a4a1e"
              @click="w.to != null ? jumpTo(w.to, true) : move({ wormhole: w.ref })"
            >
              <div class="font-bold text-sm text-gold truncate">
                <template v-if="w.planet">◌ {{ w.planet.name }}</template>
                <template v-else-if="w.to != null">◌ Deep space</template>
                <template v-else>◌ Uncharted</template>
              </div>
              <div class="text-[10px] text-muted mt-1 font-mono">
                <template v-if="w.to != null">#{{ w.to }} · {{ w.cost }} ⚡ wormhole</template>
                <template v-else>blind jump · {{ w.cost }} ⚡</template>
              </div>
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
          :route="chartRoute"
          :presence="mapPresence"
          @select="onMapSelect"
        />
        <div v-else class="h-[268px] rounded-2xl border border-line bg-[#070b14] grid place-items-center text-muted text-xs">
          loading map…
        </div>

        <!-- Selected sector — the shared sector view, shown only once you tap a world on the
             chart (the Map tab stays a map otherwise). The "Also here" roster is suppressed
             here; it lives on the Sector tab. -->
        <template v-if="mapView && mapSelected != null">
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
            <OrbitPanel :sector="panelSector" :dockable="panelSector.id === at.currentSector" :docked="docked" :show-roster="false" @dock="openDock" />
          </div>
          <div v-else-if="mapSelected != null && isFrontier(mapSelected)">
            <div class="text-[10px] uppercase tracking-[2px] text-muted mb-2 px-1">Unexplored</div>
            <div class="bg-panel border border-dashed border-line rounded-2xl p-5 text-center">
              <div class="text-2xl text-muted font-bold leading-none mb-2">?</div>
              <div class="text-sm font-semibold font-mono">Sector #{{ mapSelected }}</div>
              <p class="text-[11px] text-muted mt-1">Uncharted — plot a course and fly there to discover what's waiting.</p>
            </div>
          </div>

          <!-- Route to the selected sector — sibling of OrbitPanel, so it sits under "In orbit" -->
          <div v-if="mapSelected != null && mapSelected !== at.currentSector">
            <div class="text-[10px] uppercase tracking-[2.5px] text-muted mt-3 mb-1.5">Route</div>
            <template v-if="route">
              <div class="flex items-center gap-3 bg-panel border border-line rounded-xl px-3 py-2.5">
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold">
                    {{ route.hops }} hop{{ route.hops === 1 ? '' : 's' }} · {{ route.energy }} ⚡ ·
                    <template v-if="routeWaitMin === 0">flies now</template>
                    <template v-else>~{{ routeWaitMin }} min charging en route</template>
                  </div>
                  <div class="text-[11px] text-muted">
                    sprints as far as the tank allows, then regen paces the rest — things happen en route
                  </div>
                </div>
                <button
                  :disabled="plottingCourse"
                  class="flex-shrink-0 rounded-lg px-4 py-2 text-sm font-semibold bg-accent/15 border border-accent text-accent disabled:opacity-40 hover:bg-accent/25 transition-colors"
                  @click="route && setCourse(route.path)"
                >{{ plottingCourse ? 'plotting…' : 'Set course' }}</button>
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

      <!-- Log tab — the Captain's Log: current session, story, goal, and full history -->
      <template v-else-if="gameTab === 'log'">
        <CaptainsLog :view="idleView" :events="logEvents" @settled="onIdleSettled" />
      </template>

    </main>

    <nav class="border-t border-line grid grid-cols-4 flex-shrink-0">
      <button
        v-for="tab in GAME_TABS"
        :key="tab"
        :class="['relative py-3 text-[11px] capitalize transition-colors', gameTab === tab ? 'text-accent' : 'text-muted hover:text-fg']"
        @click="navigate(tab)"
      >
        {{ tab === 'sector' && docked ? 'dock' : tab }}
        <!-- "while you were away" badge -->
        <span
          v-if="tab === 'log' && unreadCount > 0"
          class="absolute top-1.5 ml-1 min-w-[16px] h-4 px-1 rounded-full bg-gold text-bg text-[9px] font-bold grid place-items-center leading-none"
        >{{ unreadCount }}</span>
      </button>
    </nav>

    <!-- ── Market sheet ── Buy & Sell, opened from the ACTIVITY chips while docked -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="marketOpen && docked && sector?.station"
        class="fixed inset-0 z-30 flex flex-col justify-end sm:justify-center bg-black/60 backdrop-blur-sm"
        @click.self="marketOpen = false"
      >
        <div class="mx-auto w-full max-w-md bg-bg border-t sm:border border-line rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[88vh] overflow-hidden shadow-2xl shadow-black/50">
          <header class="flex items-center gap-2.5 px-4 py-3 border-b border-line flex-shrink-0">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold truncate">Buy &amp; Sell</div>
              <div class="text-[11px] text-muted truncate">{{ sector.station.name }} marketplace</div>
            </div>
            <button
              class="w-8 h-8 -mr-1 grid place-items-center rounded-lg text-muted hover:text-fg hover:bg-panel2 transition-colors"
              aria-label="Close market"
              @click="marketOpen = false"
            >✕</button>
          </header>
          <div class="p-4 overflow-y-auto">
            <DockMarket :sector="sector" :trader="at" :order="idleView?.order ?? null" @order="onOrder" />
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── "While you were away" ── pops over any tab when the poll / a fresh login finds
         events newer than the last ones this browser saw; dismissing marks them seen -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <WhileAway
        v-if="awayOpen && idleView"
        :view="idleView"
        :events="unreadEvents"
        @close="dismissAway"
        @open-log="awayToLog"
        @settled="onIdleSettled"
      />
    </Transition>

  </div>
</template>
