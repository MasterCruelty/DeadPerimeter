// Survivors at the fort and the jobs they hand out.
//
// Three NPCs live at Fort Omega. Each offers one job at a time: a step of
// the main story when it's their turn (and the day / wave gate is met),
// otherwise a side job built from a template. Up to MAX_ACTIVE jobs can
// be running. Story steps unlock permanent fort upgrades (FORT_UNLOCKS).
//
// Job kinds:
//   fetch   — recover a named item at a city location (quest pickup)
//   rescue  — find a named survivor at a location and walk them to the van
//   clear   — bring a location's infestation below a threshold
//   deliver — hand over resources from the stash (turn in at the fort)
export const MAX_ACTIVE = 3;

export const NPCS = {
  reyes: { name: 'Dr. Elena Reyes', role: 'Field medic', icon: '⚕', color: '#88ddff',
           intro: 'Former trauma surgeon at Central. She runs the infirmary out of a supply room.' },
  hale:  { name: 'Sgt. Marcus Hale', role: 'Quartermaster', icon: '🎖', color: '#ffcc66',
           intro: 'Last ranking officer of the 3rd Battalion. Keeps the ledger and the radio.' },
  jun:   { name: 'Jun Park', role: 'Mechanic', icon: '🔧', color: '#a8e070',
           intro: 'Fixed cars in Old Town. Now keeps the generator, the wall and the turrets alive.' },
};

// What each story step unlocks at the fort.
export const FORT_UNLOCKS = {
  infirmary: { name: 'Infirmary',       desc: 'Heals cost 3 💊 instead of 5.' },
  radio:     { name: 'Radio room',      desc: '+1 sortie per day.' },
  generator: { name: 'Generator',       desc: 'MG turrets cost 40% fewer materials.' },
  lab:       { name: 'Field lab',       desc: 'Research advances twice per wave clear.' },
  cole:      { name: 'Pvt. Cole',       desc: 'A veteran rifleman joins the squad.' },
  vaccine:   { name: 'Vaccine research', desc: 'The Hospital archive: the finale is more forgiving (gold ending with 3+ survivors).' },
};

// Main story, in order. `npc` offers it once `after` is done and the
// day/wave gate is met.
export const STORY = [
  { id: 's1', npc: 'reyes', after: null, minWave: 2, kind: 'fetch', loc: 'pharm', item: 'Insulin cooler',
    title: 'Cold chain', unlock: 'infirmary',
    offer: 'We have a diabetic in the shelter and no insulin. The pharmacy kept a refrigerated cooler in the back room. Bring it home.',
    done: 'Still cold. You just kept a man alive. I can run a proper infirmary now.' },
  { id: 's2', npc: 'hale', after: 's1', minWave: 4, kind: 'fetch', loc: 'police', item: 'Radio transceiver',
    title: 'Ears on the city', unlock: 'radio',
    offer: 'The precinct had a long-range transceiver in the dispatch room. With it we can coordinate more runs a day.',
    done: 'Static, then voices. We are not alone out there. More teams can go out each day.' },
  { id: 's3', npc: 'jun', after: 's2', minWave: 6, kind: 'fetch', loc: 'depot', item: 'Generator coil',
    title: 'Spark', unlock: 'generator',
    offer: 'Our generator is coughing. The industrial depot stocks replacement coils — heavy, and the yard is crawling.',
    done: 'Hear that hum? Steady power. I can machine turret parts for a lot less now.' },
  { id: 's4', npc: 'reyes', after: 's3', minWave: 9, kind: 'fetch', loc: 'clinic', item: 'Centrifuge',
    title: 'Bench science', unlock: 'lab',
    offer: 'If Command is right about a vaccine, we will need lab gear. The clinic has a centrifuge we can carry.',
    done: 'A real lab bench. Whatever we research now, we research faster.' },
  { id: 's5', npc: 'hale', after: 's4', minWave: 12, kind: 'rescue', loc: 'precinct', person: 'Pvt. Cole',
    title: 'Man left behind', unlock: 'cole',
    offer: 'Private Cole held the Precinct armory when we fell back. His beacon is still pinging. Bring him home.',
    done: 'Cole. Thought we lost you, son. Grab a rifle — you are on the wall tonight.' },
  { id: 's6', npc: 'reyes', after: 's5', minWave: 15, kind: 'fetch', loc: 'hospital', item: 'Research archive',
    title: 'Patient zero', unlock: 'vaccine',
    offer: 'Central Hospital ran the first trials. Their archive on the 4th floor could be the difference when the convoy comes. It is the worst place in the city.',
    done: 'Sequencing data, trial notes... this is it. When Command brings the sample, we will know how to keep it alive.' },
];

