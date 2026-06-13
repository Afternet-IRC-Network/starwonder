<script setup lang="ts">
/**
 * Voxel/pixel dock-bay viewport — the interior counterpart to OrbitViewport, shown while
 * docked. Everything is a pure function of (sector, station): a bay window looking out at
 * the host world, girders and wall panels in the station's hue, a landing pad with the
 * trader's own ship parked on it, crates, a gantry crane, a few dockworkers, and blinking
 * approach lights. Drawn at low native resolution and CSS-upscaled (pixelated) for the
 * same chunky look as the planet renderer.
 *
 * Overlays mirror OrbitViewport: station name top-left, station type top-right, and the
 * station's current vibe along the bottom.
 */
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { SectorView } from '../../api';
import { hashStr, mulberry32, planetSprite } from './planet';
import { drawShip, shipHue } from './ship';

const props = defineProps<{ sector: SectorView; vibe?: string | null; shipSeed?: string }>();

const STATION_DESC: Record<string, string> = {
  trade: 'Trade hub',
  haven: 'Safe haven',
  outpost: 'Frontier outpost',
};

// Native scene resolution — kept small on purpose; the container stretches it pixelated.
const W = 210;
const H = 118;
const CEIL = 8;   // ceiling beam ends
const SILL = 60;  // bay-window sill
const WALL = 80;  // wall/floor boundary

interface Light { x: number; y: number; on: string; off: string; period: number; phase: number }

const cvRef = ref<HTMLCanvasElement | null>(null);
let raf: number | null = null;

