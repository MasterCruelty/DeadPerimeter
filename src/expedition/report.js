// After-action reports: per-sortie stats, a grade and per-place records.
//
// Grades come from points (S ≥ 100, A ≥ 80, B ≥ 60, C below):
//   sortie    50 + lead accuracy × 45 (max 30; 15 if the lead never fired)
//             + side objective (+15 done, −5 failed, +8 when there is none)
//             + 8 per job finished here, −20 if the main goal was missed
//               (Compact still standing, vaccine vial lost)
//             + 10 under par time − 15 per soldier lost
//             − share of the party's HP lost × 40 (max 20)
//             A sortie that ends in a wipe is always C.
//   wave      75 + 15 untouched wall, or − wall HP lost as % of max (max 30)
//             − 15 per soldier lost + 10 under par time
//   campaign  mean of the three finale acts (an act never reached counts
//             0, a lost one at most 59) + 10 vaccine delivered / −20 lost
//             − 10 per retry
// Score = points × 10; records keep the best score per city place, the
// Compact assault and the finale ('dp-records' in localStorage).
import { missionObjectives, streetOf } from '../update/objectives.js';
import { t } from '../i18n/index.js';

export const gradeOf = pts => (pts >= 100 ? 'S' : pts >= 80 ? 'A' : pts >= 60 ? 'B' : 'C');
export const GRADE_COL = { S: '#ffd54a', A: '#72bc40', B: '#88ddff', C: '#c8a020' };

export const fmtTime = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ── Sortie tracking (update/mission.js) ─────────────────────────
// Accuracy counts the player-controlled lead only (whoever holds point
// when the shot is fired): followers are AI and would only blur it.
export function startSortieStats(m) {
  const hp = {};
  [m.soldier, ...(m.followers || [])].forEach(p => { if (p) hp[p.id] = p.hp; });
  return { shots: 0, hits: 0, hp };
}
export function trackShot(m, b) {
  if (b._lead !== undefined || !b.src) return;
  b._lead = b.src === m.soldier;
  if (b._lead && m.stats) m.stats.shots++;
}
export function trackHit(m, b) {
  if (b._lead && m.stats) m.stats.hits++;
}

// Par time: walking the map at the lead's pace (150 px/s) plus room to
// fight, search and hold.
function sortiePar(m) {
  const st = streetOf(m);
  const walk = ((st.W || 1900) / 150) * 1000;
  if (m.objective === 'defend') return (m.defendDuration || 60000) + walk * 1.5 + 25000;
  if (m.objective === 'explore') return walk * 4.4 + 45000 + (st.rdoors || []).length * 12000 + (m.compactAssault ? 60000 : 0);
  return walk * 3 + 20000;
}

const lootUnits = c => Object.entries(c || {}).reduce((n, [k, v]) => n + (typeof v === 'number' && k !== 'rescuedCivs' ? v : 0), 0);

// Built once the sortie is over (m is frozen from then on), so the
// end-of-sortie overlay and the result panel read the same numbers.
export function sortieReport(m) {
  if (m._report) return m._report;
  const st = m.stats || { shots: 0, hits: 0, hp: {} };
  const party = [m.soldier, ...(m.followers || [])].filter(Boolean);
  const lost = party.filter(p => p.hp <= 0 || p.state === 'dead').length;
  const pool = party.reduce((n, p) => n + (st.hp[p.id] ?? p.maxHp ?? 100), 0) || 1;
  const dmg = Math.round(party.reduce((n, p) => n + Math.max(0, (st.hp[p.id] ?? p.maxHp ?? 100) - Math.max(0, p.hp)), 0));
  const time = Math.max(0, (m.endedAt || 0) - (m.startedAt || 0));
  const par = sortiePar(m);
  const objs = missionObjectives(m, m.endedAt || 0);
  const side = objs.find(o => o.side) || null;
  const jobs = objs.filter(o => o.job);
  const main = objs.filter(o => !o.side && !o.job);
  const won = m.state === 'won';
  const acc = st.shots > 0 ? st.hits / st.shots : null;
  const pts = 50
    + (acc === null ? 15 : Math.min(30, acc * 45))
    + (side ? (side.state === 'done' ? 15 : side.state === 'failed' ? -5 : 0) : 8)
    + 8 * jobs.filter(j => j.state === 'done').length
    + (won && main.some(o => o.state !== 'done') ? -20 : 0)
    + (won && time <= par ? 10 : 0)
    - 15 * lost
    - Math.min(20, (dmg / pool) * 40);
  const c = m.collected || {};
  m._report = {
    kind: 'sortie', won, pts: Math.round(pts), grade: won ? gradeOf(pts) : 'C',
    score: Math.max(0, Math.round(pts * 10)),
    time, par, shots: st.shots, hits: st.hits, acc,
    kills: m.killedCount || 0, dmg, lost, party: party.length,
    side: side ? side.state : null, jobs: jobs.filter(j => j.state === 'done').length,
    // Loot brought home: resource units + weapons (a wipe brings nothing).
    loot: won ? lootUnits(c) + (Array.isArray(c.gear) ? c.gear.length : 0) : 0,
  };
  return m._report;
}

