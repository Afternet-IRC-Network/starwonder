<script setup lang="ts">
import { ref } from 'vue';
import type { MeResponse } from '@starwonder/shared';
import { api } from '../../api';

const props = defineProps<{ me: MeResponse }>();
const emit = defineEmits<{ ready: [me: MeResponse]; logout: [] }>();

const name = ref('');
const busy = ref(false);
const error = ref('');

// Persona — tags steer the downtime dice (mechanics); the blurb feeds the AI narrator only.
const TRAIT_TAGS = ['lawful', 'shady', 'charming', 'gruff', 'cautious', 'reckless', 'lucky'] as const;
const tags = ref<string[]>([]);
const blurb = ref('');
function toggleTag(t: string): void {
  const i = tags.value.indexOf(t);
  if (i >= 0) tags.value.splice(i, 1);
  else if (tags.value.length < 3) tags.value.push(t);
}

async function select(id: number): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    emit('ready', await api.selectTrader(id));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function create(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    emit('ready', await api.createTrader(name.value, tags.value, blurb.value.trim()));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen grid place-items-center p-4 bg-bg">
    <div class="w-full max-w-sm bg-panel border border-line rounded-2xl p-6">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-bold tracking-wide">Choose your pilot</h1>
        <button class="text-muted text-xs underline hover:text-fg" @click="emit('logout')">log out</button>
      </div>
      <p class="text-xs text-muted mt-1 mb-5">
        Signed in as <span class="text-fg">{{ props.me.user.username }}</span>.
        Each pilot is a separate trader in the galaxy.
      </p>

      <!-- Existing pilots -->
      <div v-if="props.me.traders.length" class="flex flex-col gap-2 mb-5">
        <button
          v-for="t in props.me.traders"
          :key="t.id"
          :disabled="busy"
          class="flex items-center justify-between bg-panel2 border border-line rounded-xl px-3 py-2.5 text-left hover:border-accent transition-colors disabled:opacity-50"
          @click="select(t.id)"
        >
          <div>
            <div class="text-sm font-semibold">{{ t.name }}</div>
            <div class="text-[11px] text-muted">Sector #{{ t.currentSector }}</div>
          </div>
          <div class="text-xs text-gold font-mono">{{ t.credits }} cr</div>
        </button>
      </div>

      <!-- Create a new pilot -->
      <form class="flex flex-col gap-3" @submit.prevent="create">
        <div class="text-[10px] uppercase tracking-[2px] text-muted">New pilot</div>
        <input
          v-model="name"
          placeholder="pilot name"
          class="bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors"
        />

        <!-- Persona traits (up to 3) — these shape what happens to you at the docks -->
        <div>
          <div class="text-[10px] text-muted mb-1.5">Traits (pick up to 3 — they shape your dockside luck)</div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="t in TRAIT_TAGS"
              :key="t"
              type="button"
              :disabled="!tags.includes(t) && tags.length >= 3"
              class="px-2.5 py-1 rounded-full border text-[11px] transition-colors disabled:opacity-30"
              :class="tags.includes(t)
                ? 'border-accent bg-accent/15 text-accent font-semibold'
                : 'border-line bg-panel2 text-muted hover:text-fg'"
              @click="toggleTag(t)"
            >{{ t }}</button>
          </div>
        </div>
        <input
          v-model="blurb"
          maxlength="200"
          placeholder="who are they? (one line, for the story)"
          class="bg-panel2 border border-line rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent transition-colors"
        />

        <button
          :disabled="busy || name.trim().length < 2"
          class="bg-accent/15 border border-accent text-accent rounded-lg px-3 py-2 font-semibold text-sm disabled:opacity-50 hover:bg-accent/25 transition-colors"
        >
          {{ busy ? '…' : 'Launch new pilot' }}
        </button>
      </form>

      <p v-if="error" class="text-bad text-xs mt-3">{{ error }}</p>
    </div>
  </div>
</template>
