// Story-beat transmissions interleaved through the 30-wave run.
//
// Each entry has a header (title + sender), an array of timed lines
// (at = ms from cinematic start, speaker, pitch tier for TTS, text),
// a total durMs after which the cinematic auto-advances back to
// management, and a supplyDrop payload that Central Command parachutes
// onto the perimeter when the cinematic completes. The transmission
// renderer animates a falling crate during the last ~5 s; React's
// finishTransmission applies the payload to gs.resources.

export const TRANSMISSION_WAVES = [10, 20, 25];

// at-offsets in ms when the parachute crate becomes visible (drop) and
// when it hits the ground (land). Set per-transmission via dropAt /
// landAt — defaults work for the 14-17s cinematics below.
export const TRANSMISSIONS = {
  10: {
    title: 'INCOMING TRANSMISSION',
    sender: 'CENTRAL COMMAND',
    lines: [
      { at:   600, speaker: 'Command', pitch: 'low', text: 'Fort Omega, this is Central Command. Do you copy?' },
      { at:  5200, speaker: 'Command', pitch: 'low', text: 'We have intel. A vaccine prototype was held at a lab in your sector.' },
      { at: 11000, speaker: 'Command', pitch: 'low', text: 'Survive. We need that sample.' },
      { at: 15500, speaker: 'Command', pitch: 'low', text: 'Supply crate inbound. Hold the line. Out.' },
    ],
    durMs: 21000,
    dropAt: 15500,
    landAt: 19500,
    supplyDrop: { ammo:  60, food: 30, medicine:  8, materials: 15, sniperAmmo:  5 },
  },
  20: {
    title: 'INCOMING TRANSMISSION',
    sender: 'CENTRAL COMMAND',
    lines: [
      { at:   600, speaker: 'Command', pitch: 'low', text: 'Omega, Command. Sample location confirmed.' },
      { at:  5000, speaker: 'Command', pitch: 'low', text: 'Recovery convoy is en route. Estimated arrival in ten waves.' },
      { at: 10800, speaker: 'Command', pitch: 'low', text: 'Hold the perimeter.' },
      { at: 14200, speaker: 'Command', pitch: 'low', text: 'Drop coming in hot. Heavy ordnance. Out.' },
    ],
    durMs: 20000,
    dropAt: 14200,
    landAt: 18500,
    supplyDrop: { ammo: 100, food: 50, medicine: 15, materials: 30, sniperAmmo: 10, turretAmmo: 20 },
  },
  25: {
    title: 'INCOMING TRANSMISSION',
    sender: 'CENTRAL COMMAND',
    lines: [
      { at:   600, speaker: 'Command', pitch: 'low', text: 'Omega... this is Command.' },
      { at:  4200, speaker: 'Command', pitch: 'low', text: 'All other outposts have gone dark.' },
      { at:  8800, speaker: 'Command', pitch: 'low', text: 'You are the last unit. Hold five more days.' },
      { at: 13800, speaker: 'Command', pitch: 'low', text: 'The convoy is coming.' },
      { at: 17500, speaker: 'Command', pitch: 'low', text: 'Every last crate we have. Take it all. Out.' },
    ],
    durMs: 23500,
    dropAt: 17500,
    landAt: 22000,
    supplyDrop: { ammo: 150, food: 80, medicine: 25, materials: 50, sniperAmmo: 20, turretAmmo: 40 },
  },
};
