// Sortie objectives, live: what the squad is out there for (primary),
// the jobs from the fort tied to this place, and the optional side
// objective (update/missionExtras.js). Each entry carries a state
// ('active' | 'done' | 'failed') and, when it helps, a short counter.
// Drawn by render/objectives.js; tickObjectives pops a toast when one
// completes or fails mid-sortie.
//
// Rooms swap the street's world fields out (update/rooms.js), so the
// side objective, the garrison and the job people are read from the
// street even while the party is inside.
import { BALANCE } from '../data/difficulty.js';
import { t } from '../i18n/index.js';

export const streetOf = m => (m.room ? m.room.street : m);

export function garrisonOf(m) {
  const troops = (streetOf(m).humans || []).filter(h => h.compact);
  const down = troops.filter(h => h.state === 'dead' || h.hp <= 0).length;
  const voss = troops.some(h => h.colonel && (h.state === 'dead' || h.hp <= 0));
  const need = Math.ceil(troops.length * 0.8);
  return { down, total: troops.length, need, voss, done: voss || (need > 0 && down >= need) };
}

// Infestation the place will have after this sortie (same formula as
// applyCityVisit in data/city.js), for "clear the place" jobs.
function infestAfter(m) {
  const st = streetOf(m);
  const worlds = [st, ...(st.rdoors || []).map(d => d.world).filter(Boolean)];
  const zTotal = Math.max(1, worlds.reduce((n, w) => n + (w.zombies || []).length, 0));
  return Math.max(0.1, (m.dest.infest || 0) - 0.45 * Math.min(1, (m.killedCount || 0) / zTotal));
}

const SIDE_TEXT = { cache: 'Crack the military cache', nest: 'Burn the nest', sos: 'Answer the SOS' };

export function missionObjectives(m, now) {
  const out = [];
  const won = m.state === 'won', over = m.state !== 'active';
  const st = streetOf(m);
  const prim = (id, text, ok, count = null) => out.push({ id, text, count, state: ok ? 'done' : over && !won ? 'failed' : 'active' });

  // Vaccine vial: secured in the hospital, kept on the rooftop.
  const vial = () => {
    const held = m._vaccineCollected && !m._vaccineDropped;
    if (m._vaccineDropped) prim('vial', t('Recover the dropped vial'), false);
    else prim('vial', m._vaccineIndex === 1 ? t('Secure the vaccine sample') : t('Keep the vial safe'), m._vaccineIndex === 1 ? held : held && won);
  };

  if (m.objective === 'defend') {
    let text, count = null;
    if (m.extraction) text = t('Board the extraction');
    else if (m.defendStartedAt) {
      text = m._vaccineCampaign ? t('Hold the rooftop for the chopper') : t('Hold the flag');
      count = `${Math.max(0, Math.ceil((m.defendDuration - (now - m.defendStartedAt)) / 1000))}s`;
    } else text = t('Reach the defend flag');
    prim('main', text, won, count);
    if (m._vaccineCampaign && m._vaccineCollected) vial();
  } else if (m.objective === 'explore') {
    if (m.compactAssault) {
      const g = garrisonOf(m);
      prim('garrison', t('Kill Col. Voss or most of the garrison'), g.done, g.voss ? t('VOSS DOWN') : `${g.down}/${g.need}`);
      prim('main', t('Get back to the van'), won);
    } else prim('main', t('Search the area · back to the van'), won);
  } else {
    if (m._vaccineIndex === 1) vial();
    const need = Math.ceil((m.activatedCount || 0) * BALANCE.missionGoalKillRatio);
    prim('main', m._vaccineIndex === 0 ? t('Break through to the end of Highway 17') : t('Reach the exit'), won,
      need > 0 ? `${Math.min(m.killedCount, need)}/${need}` : null);
  }

  // Jobs from the fort at this place.
  ((m.dest && m.dest.quests) || []).forEach(q => {
    let text, state = 'active', count = null;
    if (q.kind === 'fetch') {
      text = t('Recover the {item}', { item: t(q.item) });
      if ((m.collected.quests || []).includes(q.id)) state = 'done';
    } else if (q.kind === 'rescue') {
      text = t('Bring {person} home', { person: t(q.person) });
      const r = [...(st.rescuables || []), ...(m.room ? m.rescuables || [] : [])].find(x => x.questId === q.id);
      if (r && (r.hp <= 0 || r.state === 'dead')) state = 'failed';
      else if (r && r.state === 'following') state = 'done';
    } else if (q.kind === 'clear' && typeof q.below === 'number' && typeof m.dest.infest === 'number') {
      const now_ = infestAfter(m);
      text = t('Clear the place');
      count = `${Math.round(now_ * 100)}% / <${Math.round(q.below * 100)}%`;
      if (now_ < q.below) state = 'done';
    } else return;
    if (state === 'active' && over && !won) state = 'failed';
    // Items and people only count once they reach the van.
    if (state === 'done' && q.kind !== 'clear' && over && !won) state = 'failed';
    out.push({ id: 'job:' + q.id, job: true, clear: q.kind === 'clear', text, count, state });
  });

  const sd = st.side;
  if (sd && SIDE_TEXT[sd.type]) {
    let count = null;
    if (sd.state === 'active') {
      if (sd.type === 'cache') count = `${Math.round(sd.progress * 100)}%`;
      else if (sd.type === 'nest') count = `${Math.max(0, Math.round((sd.hp / sd.maxHp) * 100))}%`;
      else {
        // The street clock stands still while the party is in a room.
        const at = m.room ? m.room.enteredAt : now;
        count = `${Math.max(0, Math.ceil((sd.timeLimit - (at - (m.startedAt || at))) / 1000))}s`;
      }
    }
    out.push({ id: 'side', side: true, text: t(SIDE_TEXT[sd.type]), count, state: sd.state === 'done' ? 'done' : sd.state === 'failed' ? 'failed' : 'active' });
  }
  return out;
}

// Toast on completion / failure while the sortie is still running.
export function tickObjectives(m, now) {
  if (m.state !== 'active') return;
  const seen = m._objSeen || (m._objSeen = {});
  missionObjectives(m, now).forEach(o => {
    const was = seen[o.id];
    seen[o.id] = o.state;
    // A clear job's estimate moves with every kill and every new pack:
    // no toast for it.
    if (!was || was === o.state || o.state === 'active' || o.clear) return;
    m.objToast = {
      title: o.state === 'failed' ? (o.side ? t('SIDE OBJECTIVE FAILED') : t('OBJECTIVE FAILED'))
        : o.side ? t('SIDE OBJECTIVE COMPLETE') : t('OBJECTIVE COMPLETE'),
      text: o.text, ok: o.state === 'done', at: now,
    };
    if (o.state === 'done') m.soundQ.push({ t: 'pickup', x: m.soldier.x });
  });
}
