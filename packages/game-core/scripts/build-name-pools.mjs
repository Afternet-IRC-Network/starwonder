#!/usr/bin/env node
/**
 * Regenerates the *station* name pools — the raw vocabulary the engine will pair up
 * to name stations (so a station is no longer forever "<planet> Terminal"). Four
 * categories, each a JSON array in src/data/, mirroring world-names.json:
 *
 *   place-names.json   ~22k real places (cities + a curated ancient/historical set)
 *   surnames.json      ~80k US surnames, frequency-ranked (Foshay, Hancock, Marquette…)
 *   first-names.json   ~5k US given names, frequency-ranked
 *   descriptives.json  ~300 hand-curated evocative place-words (Garden, Harbor, Cedar…)
 *
 * Frequency-ranked lists are kept in rank order so the runtime can fame-band them by
 * distance from Sol, exactly like the world-name pool. The pairing algorithm that
 * consumes these lives in src/names.ts and is a separate concern.
 *
 * Sources (all public-domain or open data):
 *   - datasets/world-cities (GitHub, derived from GeoNames)
 *   - US Census 1990 surname / given-name frequency files
 *
 * Run:  node scripts/build-name-pools.mjs
 *       (or: pnpm --filter @starwonder/game-core build-name-pools)
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '.cache');
const DATA = join(HERE, '..', 'src', 'data');

const SOURCES = {
  cities: 'https://raw.githubusercontent.com/datasets/world-cities/master/data/world-cities.csv',
  surnames: 'https://www2.census.gov/topics/genealogy/1990surnames/dist.all.last',
  firstMale: 'https://www2.census.gov/topics/genealogy/1990surnames/dist.male.first',
  firstFemale: 'https://www2.census.gov/topics/genealogy/1990surnames/dist.female.first',
};

// ── tiny fetch-once cache (keeps the build offline after the first run) ──
async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}
async function cached(key, url) {
  await mkdir(CACHE, { recursive: true });
  const path = join(CACHE, `${key}.txt`);
  if (await exists(path)) return readFile(path, 'utf8');
  process.stdout.write(`downloading ${key} …\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(path, text);
  return text;
}

// ── normalization shared by every pool ──
const STRIP_DIACRITICS = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, b, c) => b + c.toUpperCase());

/** Clean one candidate to a title-cased ASCII name, or null if it should be dropped. */
function clean(raw, { maxWords }) {
  let s = STRIP_DIACRITICS((raw || '').trim());
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(s)) return null;     // letters / space / ' / - only
  if (s.length < 2 || s.length > 18) return null;
  if (s.split(/\s+/).length > maxWords) return null;
  return titleCase(s);
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// First whitespace-delimited token (Census files are NAME + stats, name has no spaces).
const censusNames = (text) =>
  text.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);

// First CSV column (handles a leading "quoted, name").
const csvFirstCol = (text) =>
  text.split('\n').slice(1).map((l) => {
    const m = l.match(/^\s*("([^"]*)"|[^,]*)/);
    return m ? (m[2] ?? m[1]) : '';
  });

// ── curated extras (no good big public-domain source; hand-picked for flavour) ──
const ANCIENT_PLACES = [
  'Pompeii', 'Carthage', 'Babylon', 'Nineveh', 'Ur', 'Uruk', 'Akkad', 'Sumer',
  'Tyre', 'Sidon', 'Byblos', 'Petra', 'Palmyra', 'Ctesiphon', 'Persepolis',
  'Sparta', 'Athens', 'Corinth', 'Thebes', 'Mycenae', 'Knossos', 'Troy',
  'Ephesus', 'Pergamon', 'Halicarnassus', 'Miletus', 'Syracuse', 'Alexandria',
  'Memphis', 'Thonis', 'Heliopolis', 'Cyrene', 'Leptis', 'Numantia', 'Veii',
  'Ostia', 'Pompeii', 'Herculaneum', 'Ravenna', 'Aquileia', 'Tarraco',
  'Gadir', 'Massalia', 'Lutetia', 'Eburacum', 'Camulodunum', 'Verulamium',
  'Tenochtitlan', 'Teotihuacan', 'Tikal', 'Copan', 'Palenque', 'Chichen',
  'Cusco', 'Machu', 'Cahokia', 'Mohenjo', 'Harappa', 'Pataliputra', 'Taxila',
  'Anuradhapura', 'Vijayanagara', 'Angkor', 'Pagan', 'Ayutthaya', 'Chang',
  'Xanadu', 'Karakorum', 'Samarkand', 'Bukhara', 'Merv', 'Nishapur', 'Ctesiphon',
  'Gordion', 'Sardis', 'Hattusa', 'Mari', 'Ebla', 'Jericho', 'Megiddo', 'Lagash',
];

