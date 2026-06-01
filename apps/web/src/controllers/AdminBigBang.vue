<script setup lang="ts">
import { ref, computed } from 'vue';
import { generateGalaxy, withDefaults, SIDE, N, type Galaxy } from '@starwonder/game-core';
import Panel from '../components/ui/Panel.vue';
import SectionLabel from '../components/ui/SectionLabel.vue';
import Button from '../components/ui/Button.vue';
import GalaxyMap from '../components/admin-big-bang/GalaxyMap.vue';
import GenerationControls from '../components/admin-big-bang/GenerationControls.vue';
import ConnectivityStats from '../components/admin-big-bang/ConnectivityStats.vue';
import type { GalaxyStats } from '../components/admin-big-bang/types';
import { api } from '../api';

const props = defineProps<{ universeExists?: boolean; embedded?: boolean }>();
const emit = defineEmits<{ done: []; cleared: [] }>();

// Two-phase when a universe already exists: you must CLEAR it before you can generate.
// `gated` = a universe is live and hasn't been cleared yet → generation controls locked.
const cleared = ref(false);
const confirming = ref(false); // two-step gate on the destructive clear
const gated = computed(() => !!props.universeExists && !cleared.value);

// --- Settings ---
const seed = ref('aurora');
const starVal = ref(47);
const laneVal = ref(44);
const biasVal = ref(89);
const habitVal = ref(35);
const whVal = ref(50);
const showBlocked = ref(true);
const showWormholes = ref(true);
const showGradient = ref(true);

// --- Galaxy ---
const galaxy = computed<Galaxy>(() =>
  generateGalaxy(
    withDefaults(seed.value, {
      inhabitedProb: starVal.value / 100,
      laneP: laneVal.value / 100,
      coreBias: biasVal.value / 100,
      habitationFalloff: habitVal.value / 100,
      wormholeCount: whVal.value,
    }),
  ),
);

// --- Stats ---
const stats = computed<GalaxyStats>(() => {
  const g = galaxy.value;
  const lay = g.layout;

  const whKeys = new Set(g.wormholes.map((w) => `${Math.min(w.a, w.b)}-${Math.max(w.a, w.b)}`));
  let openLanes = 0;
  let potentialLanes = 0;

  for (let d = 0; d < N; d++) {
    const { x, y } = lay.xy[d];
    for (const [dx, dy] of [[1, 0], [0, 1]] as [number, number][]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= SIDE || ny >= SIDE) continue;
      potentialLanes++;
      const nd = lay.d[ny * SIDE + nx];
      const key = `${Math.min(d, nd)}-${Math.max(d, nd)}`;
      if (g.adj[d].includes(nd) && !whKeys.has(key)) openLanes++;
    }
  }

  // Union-find for component analysis over all 1024 sectors
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  for (let d = 0; d < N; d++) for (const nd of g.adj[d]) parent[find(d)] = find(nd);

  const sizes = new Map<number, number>();
  for (let d = 0; d < N; d++) {
    const r = find(d);
    sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  const sizeArr = [...sizes.values()].sort((a, b) => b - a);

  let iso = 0;
  for (let d = 0; d < N; d++) if (g.adj[d].length === 0) iso++;

  let reachableStars = 0;
  for (let d = 0; d < N; d++) if (g.dist[d] >= 0 && g.inhabited[d]) reachableStars++;

  const solPct = (100 * g.reachable) / N;
  const largest = sizeArr[0] ?? 0;

  return {
    reachable: g.reachable,
    solPct,
    reachableStars,
    openLanes,
    potentialLanes,
    avgDeg: ((openLanes * 2) / N).toFixed(2),
    components: sizes.size,
    largest,
    largestPct: (100 * largest) / N,
    stranded: N - largest,
    isolated: iso,
  };
});

// --- Seed finder ---
const finding = ref(false);

async function findSeed() {
  if (finding.value) return;
  finding.value = true;
  await new Promise((r) => setTimeout(r, 0)); // yield to let UI update
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rng = () => chars[Math.floor(Math.random() * chars.length)];
  for (let i = 0; i < 400; i++) {
    const s = Array.from({ length: 6 }, rng).join('');
    const g = generateGalaxy(
      withDefaults(s, {
        inhabitedProb: starVal.value / 100,
        laneP: laneVal.value / 100,
        coreBias: biasVal.value / 100,
        habitationFalloff: habitVal.value / 100,
        wormholeCount: whVal.value,
      }),
    );
    if (g.reachable >= N * 0.9) {
      seed.value = s;
      break;
    }
  }
  finding.value = false;
}

// --- Big Bang ---
const busy = ref(false);
const error = ref('');