// Thank-you lines for side jobs, per NPC.
export const SIDE_THANKS = {
  reyes: ['That will save lives in here. Thank you.', 'Put it on the shelf by the cots. Good work.', 'Fewer funerals this week. I owe you.'],
  hale:  ['Logged and stowed. Good hustle, soldier.', 'That keeps us in the fight another day.', 'Outstanding. The ledger looks a little less grim.'],
  jun:   ['Oh, that is exactly what I needed. Give me an hour.', 'The wall thanks you. So do my blistered hands.', 'Perfect. Do not ask what I am building.'],
};

// Side-job templates (one per NPC theme). `pick` returns a filled job or
// null when it can't apply right now.
const FETCH_ITEMS = {
  reyes: ['Surgical kit', 'Antibiotics', 'Blood bags', 'Oxygen tank'],
  hale:  ['Ammo crate', 'Field rations', 'Night-vision goggles', 'Body armor'],
  jun:   ['Car battery', 'Welding torch', 'Spare parts', 'Fuel can'],
};
const FETCH_LOCS = {
  reyes: ['pharm', 'clinic', 'school', 'hospital'],
  hale:  ['police', 'precinct', 'gunshop', 'super'],
  jun:   ['hardware', 'gas', 'depot', 'mall'],
};
const DELIVER = {
  reyes: [{ medicine: 15 }, { food: 40 }],
  hale:  [{ ammo: 120 }, { food: 50 }],
  jun:   [{ materials: 25 }, { turretAmmo: 60 }],
};
const REWARD_POOL = {
  reyes: ['medicine', 'food'],
  hale:  ['ammo', 'sniperAmmo'],
  jun:   ['materials', 'turretAmmo'],
};

export function sideJob(npc, gs, discoveredIds, rnd = Math.random) {
  const w = gs.wave || 1;
  const reward = res => {
    const base = { medicine: 10, food: 30, ammo: 80, sniperAmmo: 8, materials: 18, turretAmmo: 50 }[res];
    const out = { [res]: Math.round(base * (1 + 0.04 * w)) };
    if (rnd() < 0.3) out.gear = true;           // a found weapon as a bonus
    return out;
  };
  const r = rnd();
  const pool = REWARD_POOL[npc];
  const res = pool[Math.floor(rnd() * pool.length)];
  if (r < 0.45) {
    const locs = FETCH_LOCS[npc];
    const loc = locs[Math.floor(rnd() * locs.length)];
    const item = FETCH_ITEMS[npc][Math.floor(rnd() * FETCH_ITEMS[npc].length)];
    return { kind: 'fetch', loc, item, title: `${item} run`, offer: `I need a ${item.toLowerCase()} — try the ${'{loc}'}.`, reward: reward(res), xp: 30 };
  }
  if (r < 0.75) {
    const hot = discoveredIds.filter(id => (gs.city.locs[id].infest || 0) > 0.5);
    if (hot.length) {
      const loc = hot[Math.floor(rnd() * hot.length)];
      return { kind: 'clear', loc, below: 0.35, title: 'Thin the herd', offer: `The ${'{loc}'} is crawling. Clear it out so our runners can pass.`, reward: reward(res), xp: 40 };
    }
  }
  const need = DELIVER[npc][Math.floor(rnd() * DELIVER[npc].length)];
  return { kind: 'deliver', need, title: 'Supplies', offer: 'We are short on the basics. Can the stash spare this?', reward: reward(res), xp: 20 };
}