// Evocative place-words ("Garden Station", "Harbor Docks"). Deliberately excludes the
// station *suffixes* (Terminal, Docks, Beacon, Haven…) so we never get "Beacon Beacon".
const DESCRIPTIVES = [
  // botanical
  'Garden', 'Orchard', 'Vineyard', 'Grove', 'Meadow', 'Willow', 'Maple', 'Aspen',
  'Birch', 'Cedar', 'Cypress', 'Laurel', 'Magnolia', 'Juniper', 'Hawthorn', 'Bramble',
  'Fern', 'Heather', 'Ivy', 'Rose', 'Lily', 'Lotus', 'Thistle', 'Clover', 'Sage',
  'Hazel', 'Rowan', 'Linden', 'Sycamore', 'Chestnut', 'Holly', 'Myrtle', 'Jasmine',
  // water & coast
  'Harbor', 'Bay', 'Cove', 'Lagoon', 'Delta', 'Estuary', 'Fjord', 'Strait', 'Channel',
  'Narrows', 'Shoal', 'Reef', 'Atoll', 'Tide', 'Wave', 'Current', 'Spring', 'Brook',
  'Creek', 'River', 'Rapids', 'Cascade', 'Falls', 'Marsh', 'Fen', 'Mere', 'Pool',
  // terrain
  'Highland', 'Summit', 'Crest', 'Vale', 'Glen', 'Dale', 'Hollow', 'Dell', 'Ridge',
  'Bluff', 'Mesa', 'Butte', 'Canyon', 'Gorge', 'Ravine', 'Cliff', 'Crag', 'Pinnacle',
  'Plateau', 'Heath', 'Moor', 'Prairie', 'Savanna', 'Tundra', 'Steppe', 'Oasis',
  'Dune', 'Mirage', 'Basin', 'Hollow', 'Terrace', 'Cape', 'Point', 'Headland',
  // celestial / weather
  'Aurora', 'Eclipse', 'Solstice', 'Equinox', 'Zenith', 'Meridian', 'Horizon',
  'Twilight', 'Dawn', 'Dusk', 'Daybreak', 'Nova', 'Comet', 'Meteor', 'Nebula',
  'Lunar', 'Solar', 'Stellar', 'Astral', 'Cosmic', 'Celestial', 'Storm', 'Thunder',
  'Tempest', 'Zephyr', 'Frost', 'Snowfall', 'Ember', 'Cinder', 'Mist', 'Cloud',
  // material / colour
  'Copper', 'Iron', 'Silver', 'Golden', 'Amber', 'Crimson', 'Azure', 'Cobalt',
  'Emerald', 'Jade', 'Onyx', 'Ivory', 'Ebony', 'Obsidian', 'Marble', 'Granite',
  'Slate', 'Flint', 'Quartz', 'Opal', 'Pearl', 'Coral', 'Ruby', 'Sable', 'Scarlet',
  // works of hand
  'Foundry', 'Quarry', 'Forge', 'Anvil', 'Lantern', 'Mill', 'Kiln', 'Loom',
  'Bridge', 'Crossing', 'Junction', 'Landing', 'Wharf', 'Quay', 'Causeway',
  'Gateway', 'Archway', 'Rampart', 'Bastion', 'Citadel', 'Keep', 'Spire', 'Belfry',
  // gate / side compounds (read like neighborhoods)
  'Northgate', 'Eastgate', 'Westgate', 'Southgate', 'Highgate', 'Kingsgate',
  'Stonegate', 'Lakeview', 'Fairview', 'Riverside', 'Brookside', 'Hillside',
  'Bayside', 'Cliffside', 'Parkside', 'Greenwood', 'Oakwood', 'Elmwood', 'Ashwood',
  'Blackwood', 'Stonebrook', 'Foxglove', 'Nightshade', 'Wildwood', 'Brightwater',
];

async function main() {
  await mkdir(DATA, { recursive: true });

  // places: real cities (rank order from the file ≈ none, so just cleaned) prefixed
  // with the curated ancient set (famous → they land near Sol via fame-banding).
  const citiesRaw = csvFirstCol(await cached('cities', SOURCES.cities));
  const cities = dedupe([...ANCIENT_PLACES, ...citiesRaw]
    .map((s) => clean(s, { maxWords: 2 })).filter(Boolean));

  // surnames + given names: keep Census rank order (frequency = fame).
  const surnames = dedupe(censusNames(await cached('surnames', SOURCES.surnames))
    .map((s) => clean(s, { maxWords: 1 })).filter(Boolean));

  const male = censusNames(await cached('firstMale', SOURCES.firstMale));
  const female = censusNames(await cached('firstFemale', SOURCES.firstFemale));
  const merged = [];                         // interleave so common names of both lead
  for (let i = 0; i < Math.max(male.length, female.length); i++) {
    if (male[i]) merged.push(male[i]);
    if (female[i]) merged.push(female[i]);
  }
  const firstNames = dedupe(merged.map((s) => clean(s, { maxWords: 1 })).filter(Boolean));

  const descriptives = dedupe(DESCRIPTIVES.map((s) => clean(s, { maxWords: 1 })).filter(Boolean));

  const write = async (name, arr) => {
    await writeFile(join(DATA, name), JSON.stringify(arr, null, 0) + '\n');
    process.stdout.write(`wrote ${String(arr.length).padStart(6)} → src/data/${name}\n`);
  };
  await write('place-names.json', cities);
  await write('surnames.json', surnames);
  await write('first-names.json', firstNames);
  await write('descriptives.json', descriptives);
}

main().catch((err) => { console.error(err); process.exit(1); });
