<script setup lang="ts">
import { computed } from 'vue';
import StatRow from '../ui/StatRow.vue';
import type { GalaxyStats } from './types';

const props = defineProps<{ stats: GalaxyStats }>();

const solStatus = computed(() =>
  props.stats.solPct >= 90 ? 'good' : props.stats.solPct >= 75 ? 'warn' : 'bad',
);
const compStatus = computed(() =>
  props.stats.components <= 3 ? 'good' : props.stats.components <= 10 ? 'warn' : 'bad',
);
const largestStatus = computed(() =>
  props.stats.largestPct >= 92 ? 'good' : props.stats.largestPct >= 75 ? 'warn' : 'bad',
);
const isoStatus = computed(() =>
  props.stats.isolated === 0 ? 'good' : props.stats.isolated < 10 ? 'warn' : 'bad',
);
</script>

<template>
  <div>
    <StatRow
      label="Sectors / stars"
      :value="`${stats.reachable} / ${stats.reachableStars}`"
    />
    <StatRow
      label="Reachable from Sol"
      :value="`${stats.reachable} (${stats.solPct.toFixed(1)}%)`"
      :status="solStatus"
    />
    <StatRow
      label="Open / potential lanes"
      :value="`${stats.openLanes} / ${stats.potentialLanes}`"
    />
    <StatRow
      label="Avg degree"
      :value="stats.avgDeg"
    />
    <StatRow
      label="Components"
      :value="stats.components"
      :status="compStatus"
    />
    <StatRow
      label="Largest reachable"
      :value="`${stats.largest} (${stats.largestPct.toFixed(1)}%)`"
      :status="largestStatus"
    />
    <StatRow
      label="Stranded"
      :value="stats.stranded"
    />
    <StatRow
      label="Fully isolated"
      :value="stats.isolated"
      :status="isoStatus"
    />
  </div>
</template>