// Phase 1: delete the live universe (and reset players). Unlocks the generation controls.
async function doClear() {
  error.value = '';
  busy.value = true;
  try {
    await api.clearUniverse();
    cleared.value = true;
    confirming.value = false;
    emit('cleared');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function doBigBang() {
  error.value = '';
  busy.value = true;
  try {
    await api.bigBang({
      seed: seed.value,
      inhabitedProb: starVal.value / 100,
      laneP: laneVal.value / 100,
      coreBias: biasVal.value / 100,
      habitationFalloff: habitVal.value / 100,
      wormholeCount: whVal.value,
    });
    emit('done');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div :class="props.embedded ? '' : 'min-h-screen p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto'">

    <!-- Header (standalone page only — when embedded, the host provides chrome) -->
    <header v-if="!props.embedded" class="mb-6">
      <div class="flex items-center justify-between">
        <div class="text-[10px] font-semibold uppercase tracking-[2px] text-muted">Admin · Universe Setup</div>
      </div>
      <h1 class="text-2xl font-bold tracking-tight mt-1">The Big Bang</h1>
      <p class="text-sm text-muted mt-1.5 max-w-xl leading-relaxed">
        Tune the galaxy physics below. Aim for ≥ 90% reachable from Sol before creating the universe.
        Sectors that can't be reached from Sol don't exist — blank on the map.
      </p>
    </header>

    <!--
      Two-column on lg+: map on left, controls on right.
      Single column on mobile: controls first (more useful), map below.
    -->
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">

      <!-- Map / clear-gate — left on desktop (order-1), below on mobile (order-2) -->
      <div class="order-2 lg:order-1">
        <!-- Phase 1: a universe is live — generation is gated behind clearing it -->
        <div
          v-if="gated"
          class="aspect-square w-full border border-dashed border-line rounded-2xl bg-panel/40 grid place-items-center text-center p-8"
        >
          <div class="max-w-xs">
            <div class="text-sm font-semibold mb-1">A universe is live</div>
            <p class="text-xs text-muted leading-relaxed mb-5">
              Clear it before generating a new one. This
              <span class="text-bad font-medium">deletes the galaxy</span> and resets
              <em>every</em> player to a fresh start — back to Sol, 1000 credits, full
              energy. Handles and passwords are kept. Cannot be undone.
            </p>

            <Button v-if="!confirming" variant="danger" :disabled="busy" @click="confirming = true">
              ⟲ Clear the world
            </Button>
            <div v-else class="flex flex-col gap-2">
              <p class="text-bad text-xs font-medium">Delete the universe and reset all players?</p>
              <div class="flex gap-2 justify-center">
                <Button variant="danger" :disabled="busy" @click="doClear">
                  {{ busy ? 'Clearing…' : 'Yes, delete it' }}
                </Button>
                <Button variant="secondary" :disabled="busy" @click="confirming = false">
                  Cancel
                </Button>
              </div>
            </div>
            <p v-if="error" class="text-bad text-xs mt-3">{{ error }}</p>
          </div>
        </div>

        <!-- Phase 2: no universe (or just cleared) — live preview of what we'll build -->
        <GalaxyMap
          v-else
          :galaxy="galaxy"
          :show-blocked="showBlocked"
          :show-wormholes="showWormholes"
          :show-gradient="showGradient"
        />
      </div>

      <!-- Controls column — locked until the world is cleared -->
      <div
        class="order-1 lg:order-2 flex flex-col gap-4 transition-opacity"
        :class="gated ? 'opacity-50 pointer-events-none select-none' : ''"
        :aria-disabled="gated"
      >

        <!-- Generation controls -->
        <Panel>
          <SectionLabel>Generation</SectionLabel>
          <GenerationControls
            v-model:seed="seed"
            v-model:star-val="starVal"
            v-model:lane-val="laneVal"
            v-model:bias-val="biasVal"
            v-model:habit-val="habitVal"
            v-model:wh-val="whVal"
            v-model:show-blocked="showBlocked"
            v-model:show-wormholes="showWormholes"
            v-model:show-gradient="showGradient"
            :finding="finding"
            @find-seed="findSeed"
          />
        </Panel>

        <!-- Connectivity stats -->
        <Panel>
          <SectionLabel>Connectivity</SectionLabel>
          <ConnectivityStats :stats="stats" />
        </Panel>

        <!-- Create action -->
        <Panel>
          <p class="text-xs text-muted mb-3 leading-relaxed">
            Creates the universe from the current settings, establishes Sol as the home
            system, and opens the galaxy to players.
            <span v-if="stats.solPct < 90" class="text-gold">
              Connectivity is below 90% — consider using 🎲 to find a better seed.
            </span>
          </p>
          <Button variant="primary" class="w-full" :disabled="busy || gated" @click="doBigBang">
            {{ busy ? 'Creating universe…' : '✦ Create Universe' }}
          </Button>
          <p v-if="error && !gated" class="text-bad text-xs mt-2">{{ error }}</p>
        </Panel>

      </div>
    </div>
  </div>
</template>