// Paint the static bay once; the rAF loop just blits it and animates the lights on top.
function paintStatic(): { scene: HTMLCanvasElement; lights: Light[] } | null {
  const s = props.sector.station;
  if (!s) return null;
  const rng = mulberry32(hashStr(`${props.sector.id}|dock`));
  const scene = document.createElement('canvas');
  scene.width = W;
  scene.height = H;
  const ctx = scene.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const sat = Math.round(Math.min(60, s.sat * 100 + 12));
  const tint = (l: number): string => `hsl(${s.hue} ${sat}% ${l}%)`;
  const lights: Light[] = [];

  // ── Space through the bay window ──
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, W, SILL);
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = 0.25 + rng() * 0.65;
    ctx.fillStyle = '#bcd6ff';
    ctx.fillRect((rng() * W) | 0, CEIL + ((rng() * (SILL - CEIL)) | 0), 1, 1);
  }
  ctx.globalAlpha = 1;
  const planet = props.sector.planet;
  if (planet) {
    // The world you're berthed above, hanging outside the glass (clipped to the panes).
    const ps = 40 + ((rng() * 14) | 0);
    const px = (16 + rng() * (W - ps - 32)) | 0;
    const py = (CEIL + 2 + rng() * (SILL - CEIL - ps * 0.55)) | 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, CEIL, W, SILL - CEIL);
    ctx.clip();
    ctx.drawImage(planetSprite(props.sector.addr, planet.palette, ps, planet.spin), px, py);
    ctx.restore();
  }

  // ── Window frame: ceiling beam, sill, strut mullions ──
  ctx.fillStyle = tint(13);
  ctx.fillRect(0, 0, W, CEIL);
  ctx.fillRect(0, SILL, W, 4);
  ctx.fillStyle = tint(20);
  ctx.fillRect(0, CEIL - 1, W, 1);
  ctx.fillRect(0, SILL, W, 1);
  ctx.fillStyle = tint(24);
  for (let x = 6; x < W; x += 12) ctx.fillRect(x, 3, 1, 1); // rivets
  const panes = 5 + ((rng() * 2) | 0);
  for (let i = 0; i <= panes; i++) {
    const x = Math.round((i * (W - 3)) / panes);
    ctx.fillStyle = tint(12);
    ctx.fillRect(x, CEIL, 3, SILL - CEIL);
    ctx.fillStyle = tint(20);
    ctx.fillRect(x, CEIL, 1, SILL - CEIL);
  }
  for (let x = 8; x < W; x += 28) {
    lights.push({ x, y: SILL + 2, on: `hsl(${s.hue} 70% 65%)`, off: tint(16), period: 3.2, phase: rng() * 6 });
  }

  // ── Back wall: panels, a crew door, a lit signboard, vents ──
  ctx.fillStyle = tint(10);
  ctx.fillRect(0, SILL + 4, W, WALL - SILL - 4);
  ctx.fillStyle = tint(7);
  for (let x = 10 + ((rng() * 8) | 0); x < W; x += 26) ctx.fillRect(x, SILL + 4, 1, WALL - SILL - 4);
  const doorX = 16 + ((rng() * 50) | 0);
  ctx.fillStyle = tint(16);
  ctx.fillRect(doorX, SILL + 6, 13, WALL - SILL - 6);
  ctx.fillStyle = tint(6);
  ctx.fillRect(doorX + 6, SILL + 6, 1, WALL - SILL - 6);
  const signX = doorX + 20 + ((rng() * 30) | 0);
  ctx.fillStyle = `hsl(${s.hue} 60% 18%)`;
  ctx.fillRect(signX, SILL + 7, 18, 6);
  ctx.fillStyle = `hsl(${s.hue} 80% 62%)`;
  for (let x = signX + 2; x < signX + 16; x += 3) ctx.fillRect(x, SILL + 9, 2, 1);
  ctx.fillStyle = tint(5);
  for (let i = 0; i < 3; i++) ctx.fillRect(W - 30 + ((rng() * 12) | 0), SILL + 8 + i * 3, 10, 1); // vents

  // ── Floor: deck plates ──
  ctx.fillStyle = tint(15);
  ctx.fillRect(0, WALL, W, H - WALL);
  ctx.fillStyle = tint(5);
  ctx.fillRect(0, WALL, W, 1);
  ctx.fillStyle = tint(11);
  for (const y of [WALL + 8, WALL + 18, WALL + 30]) ctx.fillRect(0, y, W, 1);
  for (let i = 0; i < 9; i++) ctx.fillRect(8 + ((rng() * (W - 16)) | 0), WALL + 2 + ((rng() * (H - WALL - 4)) | 0), 1, 4);

  // ── Landing pad + the trader's own ship ──
  const padW = 70;
  const padH = 24;
  const padX = Math.round(W * (0.42 + rng() * 0.2)); // centre
  const padY = WALL + 8;
  ctx.fillStyle = tint(20);
  ctx.fillRect(padX - padW / 2, padY, padW, padH);
  ctx.fillStyle = tint(26);
  ctx.fillRect(padX - padW / 2, padY, padW, 1);
  ctx.strokeStyle = tint(30);
  ctx.strokeRect(padX - padW / 2 + 8.5, padY + 4.5, padW - 16, padH - 10);
  for (let x = padX - padW / 2; x < padX + padW / 2; x += 4) {
    ctx.fillStyle = (((x / 4) | 0) % 2 === 0) ? 'hsl(45 75% 52%)' : '#191307';
    ctx.fillRect(x, padY + padH - 2, Math.min(4, padX + padW / 2 - x), 2);
  }
  const nPad = 6;
  for (let i = 0; i < nPad; i++) {
    lights.push({
      x: Math.round(padX - padW / 2 + (i + 0.5) * (padW / nPad)),
      y: padY + padH + 2,
      on: 'hsl(45 90% 62%)',
      off: tint(12),
      period: 1.8,
      phase: -i * 0.7, // staggered → the approach lights chase
    });
  }
  if (props.shipSeed) {
    const sc = document.createElement('canvas');
    sc.width = sc.height = 24;
    drawShip(sc, props.shipSeed, shipHue(props.shipSeed));
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(padX - 11, padY + padH - 7, 22, 3);
    ctx.drawImage(sc, padX - 12, padY - 4);
  }

  // ── Gantry crane beside the pad, beacon on the arm ──
  const armDir = padX > W / 2 ? -1 : 1; // arm reaches over the pad
  const gx = padX + armDir * -(padW / 2 + 14);
  ctx.fillStyle = tint(17);
  ctx.fillRect(gx, CEIL + 2, 3, H - 12 - CEIL);
  ctx.fillStyle = tint(22);
  ctx.fillRect(armDir > 0 ? gx + 3 : gx - 26, 16, 26, 2);
  const hookX = gx + 1 + armDir * 22;
  ctx.fillStyle = tint(28);
  ctx.fillRect(hookX, 18, 1, 14);
  ctx.fillRect(hookX - 1, 32, 3, 2);
  lights.push({ x: gx + 1 + armDir * 25, y: 15, on: 'hsl(0 85% 60%)', off: 'hsl(0 40% 20%)', period: 2.4, phase: rng() * 6 });

  // ── Crates stacked away from the pad ──
  let cx = padX > W / 2 ? 12 : W - 48;
  const nCrates = 3 + ((rng() * 4) | 0);
  for (let i = 0; i < nCrates; i++) {
    const cw = 5 + ((rng() * 4) | 0);
    const ch = 4 + ((rng() * 4) | 0);
    const cy = H - 8 - ch - ((rng() * 14) | 0);
    ctx.fillStyle = rng() < 0.3 ? `hsl(${(s.hue + 40) % 360} 45% 34%)` : tint(18 + ((rng() * 10) | 0));
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(cx, cy, cw, 1);
    cx += cw + 1 + ((rng() * 3) | 0);
  }

  // ── Dockworkers about the deck ──
  const suits = ['hsl(28 70% 50%)', 'hsl(180 40% 45%)', `hsl(${s.hue} 50% 55%)`, 'hsl(50 60% 50%)'];
  const nCrew = 2 + ((rng() * 3) | 0);
  for (let i = 0; i < nCrew; i++) {
    const wx = 8 + ((rng() * (W - 16)) | 0);
    const wy = WALL + 5 + ((rng() * (H - WALL - 13)) | 0);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(wx - 1, wy + 5, 4, 1);
    ctx.fillStyle = suits[(rng() * suits.length) | 0];
    ctx.fillRect(wx, wy + 1, 2, 3);
    ctx.fillStyle = 'hsl(30 35% 72%)';
    ctx.fillRect(wx, wy, 2, 1);
    ctx.fillStyle = tint(8);
    ctx.fillRect(wx, wy + 4, 2, 1);
  }

  return { scene, lights };
}

