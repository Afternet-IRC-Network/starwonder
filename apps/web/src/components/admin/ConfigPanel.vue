<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, type ConfigEntry } from '../../api';

const rows = ref<ConfigEntry[]>([]);
const edits = ref<Record<string, number>>({});
const busy = ref('');
const error = ref('');
const loaded = ref(false);

async function load(): Promise<void> {
  try {
    const res = await api.adminConfig();
    rows.value = res.config;
    edits.value = Object.fromEntries(res.config.map((c) => [c.key, c.value]));
    loaded.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function save(key: string): Promise<void> {
  if (busy.value) return;
  busy.value = key;
  error.value = '';
  try {
    const res = await api.setConfig(key, Number(edits.value[key]));
    rows.value = res.config;
    edits.value = Object.fromEntries(res.config.map((c) => [c.key, c.value]));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<template>
  <div class="max-w-2xl">
    <p class="text-sm text-muted mb-4 leading-relaxed">
      Live operational knobs. These persist across Big Bangs (they're operator settings, not
      part of the frozen world). A blank row uses its registry default.
    </p>

    <p v-if="error" class="text-bad text-sm mb-3">{{ error }}</p>

    <div v-if="loaded" class="border border-line rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-panel2 text-muted text-xs">
          <tr class="text-left">
            <th class="px-3 py-2 font-medium">Key</th>
            <th class="px-3 py-2 font-medium">Value</th>
            <th class="px-3 py-2 font-medium">Default</th>
            <th class="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in rows" :key="c.key" class="border-t border-line align-top">
            <td class="px-3 py-2">
              <div class="font-mono text-accent">{{ c.key }}</div>
              <div class="text-[11px] text-muted">{{ c.description }}</div>
            </td>
            <td class="px-3 py-2">
              <input
                type="number"
                :step="c.type === 'float' ? '0.01' : '1'"
                :value="edits[c.key]"
                @input="edits[c.key] = Number(($event.target as HTMLInputElement).value)"
                class="w-24 bg-panel2 border border-line rounded px-2 py-1 text-fg outline-none focus:border-accent"
              />
            </td>
            <td class="px-3 py-2 font-mono text-muted">{{ c.default }}</td>
            <td class="px-3 py-2 text-right">
              <button
                class="px-2.5 py-1 rounded border border-accent/50 text-accent text-xs disabled:opacity-40 hover:bg-accent/10"
                :disabled="busy === c.key || edits[c.key] === c.value"
                @click="save(c.key)"
              >{{ busy === c.key ? '…' : 'save' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
