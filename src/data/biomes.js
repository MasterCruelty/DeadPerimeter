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

export const DEFAULT_BIOME = 'armory';