function initScene(): void {
  if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
  const el = cvRef.value;
  if (!el) return;
  const ctx = el.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const built = paintStatic();
  if (!built) { ctx.clearRect(0, 0, W, H); return; }
  const { scene, lights } = built;

  let last = 0;
  function loop(t: number): void {
    if (t - last > 120) { // blinking needs ~8fps, no more
      last = t;
      ctx.drawImage(scene, 0, 0);
      const sec = t / 1000;
      for (const li of lights) {
        const lit = Math.sin((sec * Math.PI * 2) / li.period + li.phase) > 0;
        if (lit) {
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = li.on;
          ctx.fillRect(li.x - 1, li.y, 3, 1); // soft glow
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = lit ? li.on : li.off;
        ctx.fillRect(li.x, li.y, 1, 1);
      }
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
}

watch(() => [props.sector, props.shipSeed], initScene);
onMounted(initScene);
onUnmounted(() => { if (raf !== null) cancelAnimationFrame(raf); });
</script>

<template>
  <div class="bay">
    <canvas ref="cvRef" class="scene" :width="W" :height="H" />

    <!-- Station name — top-left identity (mirrors the orbit viewport) -->
    <div v-if="sector.station" class="sname">{{ sector.station.name }}</div>

    <!-- Station type — top-right toast -->
    <div v-if="sector.station" class="stype">
      {{ STATION_DESC[sector.station.stationType] ?? 'Station' }}
    </div>

    <!-- The station's current mood, overlaid along the deck -->
    <div v-if="vibe" class="svibe">{{ vibe }}</div>
  </div>
</template>

<style scoped>
.bay {
  position: relative;
  border: 1px solid #1f2a3d;
  border-radius: 14px;
  background: #080c16;
  overflow: hidden;
  height: 246px;
}
/* The scene stops above a reserved caption band, so the vibe never sits on the pad lights */
.scene {
  position: absolute;
  inset: 0 0 22px 0;
  width: 100%;
  height: calc(100% - 22px);
  image-rendering: pixelated;
}
.sname {
  position: absolute;
  top: 9px;
  left: 12px;
  max-width: 58%;
  color: #eaf1ff;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.3px;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stype {
  position: absolute;
  top: 8px;
  right: 10px;
  padding: 3px 8px;
  border-radius: 8px;
  background: rgba(20, 28, 46, 0.72);
  border: 1px solid #1f2a3d;
  color: #9fb2d4;
  font-size: 10px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  font-family: "DejaVu Sans Mono", Menlo, Consolas, monospace;
}
.svibe {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 22px;
  line-height: 21px;
  border-top: 1px solid #1f2a3d;
  text-align: center;
  padding: 0 10px;
  color: #9fb2d4;
  font-size: 11px;
  font-style: italic;
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
