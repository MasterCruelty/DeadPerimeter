// The Northgate Compact: National Guard deserters who walled off a
// depot in the north and declared a provisional government. Neutral.
//
// Trade or raid:
//  • TRADE — an envoy (one sortie slot) buys guns and munitions with the
//    fort's surplus. Every purchase improves standing (better stock,
//    discounts) — and everything paid goes into the Compact treasury,
//    which also grows on its own day after day.
//  • ASSAULT — a sortie against trained soldiers instead of the dead.
//    Wipe out the garrison (or kill the colonel) and the whole armory and
//    treasury are yours, but the Compact is gone: no more trade. Fail,
//    and they turn hostile and raid the fort.
// The longer you trade, the bigger the prize — and the more you lose by
// ending it. When to switch is the player's call.
export const COMPACT = {
  name: 'Northgate Compact', leader: 'Col. Adaeze Voss', locId: 'compound', color: '#d8b060', icon: '🏴',
  desc: 'National Guard deserters who declared their own provisional government. Neutral — for now.',
};

// tier: standing tier needed (0: <25, 1: 25+, 2: 60+).
export const COMPACT_STOCK = [
  { id: 'revolver', tier: 0, gun: 'revolver', price: { materials: 16, food: 10 } },
  { id: 'dbarrel',  tier: 0, gun: 'dbarrel',  price: { materials: 14, food: 14 } },
  { id: 'ammo',     tier: 0, give: { ammo: 60 },       price: { food: 18 } },
  { id: 'sniper',   tier: 0, give: { sniperAmmo: 6 },  price: { medicine: 4 } },
  { id: 'smg',      tier: 1, gun: 'smg',      price: { materials: 26, medicine: 6 } },
  { id: 'hunting',  tier: 1, gun: 'hunting',  price: { materials: 24, food: 16 } },
  { id: 'belts',    tier: 1, give: { turretAmmo: 40 }, price: { food: 16 } },
  { id: 'ak',       tier: 2, gun: 'ak',       price: { materials: 34, medicine: 10 } },
];
export const STANDING_PER_BUY = 8;
export const tierOf = standing => (standing >= 60 ? 2 : standing >= 25 ? 1 : 0);
export const discountOf = standing => (standing >= 60 ? 0.85 : 1);

export const mkCompact = () => ({
  status: 'neutral',                    // neutral | hostile | destroyed
  standing: 0,
  guns: 3,                              // rifles in their armory
  treasury: { materials: 30, food: 40, medicine: 8, ammo: 120 },
  envoyDay: -1,                         // day an envoy was last sent
  nextRaidDay: 0,                       // hostile: next reprisal raid
});
