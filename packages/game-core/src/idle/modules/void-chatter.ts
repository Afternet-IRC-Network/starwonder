// void-chatter — pure texture for the long haul: long-range radio murmur, passing hulls,
// the void playing tricks. No deltas, not IRC-worthy; it exists so transit stories have
// something quieter than tolls and salvage between them.

import type { IdleModule } from '../types';
import { roll } from './util';

const CHATTER = [
  'caught a half-hour of soap-opera reruns on a decaying relay band',
  'passed a grain hauler running the opposite lane, lights dimmed for the night cycle',
  'heard a prospector arguing with their own nav computer on an open channel',
  'watched a comet pace the ship for a while before falling behind',
  'picked up a lighthouse beacon looping a station jingle from decades back',
  'listened to two tug crews settle a years-old bet over an open channel',
  'crossed the wake of a liner and rode the wash for a few easy minutes',
  'heard a child on some far relay reciting the planets of a system that wasn’t this one',
  'logged a slow tumble of hull plating that the charts insisted wasn’t there',
  'caught a numbers station counting down in a language the computer couldn’t place',
  'watched the forward dust glow shift colour as the lane bent through a thin nebula',
  'traded three words with a hauler going the other way — all anyone had to say',
  'let the autopilot hold the line while a meteor shower combed past, kilometres off',
  'picked up half a love song before the relay rotated out of range',
];

export const voidChatter: IdleModule = {
  id: 'void-chatter',
  events: [
    {
      id: 'void-chatter',
      context: 'transit',
      eligible: () => true,
      weight: () => 1.2,
      resolve: (c) => {
        const summary = CHATTER[roll(c, 'which', 0, CHATTER.length - 1)];
        return {
          deltas: [],
          fact: { plugin: 'void-chatter', outcome: 'chatter', summary, newsworthy: false },
        };
      },
    },
  ],
  line: (f) => `${f.summary.charAt(0).toUpperCase()}${f.summary.slice(1)}.`,
};
