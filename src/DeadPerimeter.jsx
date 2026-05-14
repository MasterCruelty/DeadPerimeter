import { useState, useEffect, useRef, useCallback } from 'react';

import { C, CW, CH, WX, laneY, clickToLane, rng } from './constants.js';
import { WPN } from './data/weapons.js';
import { EXPEDITION_DESTS, RECRUIT_NAMES, RECRUIT_WEAPONS } from './data/expeditions.js';
import { isHumanWaveNumber } from './data/humans.js';

import { getAM, processSounds } from './audio/AudioEngine.js';

import { mkSoldier } from './entities/soldier.js';
import { mkBarricade } from './entities/barricade.js';
import { mkTurret } from './entities/turret.js';
import { mkWave, mkHumanWave } from './entities/wave.js';
import { mkGS } from './entities/gameState.js';
import { hasSavedGame, saveGame, loadGame, clearSave } from './entities/persistence.js';
import { BALANCE } from './data/difficulty.js';

import { dBg } from './render/background.js';
import { dBase } from './render/base.js';
import { dSoldier } from './render/soldier.js';
import { dZombie } from './render/zombie.js';
import { dHuman } from './render/human.js';
import { dBarricade, dBlt, dFx } from './render/effects.js';
import { dTurret } from './render/turret.js';
import { dSquadMarker, dHUD } from './render/hud.js';

import { update } from './update/siege.js';
import { mkMission, updateMission, dMissionWorld, dMissionHUD } from './update/mission.js';

import { resolveExpedition, resolvePartyExpedition } from './expedition/auto.js';
import { finishMission } from './expedition/missionFinish.js';
import { genEvents } from './expedition/events.js';

