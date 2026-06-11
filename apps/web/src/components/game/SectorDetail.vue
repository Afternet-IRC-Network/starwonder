<script setup lang="ts">
import { computed } from 'vue';
import type { SectorView } from '../../api';
import OrbitPanel from './OrbitPanel.vue';

const props = defineProps<{ sector: SectorView | null; loading?: boolean }>();

const tierLabel: Record<SectorView['dangerTier'], string> = {
  peaceful: 'Peaceful',
  medium: 'Medium',
  dangerous: 'Dangerous',
  'very-dangerous': 'Very dangerous',
};
const tierColor: Record<SectorView['dangerTier'], string> = {
  peaceful: 'text-good border-good/30 bg-good/10',
  medium: 'text-gold border-gold/30 bg-gold/10',
  dangerous: 'text-bad border-bad/30 bg-bad/10',
  'very-dangerous': 'text-bad border-bad/30 bg-bad/10',
};

const s = computed(() => props.sector);
</script>

<template>
  <div class="bg-panel border border-line rounded-2xl p-4">
    <!-- Empty / loading state -->
    <div v-if="!s" class="h-[260px] grid place-items-center text-center text-muted text-xs">
      {{ loading ? 'loading sector…' : 'Click a sector to inspect it' }}
    </div>

    <template v-else>
      <!-- Admin context: which sector + danger tier -->
      <div class="flex items-center justify-between mb-3">
        <div>
          <div class="text-[10px] uppercase tracking-[2px] text-muted">Sector</div>
          <div class="font-mono text-sm text-accent">{{ s.addr }}</div>
        </div>
        <span
          :class="['text-[10px] px-1.5 py-0.5 rounded-md border font-medium', tierColor[s.dangerTier]]"
        >
          {{ tierLabel[s.dangerTier] }}
        </span>
      </div>

      <!-- The exact same screen players see in #sector -->
      <OrbitPanel :sector="s" />

      <!-- Footer facts — admin debug detail -->
      <div class="mt-4 grid grid-cols-2 gap-y-1 text-[11px] text-muted font-mono">
        <span>sector #{{ s.id }}</span>
        <span class="text-right">{{ s.jumpsFromSol }} jump{{ s.jumpsFromSol === 1 ? '' : 's' }} from Sol</span>
        <span>grid {{ s.x }},{{ s.y }}</span>
        <span class="text-right">{{ s.neighbors.length }} lane{{ s.neighbors.length === 1 ? '' : 's' }}<template v-if="s.wormholeExits.length"> · {{ s.wormholeExits.length }} ◊</template></span>
      </div>
    </template>
  </div>
</template>
