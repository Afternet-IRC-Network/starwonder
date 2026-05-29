<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { MeResponse } from '@starwonder/shared';
import { api, type SectorView, type UniverseInfo } from './api';

const me = ref<MeResponse | null>(null);
const sector = ref<SectorView | null>(null);
const universe = ref<UniverseInfo | null>(null);
const booting = ref(true);

// auth form
const mode = ref<'login' | 'register'>('register');
const handle = ref('');
const password = ref('');
const gate = ref('');
const error = ref('');
const busy = ref(false);

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

async function loadGame() {
  if (!me.value) return;
  [universe.value, sector.value] = await Promise.all([
    api.universe(),
    api.sector(me.value.currentSector),
  ]);
}

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    me.value =
      mode.value === 'register'
        ? await api.register({ gate: gate.value, handle: handle.value, password: password.value })
        : await api.login({ handle: handle.value, password: password.value });
    await loadGame();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function logout() {
  await api.logout();
  me.value = null;
  sector.value = null;
}

async function jumpTo(id: number) {
  // placeholder navigation: just inspect the neighbour (Move/energy spend lands in Phase 4)
  sector.value = await api.sector(id);
}

onMounted(async () => {
  me.value = await api.me();
  if (me.value) await loadGame();
  booting.value = false;
});
</script>

<template>
  <div class="min-h-full mx-auto max-w-md flex flex-col">
    <div v-if="booting" class="flex-1 grid place-items-center text-muted">loading…</div>

    <!-- AUTH -->
    <div v-else-if="!me" class="flex-1 grid place-items-center p-6">
      <div class="w-full bg-panel border border-line rounded-2xl p-6">
        <h1 class="text-lg font-bold tracking-wide">StarWonder</h1>
        <p class="text-xs text-muted mt-1 mb-5">
          {{ mode === 'register' ? 'Create a pilot. You need the gate password to join.' : 'Welcome back, pilot.' }}
        </p>

        <form class="flex flex-col gap-3" @submit.prevent="submit">
          <input
            v-model="handle"
            placeholder="callsign"
            autocomplete="username"
            class="bg-panel2 border border-line rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
          />
          <input
            v-model="password"
            type="password"
            placeholder="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            class="bg-panel2 border border-line rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
          />
          <input
            v-if="mode === 'register'"
            v-model="gate"
            placeholder="gate password"
            class="bg-panel2 border border-line rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
          />
          <button
            :disabled="busy"
            class="bg-accent/15 border border-accent text-accent rounded-lg px-3 py-2 font-semibold disabled:opacity-50"
          >
            {{ busy ? '…' : mode === 'register' ? 'Launch' : 'Log in' }}
          </button>
        </form>

        <p v-if="error" class="text-bad text-xs mt-3">{{ error }}</p>

        <button
          class="text-muted text-xs mt-4 underline"
          @click="mode = mode === 'register' ? 'login' : 'register'"
        >
          {{ mode === 'register' ? 'Have an account? Log in' : 'New here? Create a pilot' }}
        </button>
      </div>
    </div>

    <!-- GAME -->
    <template v-else>
      <header class="px-4 pt-4 pb-3 border-b border-line">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[11px] uppercase tracking-[2px] text-muted">Star view</div>
            <div class="font-mono text-sm text-accent">{{ sector?.addr ?? '—' }}</div>
          </div>
          <button class="text-muted text-xs underline" @click="logout">log out</button>
        </div>
        <div class="mt-3">
          <div class="flex justify-between text-[11px] text-muted mb-1">
            <span>Energy</span><span>{{ me.energy }} / {{ me.energyCap }}</span>
          </div>
          <div class="h-2 rounded-full bg-panel2 overflow-hidden">
            <div class="h-full bg-accent" :style="{ width: energyPct + '%' }"></div>
          </div>
        </div>
      </header>

      <main class="flex-1 p-4 flex flex-col gap-4">
        <section class="bg-panel border border-line rounded-2xl p-4">
          <div class="aspect-square rounded-xl bg-panel2 border border-line grid place-items-center text-muted text-xs mb-4">
            orbit viewport — procedural planet next
          </div>

          <div v-if="sector" class="text-sm space-y-1">
            <div>
              <span v-if="sector.id === 0" class="text-gold font-bold">★ Sol — home system</span>
              <span v-else-if="sector.inhabited" class="text-good">★ Inhabited system</span>
              <span v-else class="text-muted">Uninhabited · deep-space waypoint</span>
            </div>
            <div :class="tierColor[sector.dangerTier]">
              ⚠ {{ tierLabel[sector.dangerTier] }}
              <span class="text-muted">· {{ Math.round(sector.danger * 100) }}% danger · {{ Math.round(sector.rimT * 100) }}% to rim</span>
            </div>
            <div class="text-muted">
              {{ sector.jumpsFromSol === 0 ? 'home' : sector.jumpsFromSol + ' jump' + (sector.jumpsFromSol === 1 ? '' : 's') + ' from Sol' }}
              · {{ sector.neighbors.length }} lane{{ sector.neighbors.length === 1 ? '' : 's' }}
            </div>
          </div>
        </section>

        <section v-if="sector" class="bg-panel border border-line rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-[2px] text-muted mb-3">Warp lanes</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="n in sector.neighbors"
              :key="n"
              class="font-mono text-xs bg-panel2 border border-line rounded-lg px-3 py-2 hover:border-accent"
              @click="jumpTo(n)"
            >
              #{{ n }}
            </button>
            <span v-if="!sector.neighbors.length" class="text-muted text-xs">no open lanes</span>
          </div>
          <div v-if="sector.wormholes.length" class="mt-3">
            <div class="text-[11px] uppercase tracking-[2px] text-muted mb-2">Wormholes</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="w in sector.wormholes"
                :key="w"
                class="font-mono text-xs bg-gold/10 border border-gold/40 text-gold rounded-lg px-3 py-2"
                @click="jumpTo(w)"
              >
                ◍ #{{ w }}
              </button>
            </div>
          </div>
        </section>

        <p v-if="universe" class="text-center text-[11px] text-muted">
          universe “{{ universe.seed }}” · {{ universe.reachable }}/{{ universe.size }} sectors exist
        </p>
      </main>

      <nav class="border-t border-line grid grid-cols-5 text-center text-[11px] text-muted">
        <div class="py-3 text-accent">Star</div>
        <div class="py-3">Map</div>
        <div class="py-3">Dock</div>
        <div class="py-3">Ship</div>
        <div class="py-3">Log</div>
      </nav>
    </template>
  </div>
</template>
