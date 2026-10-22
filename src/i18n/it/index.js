// Italian dictionary, split by area so each part stays readable.
// Keys are the exact English strings used in the code.
import UI from './ui.js';
import HUD from './hud.js';
import DATA from './data.js';
import CINE from './cine.js';
import RADIO from './radio.js';
import MOVES from './moves.js';

export default { ...DATA, ...CINE, ...RADIO, ...HUD, ...UI, ...MOVES };
