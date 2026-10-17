// City map for the expedition screen: fixed locations around Fort Omega
// (data/city.js). Discovered places are pins coloured by risk with an
// infestation halo; undiscovered ones are "?" until you scout nearby.
// Clicking a pin selects it; the panel below shows its state today.
import { C } from '../constants.js';
import { MAP_W, MAP_H, FORT_POS, DISTRICTS, LOCATIONS, RISK_COLOR, riskOf } from '../data/city.js';
import { MISSION_CONDS, SIDE_OBJ } from '../data/missionExtras.js';

const ROAD_LINK = 190;

function roads() {
  const pts = [{ id: 'fort', ...FORT_POS }, ...LOCATIONS];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d <= ROAD_LINK || (i === 0 && d <= 200)) out.push([pts[i], pts[j]]);
    }
  }
  return out;
}
const ROADS = roads();

function Bar({ label, value, color }) {
  return (
    <div style={{ fontSize: '9px', color: C.txt, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
      <span style={{ width: '74px', opacity: 0.8 }}>{label}</span>
      <div style={{ flex: 1, height: '6px', background: '#141612', border: `1px solid ${C.uib}` }}>
        <div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height: '100%', background: color }} />
      </div>
      <span style={{ width: '30px', textAlign: 'right' }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function CityMap({ city, dests, selected, onPick, day, jobs = [] }) {
  const byId = Object.fromEntries(dests.map((d, i) => [d.locId, i]));
  const sel = selected !== null && selected !== undefined ? dests[selected] : null;
  return (
    <div>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: '100%', display: 'block', background: '#0b0f0a', border: `1px solid ${C.uib}` }}>
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="rgba(114,188,64,0.06)" strokeWidth="1" />
          </pattern>
          <radialGradient id="halo">
            <stop offset="0%" stopColor="rgba(220,40,30,0.55)" />
            <stop offset="100%" stopColor="rgba(220,40,30,0)" />
          </radialGradient>
        </defs>
        <rect width={MAP_W} height={MAP_H} fill="url(#grid)" />
        {/* River */}
        <path d={`M ${MAP_W - 40} 0 C ${MAP_W - 120} 120, ${MAP_W - 10} 220, ${MAP_W - 90} ${MAP_H}`} stroke="rgba(60,110,150,0.35)" strokeWidth="18" fill="none" />
        {DISTRICTS.map(d => (
          <g key={d.id}>
            <rect x={d.x} y={d.y} width={d.w} height={d.h} fill={d.tint} stroke="rgba(184,204,170,0.12)" strokeDasharray="4 4" rx="6" />
            <text x={d.x + 8} y={d.y + 14} fill="rgba(184,204,170,0.4)" fontSize="10" fontFamily="monospace" letterSpacing="2">{d.name}</text>
          </g>
        ))}
        {ROADS.map(([a, b], i) => {
          const known = (a.id === 'fort' || city.locs[a.id]?.discovered) && (b.id === 'fort' || city.locs[b.id]?.discovered);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={known ? 'rgba(160,150,120,0.35)' : 'rgba(160,150,120,0.1)'} strokeWidth={known ? 3 : 2} strokeDasharray={known ? '' : '3 5'} />;
        })}
        {/* Fort Omega */}
        <g>
          <rect x={FORT_POS.x - 16} y={FORT_POS.y - 12} width="32" height="24" fill="#1a2a12" stroke={C.acc} strokeWidth="2" />
          <text x={FORT_POS.x} y={FORT_POS.y + 5} textAnchor="middle" fontSize="13">★</text>
          <text x={FORT_POS.x} y={FORT_POS.y + 26} textAnchor="middle" fill={C.acc} fontSize="9" fontFamily="monospace" fontWeight="bold">FORT OMEGA</text>
        </g>
        {LOCATIONS.map(l => {
          const st = city.locs[l.id];
          if (!st || !st.discovered) {
            return (
              <g key={l.id}>
                <circle cx={l.x} cy={l.y} r="10" fill="#141612" stroke="rgba(184,204,170,0.25)" strokeDasharray="2 2" />
                <text x={l.x} y={l.y + 4} textAnchor="middle" fill="rgba(184,204,170,0.4)" fontSize="11" fontFamily="monospace">?</text>
              </g>
            );
          }
          const i = byId[l.id], risk = riskOf(st.infest), isSel = selected === i;
          return (
            <g key={l.id} onClick={() => onPick(i)} style={{ cursor: 'pointer' }}>
              <circle cx={l.x} cy={l.y} r={14 + st.infest * 22} fill="url(#halo)" opacity={0.35 + st.infest * 0.5} />
              {isSel && <circle cx={l.x} cy={l.y} r="19" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="4 3" />}
              <circle cx={l.x} cy={l.y} r="13" fill="#10140e" stroke={RISK_COLOR[risk]} strokeWidth={isSel ? 3 : 2} />
              <text x={l.x} y={l.y + 5} textAnchor="middle" fontSize="13">{l.icon}</text>
              <rect x={l.x - 13} y={l.y + 16} width="26" height="3" fill="#141612" />
              <rect x={l.x - 13} y={l.y + 16} width={26 * st.loot} height="3" fill="#88ddff" />
              <text x={l.x} y={l.y + 30} textAnchor="middle" fill={isSel ? '#fff' : 'rgba(220,230,210,0.8)'} fontSize="9" fontFamily="monospace">{l.name}</text>
              {st.visits > 0 && <text x={l.x + 14} y={l.y - 9} fontSize="9" fill="#88ee99" fontFamily="monospace">✓</text>}
              {jobs.some(j => j.loc === l.id) && (
                <g>
                  <circle cx={l.x - 14} cy={l.y - 12} r="7" fill="#ffd54a" stroke="#3a2a08" strokeWidth="1.5" />
                  <text x={l.x - 14} y={l.y - 8.5} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#2a1a00" fontFamily="monospace">!</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: '12px', fontSize: '8px', color: 'rgba(184,204,170,0.7)', marginTop: '3px', flexWrap: 'wrap' }}>
        <span>● ring = risk</span><span style={{ color: '#dd5544' }}>◉ red halo = infestation</span><span style={{ color: '#88ddff' }}>▬ blue bar = loot left</span><span>? = unexplored (scout nearby to reveal)</span>
      </div>
      {sel ? (
        <div style={{ marginTop: '6px', background: 'rgba(8,16,8,0.85)', border: `1px solid ${sel.riskColor}`, padding: '8px 12px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ color: C.acc, fontWeight: 'bold', fontSize: '12px' }}>{sel.icon} {sel.name}</div>
            <div style={{ fontSize: '9px', color: sel.riskColor, fontWeight: 'bold', marginTop: '2px' }}>
              RISK: {sel.risk} · {({ S: 'small', M: 'medium', L: 'large' })[sel.size]} area · {sel.visits ? `visited ${sel.visits}× (day ${sel.lastDay})` : 'never visited'}
            </div>
            <div style={{ color: C.txt, fontSize: '9px', marginTop: '4px', lineHeight: '1.4' }}>{sel.desc}</div>
            <div style={{ color: '#88ddff', fontSize: '9px', marginTop: '3px' }}>{sel.rewards}</div>
            <Bar label="Infestation" value={sel.infest / 1.2} color="#cc4433" />
            <Bar label="Loot left" value={sel.lootLeft} color="#88ddff" />
            <div style={{ fontSize: '9px', color: C.wrn, marginTop: '4px' }}>Travel: −{sel.travel} 🥫 per soldier{sel.slots > 1 ? ' · ⏱ takes the whole day (2 sorties)' : ' · ⏱ half a day'}</div>
          </div>
          <div style={{ flex: '1 1 220px', fontSize: '9px' }}>
            <div style={{ color: 'rgba(184,204,170,0.6)' }}>TODAY (DAY {day})</div>
            {sel.cond && MISSION_CONDS[sel.cond] ? (
              <div style={{ color: MISSION_CONDS[sel.cond].color, fontWeight: 'bold', marginTop: '3px' }}>
                {MISSION_CONDS[sel.cond].icon} {MISSION_CONDS[sel.cond].name}
                <div style={{ fontWeight: 'normal', color: C.txt, opacity: 0.85 }}>{MISSION_CONDS[sel.cond].desc}</div>
              </div>
            ) : <div style={{ color: C.txt, opacity: 0.6, marginTop: '3px' }}>No special conditions.</div>}
            {sel.side && SIDE_OBJ[sel.side] && (
              <div style={{ color: '#ffd54a', marginTop: '5px' }}>
                <b>★ SIDE: {SIDE_OBJ[sel.side].icon} {SIDE_OBJ[sel.side].name}</b> {SIDE_OBJ[sel.side].reward}
                <div style={{ color: C.txt, opacity: 0.85 }}>{SIDE_OBJ[sel.side].desc}</div>
              </div>
            )}
            {jobs.filter(j => j.loc === sel.locId).map(j => (
              <div key={j.id} style={{ color: '#ffd54a', marginTop: '5px' }}>
                <b>📋 JOB: {j.title}</b>
                <div style={{ color: C.txt, opacity: 0.85 }}>{j.kind === 'fetch' ? `Recover the ${j.item} (upper floor of a building).` : j.kind === 'rescue' ? `Find ${j.person} and walk them back to the van.` : `Clear it out: infestation below ${Math.round(j.below * 100)}%.`}</div>
              </div>
            ))}
            <div style={{ color: 'rgba(184,204,170,0.6)', marginTop: '6px', lineHeight: '1.4' }}>
              Explore the street and its buildings, loot what you can and walk back to the van to leave. What you take stays taken.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: '6px', fontSize: '10px', color: 'rgba(184,204,170,0.6)' }}>Select a location on the map.</div>
      )}
    </div>
  );
}
