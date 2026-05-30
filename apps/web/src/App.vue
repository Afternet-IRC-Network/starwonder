<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { MeResponse } from '@starwonder/shared';
import { api, type SectorView, type UniverseInfo } from './api';
import AdminBigBang from './controllers/AdminBigBang.vue';
import OrbitViewport from './components/game/OrbitViewport.vue';

// ── Auth state ────────────────────────────────────────────────────────────────
const me = ref<MeResponse | null>(null);
const sector = ref<SectorView | null>(null);
const universe = ref<UniverseInfo | null>(null);
const booting = ref(true);

// ── Hash router ───────────────────────────────────────────────────────────────
const GAME_TABS = ['star', 'map', 'dock', 'ship', 'log'] as const;
type GameTab = (typeof GAME_TABS)[number];
const AUTH_PAGES = ['login', 'register'] as const;
const ALL_PAGES = [...AUTH_PAGES, 'admin', ...GAME_TABS] as const;

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

// ── Derived state ─────────────────────────────────────────────────────────────
// Top-level view gated by auth (unchanged from before — hash doesn't affect gating)
const view = computed(() => {
  if (!me.value) return 'auth';
  if (me.value.isAdmin && !me.value.universeExists) return 'admin-setup';
  return 'game';
});

// Which auth form (login vs register) — driven by hash
const mode = computed(() => (hash.value === 'register' ? 'register' : 'login'));

// Active game tab — driven by hash, defaults to 'star'
const gameTab = computed<GameTab>(() =>
  (GAME_TABS as readonly string[]).includes(hash.value) ? (hash.value as GameTab) : 'star',
);

// ── Navigation sync ───────────────────────────────────────────────────────────
// After boot, keep the URL in sync with view transitions (login → game, etc.)
watch(view, (newView, oldView) => {
  if (booting.value) return;
  if (newView === 'auth' && !(AUTH_PAGES as readonly string[]).includes(hash.value)) {
    navigate('login');
  } else if (newView === 'admin-setup' && hash.value !== 'admin') {
    navigate('admin');
  } else if (newView === 'game' && oldView !== 'game') {
    // Preserve a valid game-tab hash if they refresh on e.g. #map, otherwise go to #star
    if (!(GAME_TABS as readonly string[]).includes(hash.value)) navigate('star');
  }
});

// ── Game data ─────────────────────────────────────────────────────────────────
async function loadGame() {
  if (!me.value) return;
  [universe.value, sector.value] = await Promise.all([
    api.universe(),
    api.sector(me.value.currentSector),
  ]);
}

async function jumpTo(id: number) {
  sector.value = await api.sector(id);
}

// ── Auth actions ──────────────────────────────────────────────────────────────
const handle = ref('');
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
        ? await api.register({ gate: gate.value, handle: handle.value, password: password.value })
        : await api.login({ handle: handle.value, password: password.value });
    // view watcher handles navigation; load game data if we landed in game view
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
  // view watcher navigates to #login
}

async function onBigBangDone() {
  me.value = await api.me();
  if (me.value) await loadGame();
  // view watcher navigates to #star
}

// ── Boot ──────────────────────────────────────────────────────────────────────
onMounted(async () => {
  me.value = await api.me();
  if (me.value && view.value === 'game') await loadGame();
  booting.value = false;

  // Set a valid initial hash based on auth state (respects existing valid hashes)
  if (view.value === 'auth') {
    if (!(AUTH_PAGES as readonly string[]).includes(hash.value)) navigate('login');
  } else if (view.value === 'admin-setup') {
    if (hash.value !== 'admin') navigate('admin');
  } else {
    if (!(GAME_TABS as readonly string[]).includes(hash.value)) navigate('star');
  }
});

// ── Misc ──────────────────────────────────────────────────────────────────────
const energyPct = computed(() =>
  me.value ? Math.round((me.value.energy / me.value.energyCap) * 100) : 0,
);

const tierLabel: Record<SectorView['dangerTier'], string> = {
  peaceful: 'Peaceful',
  medium: 'Medium',
  dangerous: 'Dangerous',
  'very-dangerous': 'Very dangerous',
};
const tierColor: Record<SectorView['dangerTier'], string> = {
  peaceful: 'text-good',
  medium: 'text-gold',
  dangerous: 'text-bad',
  'very-dangerous': 'text-bad',
};
</script>

