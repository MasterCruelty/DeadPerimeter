// Biome definitions for playable expeditions. Each destination in
// EXPEDITION_DESTS picks a biome by name; the mission renderer uses
// the palette + obstacle pool to give each run its own atmosphere.

export const BIOMES = {
  hospital: {
    sky:   ['#0a1c2a', '#163240'],     // cool clinical blue
    ground: ['#2a2a26', '#171715'],    // pale concrete tint
    groundLine: '#3a3a30',
    bldgFill:    '#0c1828',
    bldgRoof:    '#0a1220',
    bldgWindow:  '#3a8aaa',            // pale lit clinic windows
    bldgCount: 8,
    bldgHRange: [110, 200],
    obstacles: ['stretcher', 'iv', 'wheelchair', 'medkit', 'crate'],
    propsPerStep: 220,                 // a decorative prop every N px
    propType: 'lamppost-hospital',
    accentLight: 'rgba(180,220,255,0.12)',
  },
  armory: {
    sky:   ['#0a0e08', '#1a1a10'],     // dusty olive
    ground: ['#1d1b11', '#100e08'],
    groundLine: '#2a2716',
    bldgFill:    '#0a0c08',
    bldgRoof:    '#080a06',
    bldgWindow:  '#2a3520',
    bldgCount: 12,
    bldgHRange: [80, 160],
    obstacles: ['sandbag', 'ammo-crate', 'container', 'crate', 'car'],
    propsPerStep: 260,
    propType: 'fence-military',
    accentLight: 'rgba(160,180,80,0.10)',
  },
  downtown: {
    sky:   ['#0a0408', '#2a0808'],     // burning orange/maroon
    ground: ['#1a1612', '#100808'],
    groundLine: '#2a1810',
    bldgFill:    '#100808',
    bldgRoof:    '#0a0606',
    bldgWindow:  '#cc4400',            // angry orange neon
    bldgCount: 16,
    bldgHRange: [60, 220],
    obstacles: ['car', 'trash-bin', 'traffic-cone', 'crate', 'sign'],
    propsPerStep: 200,
    propType: 'streetlamp-broken',
    accentLight: 'rgba(255,80,0,0.18)',
  },
};

// ── Indoor variants ─────────────────────────────────────────────
// Indoor biomes carry indoor: true so the mission renderer swaps the
// outdoor sky+buildings backdrop for a ceiling+walls+lights interior.
// They keep the same outdoor-derived obstacle pool concept but with
// interior-appropriate props.

BIOMES.police_interior = {
  indoor: true,
  // Ceiling + wall + floor palettes used in lieu of sky / bldg / ground.
  ceiling:    ['#0e1620', '#1a2630'],
  ceilingTrim: '#070c14',
  wallFill:   '#7a6a55',                 // institutional beige
  wallDark:   '#3a3025',
  wallTrim:   '#1f1a14',
  ground:     ['#5a5045', '#2a2520'],    // worn linoleum
  groundLine: '#3a3530',
  // Window-cutouts on the side walls show muzzle-flash flicker outside.
  windowCount: 3,
  windowFill: '#0a1418',
  // Light fixture: square fluorescent panels.
  lightSpacing: 200,
  lightColor: 'rgba(220,230,200,0.42)',
  lightFixture: 'panel',
  obstacles: ['desk', 'locker', 'filing-cabinet', 'crate', 'evidence-box'],
  propsPerStep: 220,
  propType: 'wall-poster',
  accentLight: 'rgba(180,180,140,0.06)',
};

BIOMES.armory_interior = {
  indoor: true,
  ceiling:    ['#1a1814', '#0e0a08'],    // dark exposed rafters
  ceilingTrim: '#080604',
  wallFill:   '#4a3a28',                 // dark wood panel
  wallDark:   '#1a1208',
  wallTrim:   '#2a1c10',
  ground:     ['#2a2620', '#181410'],    // worn concrete
  groundLine: '#1a1410',
  windowCount: 0,                         // no windows in an armory
  // Hanging bare bulbs.
  lightSpacing: 240,
  lightColor: 'rgba(255,200,120,0.55)',
  lightFixture: 'bulb',
  obstacles: ['gun-rack', 'glass-case', 'ammo-crate', 'workbench', 'crate'],
  propsPerStep: 240,
  propType: 'wall-flag',
  accentLight: 'rgba(200,140,40,0.10)',
};

BIOMES.office_interior = {
  indoor: true,
  ceiling:    ['#1a2028', '#0e1218'],    // dimmed drop-ceiling at night
  ceilingTrim: '#080c10',
  wallFill:   '#4a5060',                 // partition grey
  wallDark:   '#1a1e22',
  wallTrim:   '#0e1018',
  ground:     ['#2a2620', '#161410'],    // industrial carpet
  groundLine: '#1a1612',
  // Floor-to-ceiling windows on the side walls show the burning city.
  windowCount: 4,
  windowFill: '#3a1a08',                 // distant fire glow
  // Drop-ceiling tile lights, regularly spaced.
  lightSpacing: 180,
  lightColor: 'rgba(210,220,240,0.45)',
  lightFixture: 'tile',
  obstacles: ['cubicle', 'photocopier', 'water-cooler', 'office-chair', 'crate'],
  propsPerStep: 200,
  propType: 'exit-sign',
  accentLight: 'rgba(180,200,220,0.05)',
};

export const DEFAULT_BIOME = 'armory';
