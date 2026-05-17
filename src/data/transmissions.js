// Story-beat transmissions interleaved through the 30-wave run.
//
// Each entry has a header (title + sender), an array of timed lines
// (at = ms from cinematic start, speaker, pitch tier for TTS, text),
// and a total durMs after which the cinematic auto-advances back to
// management. The React layer consumes this — see transmissionRef
// handling in DeadPerimeter.jsx.
//
// Tweak the wave numbers in TRANSMISSION_WAVES to re-route the beats.

export const TRANSMISSION_WAVES = [10, 20, 25];

export const TRANSMISSIONS = {
  10: {
    title: 'INCOMING TRANSMISSION',
    sender: 'CENTRAL COMMAND',
    lines: [
      { at:   600, speaker: 'Command', pitch: 'low', text: 'Fort Omega, this is Central Command. Do you copy?' },
      { at:  5200, speaker: 'Command', pitch: 'low', text: 'We have intel. A vaccine prototype was held at a lab in your sector.' },
      { at: 11000, speaker: 'Command', pitch: 'low', text: 'Survive. We need that sample. Out.' },
    ],
    durMs: 16000,
  },
  20: {
    title: 'INCOMING TRANSMISSION',
    sender: 'CENTRAL COMMAND',
    lines: [
      { at:   600, speaker: 'Command', pitch: 'low', text: 'Omega, Command. Sample location confirmed.' },
      { at:  5000, speaker: 'Command', pitch: 'low', text: 'Recovery convoy is en route. Estimated arrival in ten waves.' },
      { at: 10800, speaker: 'Command', pitch: 'low', text: 'Hold the perimeter. Out.' },
    ],
    durMs: 14500,
  },
  25: {
    title: 'INCOMING TRANSMISSION',
    sender: 'CENTRAL COMMAND',
    lines: [
      { at:   600, speaker: 'Command', pitch: 'low', text: 'Omega... this is Command.' },
      { at:  4200, speaker: 'Command', pitch: 'low', text: 'All other outposts have gone dark.' },
      { at:  8800, speaker: 'Command', pitch: 'low', text: 'You are the last unit. Hold five more days.' },
      { at: 13800, speaker: 'Command', pitch: 'low', text: 'The convoy is coming. Out.' },
    ],
    durMs: 17500,
  },
};