<template>
  <!-- Boot splash -->
  <div v-if="booting" class="min-h-screen grid place-items-center text-muted text-sm">
    loading…
  </div>

  <!-- ── Auth ── centred card ─────────────────────────────────────────────── -->
  <div v-else-if="view === 'auth'" class="min-h-screen grid place-items-center p-4 bg-bg">
    <div class="w-full max-w-sm bg-panel border border-line rounded-2xl p-6">
      <h1 class="text-lg font-bold tracking-wide">StarWonder</h1>
      <p class="text-xs text-muted mt-1 mb-5">
        {{ mode === 'register'
          ? 'Create a pilot. You need the gate password to join.'
          : 'Welcome back, pilot.' }}
      </p>

      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <input
          v-model="handle"
          placeholder="callsign"
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
          {{ busy ? '…' : mode === 'register' ? 'Launch' : 'Log in' }}
        </button>
      </form>

      <p v-if="formError" class="text-bad text-xs mt-3">{{ formError }}</p>

      <button
        class="text-muted text-xs mt-4 underline hover:text-fg transition-colors"
        @click="navigate(mode === 'register' ? 'login' : 'register')"
      >
        {{ mode === 'register' ? 'Have an account? Log in' : 'New here? Create a pilot' }}
      </button>
    </div>
  </div>

  <!-- ── Admin setup ── full-width ────────────────────────────────────────── -->
  <AdminBigBang v-else-if="view === 'admin-setup'" @done="onBigBangDone" />

  <!-- ── Game ── phone-width layout ──────────────────────────────────────── -->
  <div v-else class="min-h-screen mx-auto max-w-md flex flex-col">

    <header class="px-4 pt-4 pb-3 border-b border-line flex-shrink-0">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-[11px] uppercase tracking-[2px] text-muted capitalize">
            {{ gameTab }} view
          </div>
          <div class="font-mono text-sm text-accent">{{ sector?.addr ?? '—' }}</div>
        </div>
        <button
          class="text-muted text-xs underline hover:text-fg transition-colors"
          @click="logout"
        >
          log out
        </button>
      </div>
      <div class="mt-3">
        <div class="flex justify-between text-[11px] text-muted mb-1">
          <span>Energy</span><span>{{ me!.energy }} / {{ me!.energyCap }}</span>
        </div>
        <div class="h-1.5 rounded-full bg-panel2 overflow-hidden">
          <div
            class="h-full bg-accent transition-all duration-300"
            :style="{ width: energyPct + '%' }"
          />
        </div>
      </div>
    </header>

    <main class="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">

      <!-- Star tab -->
      <template v-if="gameTab === 'star'">

        <!-- Orbit viewport -->
        <OrbitViewport v-if="sector" :sector="sector" />
        <div v-else class="h-[230px] rounded-2xl border border-line bg-[#080c16] grid place-items-center text-muted text-xs">
          loading…
        </div>

        <!-- Planet stats card -->
        <div v-if="sector?.planet" class="bg-panel border border-line rounded-xl px-4 py-3">
          <div class="text-[10px] uppercase tracking-[2px] text-muted mb-2">In orbit</div>
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-semibold capitalize">
                  {{ sector.id === 0 ? 'Earth' : sector.planet.palette + ' world' }}
                </span>
                <span
                  :class="[
                    'text-[10px] px-1.5 py-0.5 rounded-md border font-medium',
                    sector.planet.atmosphere === 'breathable' ? 'text-good  border-good/30  bg-good/10'  :
                    sector.planet.atmosphere === 'thick'      ? 'text-accent border-accent/30 bg-accent/10' :
                    sector.planet.atmosphere === 'thin'       ? 'text-muted  border-line      bg-panel2'  :
                    'text-bad border-bad/30 bg-bad/10',
                  ]"
                >
                  {{ sector.planet.atmosphere }}
                </span>
              </div>
              <div class="text-xs text-muted mt-1.5 font-mono space-x-3">
                <span>R {{ sector.planet.size }}</span>
                <span>{{ sector.planet.gravity }}g</span>
                <span>{{ sector.planet.dayHours }}h day</span>
                <span>{{ sector.planet.moons }} moon{{ sector.planet.moons === 1 ? '' : 's' }}</span>
              </div>
            </div>
            <div
              :class="[
                'text-[10px] px-2 py-1 rounded-lg border font-medium flex-shrink-0',
                sector.station?.stationType === 'haven'   ? 'text-accent border-accent/30 bg-accent/10' :
                sector.station?.stationType === 'outpost' ? 'text-gold   border-gold/30   bg-gold/10'   :
                'text-muted border-line bg-panel2',
              ]"
            >
              {{ sector.station?.stationType ?? 'no station' }}
            </div>
          </div>
        </div>

        <!-- Warp lanes — horizontal scroll, matching mockup card style -->
        <div v-if="sector">
          <div class="text-[10px] uppercase tracking-[2px] text-muted mb-2 px-1">Warp lanes</div>
          <div class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
            <button
              v-for="n in sector.neighbors"
              :key="n"
              class="flex-shrink-0 min-w-[108px] bg-panel2 border border-line rounded-xl p-3 text-left hover:border-accent transition-colors"
              @click="jumpTo(n)"
            >
              <div class="font-bold text-sm font-mono text-fg">#{{ n }}</div>
              <div class="text-[10px] text-muted mt-1">1 ⚡ · lane</div>
            </button>
            <button
              v-for="w in sector.wormholes"
              :key="w"
              class="flex-shrink-0 min-w-[108px] border rounded-xl p-3 text-left transition-colors"
              style="background:#161226;border-color:#5a4a1e"
              @click="jumpTo(w)"
            >
              <div class="font-bold text-sm font-mono text-gold">◌ #{{ w }}</div>
              <div class="text-[10px] text-muted mt-1">3 ⚡ · wormhole</div>
            </button>
            <div v-if="!sector.neighbors.length && !sector.wormholes.length"
              class="flex-shrink-0 min-w-[108px] bg-panel2 border border-dashed border-line rounded-xl p-3">
              <div class="text-sm text-muted">isolated</div>
              <div class="text-[10px] text-muted mt-1">no open lanes</div>
            </div>
          </div>
        </div>

        <p v-if="universe" class="text-center text-[11px] text-muted">
          universe "{{ universe.seed }}" · {{ universe.reachable }}/{{ universe.size }} sectors
        </p>
      </template>

      <!-- Other tabs — stubs -->
      <div v-else class="flex-1 grid place-items-center text-muted text-sm py-16">
        {{ gameTab }} · coming soon
      </div>

    </main>

    <!-- Tab bar -->
    <nav class="border-t border-line grid grid-cols-5 flex-shrink-0">
      <button
        v-for="tab in GAME_TABS"
        :key="tab"
        :class="[
          'py-3 text-[11px] capitalize transition-colors',
          gameTab === tab ? 'text-accent' : 'text-muted hover:text-fg',
        ]"
        @click="navigate(tab)"
      >
        {{ tab }}
      </button>
    </nav>

  </div>
</template>
