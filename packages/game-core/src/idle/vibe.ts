// A station's disposition — derived purely from the seed, exactly like world class.
// Core skews lawful/prosperous/calm and the rim skews tense (the safe-zone pillar:
// a returning newbie idling near Sol meets mostly quiet, kind events). Havens get a
// hard suppressor on top so they stay safe wherever they are.

import { unit } from '../hash';
import type { StationType } from '../sector-content';
import type { StationVibe } from './types';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function stationVibe(
  seed: string,
  sectorId: number,
  rimT: number,
  stationType: StationType = 'trade',
): StationVibe {
  const k = `${seed}|vibe|${sectorId}`;
  let lawfulness = clamp01(unit(k + '|law') * 0.7 + (1 - rimT) * 0.3);
  let prosperity = clamp01(unit(k + '|pro') * 0.7 + (1 - rimT) * 0.3);
  let tension = clamp01(unit(k + '|ten') * 0.7 + rimT * 0.3);

  if (stationType === 'haven') {
    lawfulness = Math.max(lawfulness, 0.65);
    tension = Math.min(tension, 0.35);
  }
  // Sol / Terra Station is the tutorial harbour: spotless and sleepy.
  if (sectorId === 0) {
    lawfulness = 0.95;
    prosperity = 0.9;
    tension = 0.05;
  }
  return { lawfulness, prosperity, tension };
}

// ── Vibe vocabulary ───────────────────────────────────────────────────────────
// One word per axis, banded by the same thresholds the event modules gate on, so the
// blurb stays an honest readout of the content pool. ~30 words per axis; the pick is
// seeded per station, so every port keeps its own stable turn of phrase.

const LAW_LOW = [
  'seedy', 'lawless', 'rough-and-tumble', 'smuggler-friendly', 'no-questions',
  'back-alley', 'freewheeling', 'unpoliced', 'wide-open', 'crooked',
] as const;
const LAW_MID = [
  'workaday', 'plain-dealing', 'unremarkable', 'middling', 'everyday',
  'unfussy', 'live-and-let-live', 'loosely-run', 'practical', 'no-frills',
] as const;
const LAW_HIGH = [
  'spit-and-polish', 'buttoned-up', 'by-the-book', 'customs-heavy', 'well-patrolled',
  'squared-away', 'tightly-run', 'inspection-proud', 'white-glove', 'regulation',
] as const;

const TENSION_LOW = [
  'sleepy', 'quiet', 'drowsy', 'becalmed', 'unhurried',
  'easygoing', 'peaceable', 'slow-watch', 'settled', 'calm',
] as const;
const TENSION_MID = [
  'busy', 'bustling', 'crowded', 'noisy', 'humming',
  'brisk', 'elbow-to-elbow', 'work-worn', 'clattering', 'restless',
] as const;
const TENSION_HIGH = [
  'tense', 'jumpy', 'on-edge', 'uneasy', 'powder-keg',
  'simmering', 'wary', 'short-fused', 'knife-edge', 'flinty',
] as const;

// Mid prosperity stays wordless on purpose — ordinary ports read shorter.
const PROSPERITY_LOW = [
  'struggling', 'threadbare', 'down-at-heel', 'hand-to-mouth', 'rust-streaked',
  'half-shuttered', 'hardscrabble', 'lean', 'fading', 'hollowed-out',
  'patched-together', 'scraping-by', 'salvage-poor', 'dim-lit', 'going-broke',
] as const;
const PROSPERITY_HIGH = [
  'booming', 'flush', 'gilded', 'boomtown', 'freight-fat',
  'full-berth', 'money-soaked', 'thriving', 'roaring', 'brimming',
  'high-rolling', 'overflowing', 'gold-rush', 'fat-ledger', 'prosperous',
] as const;

const pickWord = (key: string, salt: string, words: readonly string[]): string =>
  words[Math.floor(unit(key + salt) * words.length) % words.length];

/**
 * Short prose tag for the dock scene, narrator prompt + admin UI ("a buttoned-up sleepy
 * boomtown port"). `key` seeds the word choice (pass the station's vibe key so the
 * phrasing is stable per station); without one, the vibe values themselves seed it.
 */
export function vibeBlurb(v: StationVibe, key?: string): string {
  const k = key ?? `${v.lawfulness.toFixed(3)}|${v.prosperity.toFixed(3)}|${v.tension.toFixed(3)}`;
  const law =
    v.lawfulness < 0.35 ? pickWord(k, '|law-word', LAW_LOW)
    : v.lawfulness > 0.7 ? pickWord(k, '|law-word', LAW_HIGH)
    : pickWord(k, '|law-word', LAW_MID);
  const ten =
    v.tension > 0.6 ? pickWord(k, '|ten-word', TENSION_HIGH)
    : v.tension < 0.3 ? pickWord(k, '|ten-word', TENSION_LOW)
    : pickWord(k, '|ten-word', TENSION_MID);
  const pro =
    v.prosperity < 0.35 ? pickWord(k, '|pro-word', PROSPERITY_LOW)
    : v.prosperity > 0.7 ? pickWord(k, '|pro-word', PROSPERITY_HIGH)
    : '';
  const words = [law, ten, pro].filter(Boolean).join(' ');
  return `${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words} port`;
}
