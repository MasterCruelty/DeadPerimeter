// Northgate Compact panel on the expedition screen (data/faction.js):
// relations, intel on their armory / treasury, the trade stock, and what
// an assault would mean.
import { C } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { COMPACT, tierOf } from '../data/faction.js';
import { ensureCompact, stockFor, priceOf, canAfford, envoyNeeded, buy } from '../update/faction.js';
import { t } from '../i18n/index.js';

const ICON = { materials: '🔧', food: '🥫', medicine: '💊', ammo: '🔫', sniperAmmo: '🎯', turretAmmo: '🟠' };
const fmt = o => Object.entries(o).map(([k, v]) => `${v}${ICON[k] || k}`).join(' ');

export default function CompactPanel({ gs, sortiesPerDay, onChange }) {
  const c = ensureCompact(gs);
  const tier = tierOf(c.standing);
  const slotsLeft = sortiesPerDay - (gs.expeditionsToday || 0);
  const envoy = envoyNeeded(gs);
  const tbox = { marginTop: '6px', background: 'rgba(30,24,10,0.9)', border: `1px solid ${COMPACT.color}`, padding: '8px 12px', fontSize: '9px', color: C.txt };
  if (c.status === 'destroyed') {
    return <div style={tbox}>🏴 <b style={{ color: COMPACT.color }}>{COMPACT.name}</b> {t('— gone. Only their empty depot remains.')}</div>;
  }
  return (
    <div style={tbox}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div>
          <b style={{ color: COMPACT.color, fontSize: '11px' }}>{COMPACT.icon} {COMPACT.name}</b>
          <span style={{ marginLeft: '8px', color: c.status === 'hostile' ? C.dng : '#a8e070', fontWeight: 'bold' }}>{t(c.status.toUpperCase())}</span>
          <div style={{ opacity: 0.75 }}>{t(COMPACT.desc)} {t('Led by {name}.', { name: COMPACT.leader })}</div>
        </div>
        <div style={{ minWidth: '170px' }}>
          {t('Standing {n}/100 · tier {tier}/3', { n: c.standing, tier: tier + 1 })}{tier >= 2 ? ` · ${t('15% discount')}` : ''}
          <div style={{ height: '4px', background: '#1a1a1a', marginTop: '2px' }}><div style={{ height: '4px', width: `${c.standing}%`, background: COMPACT.color }} /></div>
        </div>
      </div>
      <div style={{ marginTop: '5px', color: '#ffcc88' }}>
        {t('Intel: about {n} guns in their armory · treasury ≈ {treasury}', { n: c.guns, treasury: fmt(c.treasury) })}
        <span style={{ opacity: 0.7 }}> ({t('everything you pay them ends up there')})</span>
      </div>
      {c.status === 'neutral' ? (
        <>
          <div style={{ marginTop: '6px', opacity: 0.8 }}>
            {envoy ? t('The first purchase today sends an envoy: it uses 1 sortie ({n} left).', { n: Math.max(0, slotsLeft) }) : t('Envoy already at the compound today: buy freely.')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
            {stockFor(gs).map(it => {
              const price = priceOf(gs, it);
              const ok = canAfford(gs, price) && (!it.gun || c.guns > 0) && (!envoy || slotsLeft > 0);
              const label = it.gun ? `🔫 ${WPN[it.gun].name}` : `📦 ${fmt(it.give)}`;
              return (
                <button key={it.id} disabled={!ok}
                  style={{ background: '#2a2410', color: C.txt, border: `1px solid ${COMPACT.color}`, padding: '3px 8px', fontSize: '9px', fontFamily: 'monospace', cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5 }}
                  onClick={() => { if (buy(gs, it.id, sortiesPerDay)) onChange(); }}>
                  {label}<div style={{ opacity: 0.75 }}>{fmt(price)}</div>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: '6px', opacity: 0.7 }}>{t('Better stock at standing 25 and 60. Or pick a squad and launch an assault: kill the colonel or 80% of the garrison to take everything — and lose them as a trade partner for good. Fail, and they turn hostile.')}</div>
        </>
      ) : (
        <div style={{ marginTop: '6px', color: C.dng }}>
          {t('Hostile. They raid the fort every 5 days. Assault the compound and finish them to make it stop.')}
        </div>
      )}
    </div>
  );
}
