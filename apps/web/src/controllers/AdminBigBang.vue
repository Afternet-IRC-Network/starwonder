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

const emit = defineEmits<{ done: [] }>();

// --- Settings ---
const seed = ref('aurora');
const starVal = ref(47);
const laneVal = ref(44);
const biasVal = ref(89);
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

async function doBigBang() {
  error.value = '';
  busy.value = true;
  try {
    await api.bigBang({
      seed: seed.value,
      inhabitedProb: starVal.value / 100,
      laneP: laneVal.value / 100,
      coreBias: biasVal.value / 100,
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
  <div class="min-h-screen p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">

    <!-- Header -->
    <header class="mb-6">
      <div class="text-[10px] font-semibold uppercase tracking-[2px] text-muted">Admin · Universe Setup</div>
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

      <!-- Map — right on desktop (order-1), below on mobile (order-2) -->
      <div class="order-2 lg:order-1">
        <GalaxyMap
          :galaxy="galaxy"
          :show-blocked="showBlocked"
          :show-wormholes="showWormholes"
          :show-gradient="showGradient"
        />
      </div>

      <!-- Controls column — left on desktop (order-2), top on mobile (order-1) -->
      <div class="order-1 lg:order-2 flex flex-col gap-4">

        <!-- Generation controls -->
        <Panel>
          <SectionLabel>Generation</SectionLabel>
          <GenerationControls
            v-model:seed="seed"
            v-model:star-val="starVal"
            v-model:lane-val="laneVal"
            v-model:bias-val="biasVal"
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

        <!-- Big Bang action -->
        <Panel>
          <p class="text-xs text-muted mb-3 leading-relaxed">
            Creates the universe from the current settings, establishes Sol as the home system,
            and opens the galaxy to players.
            <span v-if="stats.solPct < 90" class="text-gold">
              Connectivity is below 90% — consider using 🎲 to find a better seed.
            </span>
          </p>
          <Button variant="primary" class="w-full" :disabled="busy" @click="doBigBang">
            {{ busy ? 'Creating universe…' : '✦ Create Universe' }}
          </Button>
          <p v-if="error" class="text-bad text-xs mt-2">{{ error }}</p>
        </Panel>

      </div>
    </div>
  </div>
</template>