export default function DeadPerimeter() {
  const cvs = useRef(null), gsRef = useRef(null), rafId = useRef(null), prevT = useRef(0), mutedR = useRef(false);
  const missionRef = useRef(null);
  const inputRef = useRef({ left: false, right: false, shoot: false });
  const pausedRef = useRef(false);
  const [scr, setScr] = useState('menu'), [ui, setUi] = useState(null), [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hasSave, setHasSave] = useState(false);
  const [, setMissionTick] = useState(0);
  // Multi-soldier picker: an array of soldier indices (max BALANCE.maxExpeditionParty)
  const [expSoldierIdxs, setExpSoldierIdxs] = useState([]);
  const [expDestIdx, setExpDestIdx] = useState(null);
  const [expResult, setExpResult] = useState(null);
  const [expPhase, setExpPhase] = useState(null);
  const [expEvents, setExpEvents] = useState([]);
  const [expVisible, setExpVisible] = useState(0);
  const expSolsRef = useRef([]);
  const expDstRef = useRef(null);
  const toggleSoldier = useCallback(i => {
    const cur = expSolsRef.current;
    if (cur.includes(i)) {
      expSolsRef.current = cur.filter(x => x !== i);
    } else if (cur.length < BALANCE.maxExpeditionParty) {
      expSolsRef.current = [...cur, i];
    } else {
      return;
    }
    setExpSoldierIdxs([...expSolsRef.current]);
  }, []);
  const pickDest = useCallback(i => { expDstRef.current = i; setExpDestIdx(i); }, []);

  const toggleMute = useCallback(() => {
    const am = getAM();
    const n = !mutedR.current;
    mutedR.current = n; setMuted(n);
    if (am) am.mute(n);
  }, []);

  const togglePause = useCallback(() => {
    const n = !pausedRef.current;
    pausedRef.current = n; setPaused(n);
    const am = getAM();
    if (am) { if (n) am.stopBg(); else if (!mutedR.current) am.startBg(); }
  }, []);

  // Detect existing save on mount
  useEffect(() => { setHasSave(hasSavedGame()); }, []);

  // Expedition animation ticker
  useEffect(() => {
    if (expPhase !== 'running') return;
    if (expVisible >= expEvents.length) {
      const to = setTimeout(() => setExpPhase('done'), 600);
      return () => clearTimeout(to);
    }
    const delay = expEvents[expVisible]?.delay || 1000;
    const to = setTimeout(() => setExpVisible(v => v + 1), delay);
    return () => clearTimeout(to);
  }, [expPhase, expVisible, expEvents]);

  const newGame = useCallback(() => {
    const am = getAM(); if (am) am.resume();
    clearSave();
    const gs = mkGS();
    gs.soldiers.forEach(s => { s.ammo = WPN[s.weapon].ammo; gs.resources.ammo -= WPN[s.weapon].ammoCost; });
    gsRef.current = gs; setUi({ ...gs }); setScr('management');
    setHasSave(false);
  }, []);

  const continueGame = useCallback(() => {
    const am = getAM(); if (am) am.resume();
    const gs = loadGame(mkGS);
    if (!gs) return;
    gsRef.current = gs; setUi({ ...gs }); setScr('management');
  }, []);

  const startWave = useCallback(() => {
    const gs = gsRef.current;
    const am = getAM(); if (am && !mutedR.current) am.startBg();
    gs.soldiers.forEach(s => {
      if (s.state === 'dead' || s.onExpedition) return;
      if (s.onRoof) {
        const need = s.maxAmmo - s.ammo;
        if (need > 0 && (gs.resources.sniperAmmo || 0) > 0) {
          const give = Math.min(need, gs.resources.sniperAmmo);
          gs.resources.sniperAmmo -= give; s.ammo += give;
        }
        return;
      }
      const need = s.maxAmmo - s.ammo;
      if (need > 0) { const give = Math.min(need, gs.resources.ammo); gs.resources.ammo -= give; s.ammo += give; }
    });
    // Decide whether this is a human wave
    gs.isHumanWave = isHumanWaveNumber(gs.wave);
    gs.spawnQueue = gs.isHumanWave ? mkHumanWave(gs.wave) : mkWave(gs.wave);
    gs.phase = 'siege';
    gs.waveTime = 0;
    gs.waveClearAt = null; gs.waveComplete = false;
    gs.zombies = gs.zombies.filter(z => z.state === 'dead');
    gs.humans = [];
    gs.bullets = []; gs.effects = []; gs.soundQ = [];
    gs.zombiesSpawned = 0;
    gs.squadTarget = null; gs.squadLane = null; gs.selectedSoldierId = null;
    const ground = gs.soldiers.filter(s => s.state !== 'dead' && !s.onExpedition && !s.onRoof);
    ground.forEach((s, i) => { s.x = WX + 20; s.state = 'walk'; s.facing = 1; s.destX = 224 + i * 24; s.reloadTriggered = false; });
    gs.soldiers.filter(s => s.onRoof && s.state !== 'dead').forEach(s => { s.x = WX - 40; s.state = 'idle'; s.facing = 1; s.reloadTriggered = false; });
    setScr('siege'); setExpResult(null);
  }, []);

  const sendExpedition = useCallback(() => {
    const idxs = expSolsRef.current, di = expDstRef.current;
    if (!idxs || idxs.length === 0 || di === null) return;
    const gs = gsRef.current;
    if ((gs.expeditionsToday || 0) >= BALANCE.expeditionsPerDay) return;
    const soldiers = idxs.map(i => gs.soldiers[i]).filter(s => s && s.state !== 'dead');
    if (soldiers.length === 0) return;
    const dest = EXPEDITION_DESTS[di];

    const result = soldiers.length === 1
      ? resolveExpedition(soldiers[0], dest, gs)
      : resolvePartyExpedition(soldiers, dest, gs);

    if (result.reward.ammo)       gs.resources.ammo       = Math.min(999, gs.resources.ammo + result.reward.ammo);
    if (result.reward.medicine)   gs.resources.medicine   = Math.min(999, gs.resources.medicine + result.reward.medicine);
    if (result.reward.food)       gs.resources.food       = Math.min(999, gs.resources.food + result.reward.food);
    if (result.reward.materials)  gs.resources.materials  = Math.min(999, gs.resources.materials + result.reward.materials);
    if (result.reward.sniperAmmo) gs.resources.sniperAmmo = Math.min(99,  (gs.resources.sniperAmmo || 0) + result.reward.sniperAmmo);

    if (result.recruit) {
      const r = result.recruit;
      const activeCount = gs.soldiers.filter(s => s.state !== 'dead').length;
      if (activeCount < BALANCE.maxActiveSoldiers) {
        const ns = mkSoldier(r.name, r.weapon, 270, r.hp, Math.floor(Math.random() * 3), true);
        ns.ammo = 0; gs.soldiers.push(ns);
      } else if ((gs.reserve?.length || 0) < BALANCE.maxReserveSoldiers) {
        gs.reserve = gs.reserve || [];
        gs.reserve.push({ name: r.name, weapon: r.weapon, civilian: true, hp: r.hp });
      }
    }

    gs.expeditionsToday = (gs.expeditionsToday || 0) + 1;

    // Use the (single) soldier's narrative log; for a party we use the first.
    const lead = soldiers[0];
    const events = genEvents(lead.name, dest, result.outcome, result.dmgTaken, result.recruit);
    if (result.party && result.party.length > 1) {
      events.unshift({ icon: '🛡', text: `Party of ${result.party.length}: ${result.soldierNames.join(', ')}.`, delay: 700, col: C.acc });
      if (result.kiaNames && result.kiaNames.length > 0) {
        events.push({ icon: '💀', text: `Lost in action: ${result.kiaNames.join(', ')}.`, delay: 1200, col: C.dng });
      }
    }
    setExpEvents(events); setExpVisible(0); setExpResult(result); setExpPhase('running');
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  const playMission = useCallback(() => {
    const idxs = expSolsRef.current, di = expDstRef.current;
    if (!idxs || idxs.length === 0 || di === null) return;
    const gs = gsRef.current;
    if ((gs.expeditionsToday || 0) >= BALANCE.expeditionsPerDay) return;
    const si = idxs[0]; // playable mission is single-soldier
    const soldier = gs.soldiers[si];
    if (!soldier || soldier.state === 'dead') return;
    const dest = EXPEDITION_DESTS[di];

    // Issue ammo from Fort Omega's pool, capped at the magazine size.
    const isSniper = soldier.weapon === 'sniper';
    const poolKey = isSniper ? 'sniperAmmo' : 'ammo';
    const want = Math.max(0, soldier.maxAmmo - (soldier.ammo || 0));
    const give = Math.min(want, gs.resources[poolKey] || 0);
    gs.resources[poolKey] = (gs.resources[poolKey] || 0) - give;
    soldier.ammo = (soldier.ammo || 0) + give;

    const m = mkMission(soldier, dest);
    m._poolKey = poolKey;
    soldier.onExpedition = true;
    missionRef.current = m;
    inputRef.current = { left: false, right: false, shoot: false };
    gs.expeditionsToday = (gs.expeditionsToday || 0) + 1;
    setScr('mission');
  }, []);

  const finalizeMission = useCallback(() => {
    const m = missionRef.current; if (!m) return;
    const gs = gsRef.current;
    const soldier = gs.soldiers.find(s => s.id === m.origSoldier.id);
    if (soldier) soldier.onExpedition = false;
    const result = finishMission(m, gs);
    missionRef.current = null;
    setExpResult(result); setExpPhase('done'); setExpEvents([]); setExpVisible(0);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
    setScr('expedition');
  }, []);

  const recruit = useCallback(() => {
    const gs = gsRef.current;
    if (gs.resources.food < 20 || gs.resources.materials < 15 || gs.soldiers.filter(s => s.state !== 'dead').length >= 6) return;
    gs.resources.food -= 20; gs.resources.materials -= 15;
    const avail = RECRUIT_NAMES.filter(n => !gs.usedNames.has(n));
    if (!avail.length) return;
    const name = avail[Math.floor(Math.random() * avail.length)];
    const weapon = RECRUIT_WEAPONS[Math.floor(Math.random() * RECRUIT_WEAPONS.length)];
    gs.usedNames.add(name);
    const ns = mkSoldier(name, weapon, 270, 100, Math.floor(Math.random() * 3));
    ns.ammo = 0; gs.soldiers.push(ns);
    saveGame(gs); setHasSave(true);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  const buildBarricade = useCallback(() => {
    const gs = gsRef.current;
    if (gs.resources.materials < 15 || gs.barricades.length >= BALANCE.maxBarricades) return;
    gs.resources.materials -= 15;
    const x = WX + 160 + rng(0, 3) * 70;
    gs.barricades.push(mkBarricade(x));
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
  }, []);

  const buildTurret = useCallback(() => {
    const gs = gsRef.current;
    if (
      gs.resources.materials < BALANCE.turretCostMaterials ||
      gs.resources.ammo < BALANCE.turretCostAmmo ||
      (gs.turrets?.length || 0) >= BALANCE.maxTurrets
    ) return;
    gs.resources.materials -= BALANCE.turretCostMaterials;
    gs.resources.ammo      -= BALANCE.turretCostAmmo;
    gs.turrets = gs.turrets || [];
    gs.turrets.push(mkTurret(gs.turrets.length));
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
  }, []);

  const healSoldier = useCallback(idx => {
    const gs = gsRef.current;
    if (gs.resources.medicine < 5) return;
    const s = gs.soldiers[idx]; if (!s || s.state === 'dead') return;
    gs.resources.medicine -= 5;
    s.hp = Math.min(s.maxHp, s.hp + 40);
    saveGame(gs); setHasSave(true);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  const moveSquad = useCallback(dir => {
    const gs = gsRef.current; if (!gs || gs.phase !== 'siege') return;
    const cur = gs.squadTarget ?? 270;
    gs.squadTarget = dir === 'retreat' ? Math.max(WX + 40, cur - 80) : Math.min(CW - 80, cur + 80);
    const movables = gs.selectedSoldierId
      ? gs.soldiers.filter(s => s.id === gs.selectedSoldierId && s.state !== 'dead' && !s.onExpedition && !s.onRoof && s.state !== 'reload')
      : gs.soldiers.filter(s => s.state !== 'dead' && !s.onExpedition && !s.onRoof && s.state !== 'reload');
    movables.forEach((s, i) => {
      s.destX = Math.max(WX + 35, Math.min(CW - 70, gs.squadTarget + (i - 1) * 22));
      s.state = 'walk';
    });
  }, []);

  // Poll mission state to trigger re-render of UI buttons
  useEffect(() => {
    if (scr !== 'mission') return;
    const id = setInterval(() => {
      const m = missionRef.current;
      if (m && m.state !== 'active') setMissionTick(t => t + 1);
    }, 200);
    return () => clearInterval(id);
  }, [scr]);

  // ── GAME LOOP ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = cvs.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const onClick = e => {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (CW / r.width), my = (e.clientY - r.top) * (CH / r.height);
      if (mx > 850 && mx < 892 && my > 4 && my < 34) { toggleMute(); return; }
      const gs = gsRef.current;
      if (!gs || gs.phase !== 'siege' || my <= 38) return;

      const clickedSol = gs.soldiers.find(s => {
        if (s.state === 'dead' || s.onExpedition || s.onRoof) return false;
        const sly = laneY(s.lane);
        return Math.abs(s.x - mx) < 22 && my > sly - 58 && my < sly + 10;
      });
      if (clickedSol) {
        gs.selectedSoldierId = (gs.selectedSoldierId === clickedSol.id) ? null : clickedSol.id;
        return;
      }

      if (mx > WX + 40) {
        const clickedLane = clickToLane(my);
        const targetX = Math.max(WX + 40, Math.min(CW - 80, mx));
        if (gs.selectedSoldierId !== null) {
          const s = gs.soldiers.find(s => s.id === gs.selectedSoldierId);
          if (s && s.state !== 'dead' && !s.onExpedition && !s.onRoof && s.state !== 'reload') {
            s.lane = clickedLane; s.destX = targetX; s.state = 'walk';
          }
          gs.squadTarget = targetX; gs.squadLane = clickedLane;
        } else {
          gs.squadTarget = targetX; gs.squadLane = clickedLane;
          gs.soldiers.forEach((s, i) => {
            if (s.state === 'dead' || s.onExpedition || s.onRoof || s.state === 'reload') return;
            s.lane = clickedLane;
            s.destX = Math.max(WX + 35, Math.min(CW - 70, targetX + (i - 1) * 22));
            s.state = 'walk';
          });
        }
      }
    };

    const onKeyDown = e => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        // Pause/resume only during siege. Missions and menus ignore Esc.
        const gs = gsRef.current;
        if (gs && gs.phase === 'siege' && !missionRef.current) {
          togglePause(); e.preventDefault();
        }
        return;
      }
      if (missionRef.current && missionRef.current.state === 'active') {
        if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') { inputRef.current.left = true;  e.preventDefault(); }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { inputRef.current.right = true; e.preventDefault(); }
        if (e.key === ' ' || e.key === 'Spacebar') { inputRef.current.shoot = true; e.preventDefault(); }
      }
    };
    const onKeyUp = e => {
      if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') inputRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') inputRef.current.right = false;
      if (e.key === ' ' || e.key === 'Spacebar') inputRef.current.shoot = false;
    };
    const onMouseDown = e => {
      if (missionRef.current && missionRef.current.state === 'active') {
        const r = canvas.getBoundingClientRect();
        const my = (e.clientY - r.top) * (CH / r.height);
        if (my > 40) inputRef.current.shoot = true;
      }
    };
    const onMouseUp = () => { inputRef.current.shoot = false; };

    // Mobile touch: tap on canvas in siege = click; in mission =
    // shoot while held + half-screen virtual D-pad.
    const onTouchStart = e => {
      if (missionRef.current && missionRef.current.state === 'active') {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        for (const t of e.changedTouches) {
          const tx = (t.clientX - r.left) * (CW / r.width);
          const ty = (t.clientY - r.top) * (CH / r.height);
          if (ty < 40) continue;
          if (tx < CW * 0.33) inputRef.current.left = true;
          else if (tx > CW * 0.66) inputRef.current.right = true;
          else inputRef.current.shoot = true;
        }
        return;
      }
      // Siege / other phases: translate to a synthetic click on touch start
      const gs = gsRef.current;
      if (gs && gs.phase === 'siege') {
        e.preventDefault();
        const t = e.changedTouches[0]; if (!t) return;
        onClick({ clientX: t.clientX, clientY: t.clientY });
      }
    };
    const onTouchEnd = e => {
      if (missionRef.current && missionRef.current.state === 'active') {
        e.preventDefault();
        // Clear all inputs when last touch lifts (simple model).
        if (e.touches.length === 0) {
          inputRef.current.left = false;
          inputRef.current.right = false;
          inputRef.current.shoot = false;
        }
      }
    };

    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const mkSnap = gs => ({
      phase: gs.phase, day: gs.day, wave: gs.wave, baseHp: gs.baseHp, baseMaxHp: gs.baseMaxHp,
      resources: { ...gs.resources },
      soldiers: gs.soldiers.map(s => ({ ...s })),
      barricades: gs.barricades.map(b => ({ ...b })),
      turrets: (gs.turrets || []).map(t => ({ ...t })),
      reserve: (gs.reserve || []).map(r => ({ ...r })),
      kills: gs.kills, score: gs.score,
      isHumanWave: gs.isHumanWave,
      expeditionsToday: gs.expeditionsToday || 0,
      lastEvacWave: gs.lastEvacWave ?? -10,
    });

    const loop = now => {
      const dt = Math.min(now - prevT.current, 50); prevT.current = now;
      const gs = gsRef.current;

      const m = missionRef.current;
      if (m) {
        m.inputLeft  = inputRef.current.left;
        m.inputRight = inputRef.current.right;
        m.inputShoot = inputRef.current.shoot;
        updateMission(m, now, dt);
        processSounds(m.soundQ, getAM(), mutedR);
        ctx.save(); ctx.clearRect(0, 0, CW, CH);
        dMissionWorld(ctx, m, now);
        dMissionHUD(ctx, m, now);
        ctx.restore();
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      if (gs && gs.phase === 'siege') {
        if (!pausedRef.current) {
          update(gs, now, dt);
          processSounds(gs.soundQ, getAM(), mutedR);
        }
        if (gs.phase !== 'siege') {
          const am = getAM(); if (am) am.stopBg();
          // Auto-save whenever we transition to management or gameover
          if (gs.phase === 'management') saveGame(gs);
          else if (gs.phase === 'gameover') clearSave();
          setHasSave(hasSavedGame());
          setUi(mkSnap(gs));
          setScr(gs.phase);
        } else {
          ctx.save(); ctx.clearRect(0, 0, CW, CH);
          if (gs.shakeTimer > 0) ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3);
          dBg(ctx); dBase(ctx, gs.baseHp, gs.baseMaxHp);
          for (let lane = 2; lane >= 0; lane--) {
            gs.zombies.filter(z => z.state === 'dead' && z.lane === lane).forEach(z => dZombie(ctx, z, now));
            gs.zombies.filter(z => z.state !== 'dead' && z.lane === lane).forEach(z => dZombie(ctx, z, now));
            gs.humans.filter(h => h.state === 'dead' && h.lane === lane).forEach(h => dHuman(ctx, h, now));
            gs.humans.filter(h => h.state !== 'dead' && h.lane === lane).forEach(h => dHuman(ctx, h, now));
            gs.soldiers.filter(s => (s.lane || 0) === lane && !s.onExpedition).forEach(s => dSoldier(ctx, s, now, s.id === gs.selectedSoldierId));
            if (lane === 2) gs.barricades.forEach(b => dBarricade(ctx, b));
          }
          (gs.turrets || []).forEach(t => dTurret(ctx, t, now));
          gs.effects.forEach(e => dFx(ctx, e, now));
          gs.bullets.forEach(b => dBlt(ctx, b));
          dSquadMarker(ctx, gs.squadTarget, gs.squadLane, now);
          dHUD(ctx, gs, now, mutedR.current);
          if (pausedRef.current) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, CW, CH);
            ctx.fillStyle = C.acc; ctx.font = 'bold 32px monospace'; ctx.textAlign = 'center';
            ctx.fillText('⏸ PAUSED', CW / 2, CH / 2 - 6);
            ctx.fillStyle = C.txt; ctx.font = '12px monospace';
            ctx.fillText('press Esc to resume', CW / 2, CH / 2 + 22);
            ctx.textAlign = 'left';
          }
          ctx.restore();
          if (Math.floor(now / 250) !== Math.floor((now - dt) / 250)) setUi(mkSnap(gs));
        }
      }
      rafId.current = requestAnimationFrame(loop);
    };
    rafId.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId.current);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [toggleMute, togglePause]);

  // ── STYLES ───────────────────────────────────────────────────
  const F = "'Courier New',monospace";
  const wrap = { background: '#030504', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: F, color: C.txt };
  const panel = { background: C.ui, border: `1px solid ${C.uib}`, padding: '26px 34px', maxWidth: '820px', width: '94%' };
  const btn = (bg = '#243e12', bd) => ({ background: bg, border: `1px solid ${bd ?? C.acc}`, color: '#e8f0e0', padding: '8px 18px', cursor: 'pointer', fontFamily: F, fontSize: '12px', fontWeight: 'bold', letterSpacing: '.05em', marginRight: '6px', marginTop: '4px' });
  const ctrlBtn = { background: '#162210', border: `1px solid ${C.uib}`, color: C.acc, padding: '7px 14px', cursor: 'pointer', fontFamily: F, fontSize: '12px', fontWeight: 'bold' };
  const mbtn = { background: '#1a2a12', border: `1px solid ${C.uib}`, color: C.txt, padding: '5px 12px', cursor: 'pointer', fontFamily: F, fontSize: '11px' };
  const h1 = { color: C.acc, fontSize: '24px', fontWeight: 'bold', letterSpacing: '.1em', margin: 0 };
  const h2 = { color: C.acc, fontSize: '12px', fontWeight: 'bold', letterSpacing: '.05em', marginBottom: '7px', marginTop: '16px' };
  const hr = { borderTop: `1px solid ${C.uib}`, borderBottom: 'none', margin: '12px 0' };
  const card = { background: 'rgba(18,30,12,0.9)', border: `1px solid ${C.uib}`, padding: '7px 11px', minWidth: '110px' };
  const row = { display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '5px' };
  const lbl = { color: C.txt, fontSize: '9px', opacity: 0.6, display: 'block', marginBottom: '2px', letterSpacing: '.04em' };
  const val = { color: C.acc, fontSize: '17px', fontWeight: 'bold' };

  const gs = ui || gsRef.current;
  const aliveSols = gs?.soldiers?.filter(s => s.state !== 'dead' && !s.onExpedition) || [];
  const canRecruit  = gs && gs.resources.food >= 20 && gs.resources.materials >= 15 && gs.soldiers.filter(s => s.state !== 'dead').length < BALANCE.maxActiveSoldiers;
  const canBarricadeFlag = gs && gs.resources.materials >= 15 && (gs.barricades?.length || 0) < BALANCE.maxBarricades;
  const canTurret = gs &&
    gs.resources.materials >= BALANCE.turretCostMaterials &&
    gs.resources.ammo      >= BALANCE.turretCostAmmo &&
    (gs.turrets?.length || 0) < BALANCE.maxTurrets;
  const reserveCount = gs?.reserve?.length || 0;
  const turretCount = gs?.turrets?.length || 0;
  const nextWaveIsHuman = gs && isHumanWaveNumber(gs.wave);

  const resetExp = () => {
    setExpResult(null); setExpPhase(null); setExpEvents([]); setExpVisible(0);
    expSolsRef.current = []; expDstRef.current = null;
    setExpSoldierIdxs([]); setExpDestIdx(null);
  };

  const sortiesLeft = gs ? BALANCE.expeditionsPerDay - (gs.expeditionsToday || 0) : 0;
  const canSortie = sortiesLeft > 0;
  const partyValid = expSoldierIdxs.length > 0 && expSoldierIdxs.length <= BALANCE.maxExpeditionParty;

  const ExpeditionScreen = (
    <div style={wrap}>
      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={h1}>🗺 EXPEDITION</div>
            <div style={{ color: C.txt, opacity: 0.5, fontSize: '10px', marginTop: '3px' }}>
              DAY {gs?.day} — {sortiesLeft}/{BALANCE.expeditionsPerDay} sorties left before nightfall
            </div>
          </div>
          <div style={{ color: C.dng, fontWeight: 'bold', fontSize: '20px' }}>WAVE #{gs?.wave}</div>
        </div>
        <hr style={hr} />

        {expPhase === null && (
          <>
            <div style={h2}>CHOOSE PARTY (max {BALANCE.maxExpeditionParty})</div>
            <div style={row}>{gs?.soldiers?.map((s, i) => {
              if (s.state === 'dead') return null;
              const picked = expSoldierIdxs.includes(i);
              const order = picked ? expSoldierIdxs.indexOf(i) + 1 : null;
              return (
                <div key={s.id} onClick={() => toggleSoldier(i)} style={{ ...card, cursor: 'pointer', borderColor: picked ? C.acc : C.uib, opacity: picked ? 1 : 0.7, position: 'relative' }}>
                  {order && <div style={{ position: 'absolute', top: 4, right: 6, background: C.acc, color: '#0a0', fontSize: '9px', fontWeight: 'bold', borderRadius: '50%', width: '14px', height: '14px', textAlign: 'center', lineHeight: '14px' }}>{order}</div>}
                  <div style={{ color: C.acc, fontWeight: 'bold', fontSize: '11px' }}>{s.name}</div>
                  <div style={{ fontSize: '9px', color: C.txt }}>{WPN[s.weapon]?.name}</div>
                  <div style={{ fontSize: '9px', color: s.hp > 60 ? C.acc : s.hp > 30 ? C.wrn : C.dng }}>{s.hp}HP</div>
                </div>
              );
            })}</div>
            <div style={h2}>CHOOSE DESTINATION</div>
            <div style={row}>{EXPEDITION_DESTS.map((d, i) => (
              <div key={i} onClick={() => pickDest(i)} style={{ ...card, cursor: 'pointer', flex: 1, borderColor: expDestIdx === i ? d.riskColor : C.uib, opacity: expDestIdx === i ? 1 : 0.72 }}>
                <div style={{ fontSize: '17px', marginBottom: '2px' }}>{d.icon}</div>
                <div style={{ color: C.acc, fontWeight: 'bold', fontSize: '10px' }}>{d.name}</div>
                <div style={{ color: d.riskColor, fontSize: '8px', fontWeight: 'bold', marginTop: '1px' }}>RISK: {d.risk}</div>
                <div style={{ color: C.txt, fontSize: '8px', marginTop: '2px', lineHeight: '1.4' }}>{d.desc}</div>
                <div style={{ color: '#88ddff', fontSize: '8px', marginTop: '2px' }}>{d.rewards}</div>
              </div>
            ))}</div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                style={btn('#1a3a18')}
                disabled={!partyValid || expDestIdx === null || !canSortie || expSoldierIdxs.length > 1}
                onClick={playMission}
              >🎮 PLAY LIVE</button>
              <button
                style={btn('#2a3018', '#558844')}
                disabled={!partyValid || expDestIdx === null || !canSortie}
                onClick={sendExpedition}
              >🗺 AUTO-DISPATCH</button>
            </div>
            <div style={{ fontSize: '9px', color: C.txt, opacity: 0.5, marginTop: '8px', lineHeight: '1.5' }}>
              <b style={{ color: C.acc }}>PLAY LIVE</b>: single soldier, side-scrolling mission. Higher reward potential.<br />
              <b style={{ color: C.txt }}>AUTO-DISPATCH</b>: text-based; up to {BALANCE.maxExpeditionParty} soldiers, rewards stack with diminishing returns.
              {!canSortie && <><br /><b style={{ color: C.dng }}>NIGHTFALL</b>: no more sorties today — survive the next wave to dispatch again.</>}
            </div>
          </>
        )}

        {(expPhase === 'running' || expPhase === 'done') && (
          <div style={{ background: 'rgba(4,12,4,0.9)', border: `1px solid ${C.uib}`, padding: '14px 16px', minHeight: '180px' }}>
            <div style={{ fontSize: '10px', color: C.txt, opacity: 0.5, marginBottom: '10px', letterSpacing: '.05em' }}>
              {expResult?.destName?.toUpperCase()} — MISSION LOG
            </div>
            {expEvents.slice(0, expVisible).map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '8px', opacity: i < expVisible - 1 ? 0.7 : 1, transition: 'opacity 0.3s' }}>
                <span style={{ fontSize: '14px', flexShrink: 0 }}>{ev.icon}</span>
                <span style={{ fontSize: '12px', color: ev.col, lineHeight: '1.5' }}>{ev.text}</span>
              </div>
            ))}
            {expPhase === 'running' && (
              <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                {[0, 1, 2].map(i => (<div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: C.uib, opacity: 0.3 + i * 0.3 }} />))}
                <span style={{ fontSize: '10px', color: C.txt, opacity: 0.5, marginLeft: '6px' }}>transmitting...</span>
              </div>
            )}
          </div>
        )}

        {expPhase === 'done' && expResult && (
          <div style={{ background: expResult.outcome === 'success' ? 'rgba(10,40,10,0.9)' : expResult.outcome === 'injured' ? 'rgba(50,35,8,0.9)' : 'rgba(50,8,8,0.9)', border: `1px solid ${expResult.outcome === 'success' ? C.acc : expResult.outcome === 'injured' ? C.wrn : C.dng}`, padding: '10px 14px', marginTop: '10px' }}>
            <div style={{ fontWeight: 'bold', fontSize: '13px', color: expResult.outcome === 'success' ? C.acc : expResult.outcome === 'injured' ? C.wrn : C.dng }}>
              {expResult.outcome === 'success' ? '✦ MISSION SUCCESS' : expResult.outcome === 'injured' ? '⚠ RETURNED INJURED' : '✖ SOLDIER LOST'}
            </div>
            {Object.keys(expResult.reward || {}).length > 0 && (
              <div style={{ fontSize: '11px', color: C.acc, marginTop: '5px' }}>
                Recovered: {Object.entries(expResult.reward).map(([k, v]) => `${k} +${v}`).join('  ·  ')}
              </div>
            )}
            {expResult.recruit && (
              <div style={{ fontSize: '11px', color: '#88ddff', marginTop: '4px' }}>
                👤 <b>{expResult.recruit.name}</b> rescued — reporting for duty ({expResult.recruit.weapon})
              </div>
            )}
          </div>
        )}

        <hr style={hr} />
        <button style={btn()} onClick={() => { resetExp(); setScr('management'); }}>← BACK TO COMMAND</button>
        {expPhase !== 'running' && <button style={btn('#1a1a3e', '#4444aa')} onClick={startWave}>⚔ DEPLOY</button>}
      </div>
    </div>
  );

  return (
    <div style={{ background: '#030504', minHeight: '100vh', fontFamily: F, color: C.txt }}>
      <div style={{ display: (scr === 'siege' || scr === 'mission') ? 'flex' : 'none', flexDirection: 'column', alignItems: 'center', padding: '10px 0' }}>
        <canvas ref={cvs} width={CW} height={CH} style={{ border: `1px solid ${C.uib}`, maxWidth: '100%', cursor: scr === 'mission' ? 'crosshair' : 'crosshair', display: 'block', outline: 'none' }} tabIndex={0} />
        {scr === 'siege' && (
          <div style={{ display: 'flex', gap: '7px', marginTop: '7px', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: CW }}>
            <button style={ctrlBtn} onClick={() => moveSquad('retreat')}>◀ RETREAT</button>
            {ui?.soldiers?.filter(s => !s.onExpedition).map(s => (
              <div key={s.id} style={{ background: 'rgba(18,30,12,0.92)', border: `1px solid ${s.state === 'dead' ? C.dng : C.uib}`, padding: '4px 10px', opacity: s.state === 'dead' ? 0.32 : 1 }}>
                <span style={{ color: s.state === 'dead' ? C.dng : s.ammo === 0 ? C.dng : C.acc, fontWeight: 'bold', fontSize: '10px' }}>{s.name}</span>
                <span style={{ color: '#666', fontSize: '9px', margin: '0 3px' }}>{'FMB'[s.lane || 0]}</span>
                <span style={{ color: C.txt, fontSize: '9px' }}>{s.state === 'dead' ? 'KIA' : s.state.toUpperCase()}</span>
                <span style={{ color: s.ammo === 0 ? C.dng : C.txt, fontSize: '9px', marginLeft: '4px' }}>{s.state !== 'dead' ? `${s.ammo}/${s.maxAmmo}` : '─'}</span>
              </div>
            ))}
            <button style={ctrlBtn} onClick={() => moveSquad('advance')}>ADVANCE ▶</button>
            <button style={mbtn} onClick={togglePause}>{paused ? '▶ RESUME' : '⏸ PAUSE'}</button>
            <button style={mbtn} onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
          </div>
        )}
        {scr === 'mission' && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: CW }}>
            {missionRef.current && missionRef.current.state === 'active' ? (
              <>
                <span style={{ color: '#888', fontSize: '10px' }}>← / A or tap-left  ·  → / D or tap-right  ·  SPACE / tap-center : FIRE</span>
                <button style={mbtn} onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
              </>
            ) : (
              <button style={btn('#1a3a18')} onClick={finalizeMission}>✦ RETURN TO BASE ✦</button>
            )}
          </div>
        )}
      </div>

      {scr === 'menu' && (
        <div style={wrap}>
          <div style={{ ...panel, textAlign: 'center', maxWidth: '480px' }}>
            <div style={{ fontSize: '48px', marginBottom: '6px' }}>🧟</div>
            <div style={h1}>DEAD PERIMETER</div>
            <div style={{ color: C.txt, opacity: 0.5, margin: '5px 0 14px', fontSize: '10px', letterSpacing: '.14em' }}>ZOMBIE SIEGE SURVIVAL</div>
            <hr style={hr} />
            <p style={{ color: C.txt, fontSize: '12px', lineHeight: '1.9', marginBottom: '18px' }}>
              Defend <span style={{ color: C.acc }}>Fort Omega</span> across 3 depth lanes.<br />
              <span style={{ color: C.wrn }}>Click front/mid/back to position your squad.</span><br />
              Ammo is scarce. Build barricades. Send expeditions.<br />
              <span style={{ color: '#444' }}>🔊 Sound · Esc to pause · saves between waves</span>
            </p>
            <button style={btn()} onClick={newGame}>⚔  BEGIN OPERATION</button>
            {hasSave && (
              <button style={btn('#1a3a18', '#558844')} onClick={continueGame}>↻ CONTINUE SAVED RUN</button>
            )}
          </div>
        </div>
      )}

      {scr === 'management' && (
        <div style={wrap}>
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div><div style={h1}>COMMAND CENTER</div><div style={{ color: C.txt, opacity: 0.5, fontSize: '10px', marginTop: '3px' }}>DAY {gs?.day || 1} — Wave {gs?.wave} incoming</div></div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
                <div style={{ color: C.dng, fontWeight: 'bold', fontSize: '20px' }}>WAVE #{gs?.wave || 1}</div>
                <button style={mbtn} onClick={toggleMute}>{muted ? '🔇 MUTED' : '🔊 SOUND'}</button>
              </div>
            </div>
            {nextWaveIsHuman && (
              <div style={{ background: 'rgba(80,20,20,0.92)', border: `1px solid ${C.dng}`, padding: '10px 14px', marginTop: '8px' }}>
                <div style={{ color: C.dng, fontWeight: 'bold', fontSize: '13px', letterSpacing: '.05em' }}>
                  ⚠ HOSTILE HUMANS APPROACHING — WAVE {gs.wave}
                </div>
                <div style={{ color: C.txt, fontSize: '10px', marginTop: '4px', lineHeight: '1.5' }}>
                  Survivor gangs spotted in the perimeter. Knifemen rush the wall; gunmen open fire from a distance. They drop ammo when killed.
                </div>
              </div>
            )}
            <hr style={hr} />
            <div style={h2}>📦 RESOURCES</div>
            <div style={row}>
              {[['🥫', 'FOOD', gs?.resources?.food], ['🔫', 'AMMO', gs?.resources?.ammo], ['🎯', 'SNIPER', gs?.resources?.sniperAmmo ?? 0], ['💊', 'MED', gs?.resources?.medicine], ['🔧', 'MAT', gs?.resources?.materials]].map(([ic, lb, v]) => (
                <div key={lb} style={{ ...card, borderColor: lb === 'AMMO' && v < 30 ? C.wrn : C.uib }}>
                  <span style={lbl}>{ic} {lb}</span>
                  <div style={{ ...val, color: lb === 'AMMO' && v < 20 ? C.dng : lb === 'AMMO' && v < 50 ? C.wrn : C.acc }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={h2}>
                👥 SOLDIERS ({gs?.soldiers?.filter(s => s.state !== 'dead').length}/{BALANCE.maxActiveSoldiers} active
                {gs?.soldiers?.filter(s => s.state === 'dead').length > 0 ? ` · ${gs?.soldiers?.filter(s => s.state === 'dead').length} KIA` : ''}
                {reserveCount > 0 ? ` · ${reserveCount} in reserve` : ''})
              </div>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                <button style={{ ...btn('#1a3028', '#226644'), fontSize: '10px', padding: '4px 10px' }} disabled={!canRecruit} onClick={recruit}>+RECRUIT (🥫20 🔧15)</button>
                <button style={{ ...btn('#2a1e08', '#885522'), fontSize: '10px', padding: '4px 10px' }} disabled={!canBarricadeFlag} onClick={buildBarricade}>🪵 BARRICADE (🔧15)</button>
                <button style={{ ...btn('#1a2438', '#446699'), fontSize: '10px', padding: '4px 10px' }} disabled={!canTurret} onClick={buildTurret}>🛠 MG TURRET (🔧{BALANCE.turretCostMaterials} 🔫{BALANCE.turretCostAmmo})</button>
              </div>
            </div>
            <div style={row}>
              {gs?.soldiers?.map((s, i) => (
                <div key={s.id} style={{ ...card, opacity: s.state === 'dead' ? 0.34 : 1, borderColor: s.state === 'dead' ? C.dng : C.uib, minWidth: '130px' }}>
                  <div style={{ color: s.state === 'dead' ? C.dng : C.acc, fontWeight: 'bold', fontSize: '11px' }}>
                    {s.name} {s.state === 'dead' && '†'} {s.civilian && s.state !== 'dead' && <span style={{ color: '#88ddff', fontSize: '9px', marginLeft: '2px' }}>· civ</span>}
                  </div>
                  <div style={{ fontSize: '9px', color: C.txt }}>{WPN[s.weapon]?.name} · Lane {'FMB'[s.lane || 0]}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                    <div style={{ flex: 1, height: '3px', background: '#1a1a1a' }}><div style={{ height: '3px', width: `${(s.hp / s.maxHp) * 100}%`, background: s.hp > 60 ? C.acc : s.hp > 30 ? C.wrn : C.dng }} /></div>
                    <span style={{ ...lbl, minWidth: '28px' }}>{s.state === 'dead' ? 'KIA' : `${s.hp}HP`}</span>
                  </div>
                  {s.state !== 'dead' && s.hp < s.maxHp && (
                    <button style={{ ...btn('#162814', '#336622'), fontSize: '8px', padding: '2px 6px', marginTop: '3px', marginRight: 0 }} onClick={() => healSoldier(i)} disabled={gs.resources.medicine < 5}>💊 HEAL (5)</button>
                  )}
                </div>
              ))}
            </div>
            {reserveCount > 0 && (
              <>
                <div style={h2}>🛏 RESERVE ROSTER ({reserveCount}/{BALANCE.maxReserveSoldiers})</div>
                <div style={{ fontSize: '9px', color: C.txt, opacity: 0.55, marginBottom: '6px' }}>
                  Civilians and recruits at rest. They are auto-promoted to active duty when a slot opens up after each wave.
                </div>
                <div style={row}>
                  {gs.reserve.map((r, i) => (
                    <div key={i} style={{ ...card, minWidth: '110px', borderColor: '#1a3a52', background: 'rgba(12,20,30,0.85)' }}>
                      <div style={{ color: '#88ddff', fontWeight: 'bold', fontSize: '11px' }}>
                        {r.name} <span style={{ color: '#88ddff', fontSize: '8px' }}>· civ</span>
                      </div>
                      <div style={{ fontSize: '9px', color: C.txt }}>{WPN[r.weapon]?.name}</div>
                      <div style={{ fontSize: '8px', color: C.txt, opacity: 0.6, marginTop: '2px' }}>standby</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {turretCount > 0 && (
              <>
                <div style={h2}>🛠 MG TURRETS ({turretCount}/{BALANCE.maxTurrets})</div>
                <div style={{ fontSize: '9px', color: C.txt, opacity: 0.55, marginBottom: '6px' }}>
                  Auto-fire at the closest hostile in range ({BALANCE.turretRange} px). 1 round / shot from the ammo pool.
                </div>
              </>
            )}
            {(gs?.barricades?.length || 0) > 0 && (
              <>
                <div style={h2}>🪵 BARRICADES ({gs.barricades.length}/{BALANCE.maxBarricades})</div>
                <div style={row}>
                  {gs?.barricades?.map(b => (
                    <div key={b.id} style={{ ...card, minWidth: '90px' }}>
                      <div style={{ color: C.wrn, fontSize: '9px' }}>ALL LANES @ x{Math.round(b.x)}</div>
                      <div style={{ height: '3px', background: '#1a1a1a', marginTop: '3px' }}><div style={{ height: '3px', width: `${(b.hp / b.maxHp) * 100}%`, background: b.hp > 70 ? C.wrn : C.dng }} /></div>
                      <div style={{ ...lbl, marginTop: '2px' }}>{b.hp}/{b.maxHp} HP</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={h2}>🏰 BASE {gs?.baseHp}/{gs?.baseMaxHp}</div>
            <div style={{ height: '6px', background: '#1a1a1a', marginBottom: '14px' }}><div style={{ height: '6px', width: `${(gs?.baseHp || 0) / (gs?.baseMaxHp || 200) * 100}%`, background: (gs?.baseHp / gs?.baseMaxHp) > 0.6 ? C.acc : (gs?.baseHp / gs?.baseMaxHp) > 0.3 ? C.wrn : C.dng }} /></div>
            <hr style={hr} />
            <button
              style={btn('#1a1a3e', '#4444aa')}
              onClick={() => { resetExp(); setScr('expedition'); }}
              disabled={sortiesLeft <= 0}
              title={sortiesLeft <= 0 ? 'No sorties left today' : ''}
            >🗺 EXPEDITION{sortiesLeft > 0 ? ` (${sortiesLeft}/${BALANCE.expeditionsPerDay})` : ' — NIGHTFALL'}</button>
            <button style={btn()} onClick={startWave} disabled={aliveSols.length === 0}>⚔ DEPLOY</button>
            {aliveSols.length === 0 && <span style={{ color: C.dng, fontSize: '11px', marginLeft: '8px' }}>No soldiers available</span>}
            {gs?.resources?.ammo < 30 && <div style={{ color: C.wrn, fontSize: '10px', marginTop: '6px' }}>⚠ Low ammo — soldiers may run dry mid-wave</div>}
          </div>
        </div>
      )}

      {scr === 'expedition' && ExpeditionScreen}

      {scr === 'gameover' && (
        <div style={wrap}>
          <div style={{ ...panel, textAlign: 'center', maxWidth: '520px' }}>
            <div style={{ fontSize: '48px', marginBottom: '6px' }}>💀</div>
            <div style={{ ...h1, color: C.dng, fontSize: '22px' }}>FORT OMEGA FALLEN</div>
            <hr style={hr} />
            <div style={row}>{[['Days', gs?.day], ['Waves Cleared', (gs?.wave || 1) - 1], ['Kills', gs?.kills], ['Score', gs?.score]].map(([l, v]) => (
              <div key={l} style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>{l}</span><div style={{ ...val, fontSize: '20px' }}>{v}</div></div>
            ))}</div>
            <hr style={hr} />
            <button style={btn('#5a1a1a', '#883030')} onClick={newGame}>↺ TRY AGAIN</button>
          </div>
        </div>
      )}
    </div>
  );
}
