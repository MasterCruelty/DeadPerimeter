// ────────────────────────────────────────────────────────────────
// Canvas + world constants
// ────────────────────────────────────────────────────────────────
// CW / CH are the canvas viewport (what the player sees in one frame).
// WORLD_W is the full siege world: ~2.2× wider than the viewport so
// the wall and the gathering horde can both exist on the same map.
// The siege loop applies a camera translation (gs.cameraX) so the
// 900-wide viewport scrolls horizontally over the wider world.
export const CW = 900;
export const CH = 530;
export const WORLD_W = 1980;
export const GY = 400;
export const WX = 162;

// Depth lanes. Lane 0 = FRONT (nearest, biggest), Lane 2 = BACK (farthest).
export const LANES = [
  { dy: 0,   sc: 1.00, gshade: '#1d1b11' }, // front
  { dy: -34, sc: 0.80, gshade: '#171510' }, // mid
  { dy: -64, sc: 0.64, gshade: '#111008' }, // back
];

export const laneY  = lane => GY + LANES[lane].dy;
export const laneSc = lane => LANES[lane].sc;
export const clickToLane = my => (my < GY - 50 ? 2 : my < GY - 20 ? 1 : 0);

// Color palette
export const C = {
  sky1: '#040710', sky2: '#0c1520', g1: '#1d1b11', g2: '#100e08',
  hel: '#2a3922', jac: '#465737', pan: '#384530', sk: '#bf8a6a', boot: '#171210',
  muz: '#ff8800', trc: '#ffee44', bld: '#bc1010', bldd: '#7a0808',
  zsk: '#698059', zcl: '#353226', rsk: '#907f52', rcl: '#262217', tsk: '#466040', tcl: '#172018',
  acc: '#72bc40', dng: '#cc3333', wrn: '#c8a020', txt: '#b8ccaa',
  ui: 'rgba(4,8,4,0.97)', uib: '#1d3c12',
  bar: '#7a5a1e',
};

// Weapon sprite scale. The original V8 polygons were drawn slightly
// oversized vs the soldier body. 0.78 brings the barrel back inside the
// expected silhouette. Used by render/weapons.js (ctx.scale) and by
// render/soldier.js for the muzzle-flash anchor.
export const WEAPON_SCALE = 0.78;

// Misc helpers
let _id = 200;
export const uid = () => ++_id;
export const rng = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