// ── Records ─────────────────────────────────────────────────────
const REC_KEY = 'dp-records';
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(REC_KEY) || '{}') || {}; } catch { return {}; }
}
export function recordKey(m) {
  if (!m || m._vaccineCampaign) return null;
  if (m.compactAssault) return 'compact';
  return m.dest && m.dest.locId ? 'loc:' + m.dest.locId : null;
}
// Only a finished run can set a record. Returns { best (previous), isNew }.
export function submitRecord(key, rep) {
  if (!key) return null;
  const all = loadRecords();
  const old = all[key] || null;
  if (!rep.won || (old && old.score >= rep.score)) return { best: old, isNew: false };
  all[key] = { score: rep.score, grade: rep.grade };
  try { localStorage.setItem(REC_KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
  return { best: old, isNew: true };
}
export const getRecord = key => (key ? loadRecords()[key] || null : null);

// ── Siege wave (update/siege.js) ────────────────────────────────
export function startWaveStats(gs) {
  const last = (gs.spawnQueue || []).reduce((a, s) => Math.max(a, s.at || 0), 0);
  return {
    wave: gs.wave, wall: gs.baseHp, kills: gs.kills || 0,
    lost: (gs.soldiersLost || 0) + (gs.civiliansLost || 0),
    // Last spawn + the time a walker needs to cross the killing field.
    par: last + 45000,
  };
}
export function waveReport(gs) {
  const s = gs.waveStats || startWaveStats(gs);
  const wallDmg = Math.max(0, Math.round(s.wall - gs.baseHp));
  const lost = Math.max(0, (gs.soldiersLost || 0) + (gs.civiliansLost || 0) - s.lost);
  const time = gs.waveTime || 0;
  const pts = 75
    + (wallDmg === 0 ? 15 : -Math.min(30, (wallDmg / (gs.baseMaxHp || 300)) * 100))
    - 15 * lost
    + (time <= s.par ? 10 : 0);
  return {
    kind: 'wave', wave: gs.wave, won: true, pts: Math.round(pts), grade: gradeOf(pts),
    score: Math.max(0, Math.round(pts * 10)),
    wallDmg, lost, kills: Math.max(0, (gs.kills || 0) - s.kills), time, par: s.par,
  };
}

// ── Vaccine finale (three acts) ─────────────────────────────────
export function recordAct(campaign, m) {
  if (!campaign || !m) return;
  (campaign.acts || (campaign.acts = []))[m._vaccineIndex ?? campaign.currentIndex ?? 0] = sortieReport(m);
}
export function campaignReport(campaign, result) {
  const acts = [0, 1, 2].map(i => (campaign.acts || [])[i] || null);
  const actPts = acts.map(a => (!a ? 0 : a.won ? a.pts : Math.min(59, a.pts)));
  const retries = campaign.retries ?? 0;
  const delivered = !!(result && result.vaccineDelivered);
  const pts = actPts.reduce((a, b) => a + b, 0) / 3 + (delivered ? 10 : -20) - 10 * retries;
  const done = acts.filter(Boolean);
  const rep = {
    kind: 'campaign', won: delivered, pts: Math.round(pts), grade: gradeOf(pts),
    score: Math.max(0, Math.round(pts * 10)),
    acts: acts.map(a => (a ? a.grade : '—')), retries, delivered,
    time: done.reduce((n, a) => n + a.time, 0),
    kills: done.reduce((n, a) => n + a.kills, 0),
    dmg: done.reduce((n, a) => n + a.dmg, 0),
    lost: done.reduce((n, a) => n + a.lost, 0),
    shots: done.reduce((n, a) => n + a.shots, 0),
    hits: done.reduce((n, a) => n + a.hits, 0),
  };
  rep.acc = rep.shots > 0 ? rep.hits / rep.shots : null;
  rep.record = submitRecord('vaccine', rep);
  return rep;
}

// Display rows [label, value], translated at call time.
export function reportRows(r) {
  const pct = r.acc === null || r.acc === undefined ? '—' : `${Math.round(r.acc * 100)}%`;
  const sideTxt = { done: '✔', failed: '✖', active: '—' };
  if (r.kind === 'wave') {
    return [
      [t('Time'), `${fmtTime(r.time)} / ${fmtTime(r.par)}`],
      [t('Wall damage'), r.wallDmg ? `−${r.wallDmg}` : '0'],
      [t('Soldiers lost'), r.lost],
      [t('Kills'), r.kills],
    ];
  }
  if (r.kind === 'campaign') {
    return [
      [t('Acts'), r.acts.join(' · ')],
      [t('Time'), fmtTime(r.time)],
      [t('Kills'), r.kills],
      [t('Accuracy'), pct],
      [t('Damage taken'), r.dmg],
      [t('Soldiers lost'), r.lost],
      [t('Retries'), r.retries],
      [t('Score'), r.score],
    ];
  }
  return [
    [t('Time'), `${fmtTime(r.time)} / ${fmtTime(r.par)}`],
    [t('Kills'), r.kills],
    [t('Accuracy'), r.shots ? `${pct} (${r.hits}/${r.shots})` : pct],
    [t('Damage taken'), r.dmg],
    [t('Soldiers lost'), `${r.lost}/${r.party}`],
    [t('Side objective'), r.side ? sideTxt[r.side] : '—'],
    ...(r.jobs ? [[t('Jobs done'), r.jobs]] : []),
    [t('Loot home'), r.loot || '—'],
    [t('Score'), r.score],
  ];
}
