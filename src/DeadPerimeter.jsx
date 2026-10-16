import { useState, useEffect, useRef, useCallback } from 'react';

import { C, CW, CH, GY, WX, WORLD_W, laneY, clickToLane } from './constants.js';
import { WPN } from './data/weapons.js';
import { rollDestinations, RECRUIT_NAMES, RECRUIT_WEAPONS } from './data/expeditions.js';
import { isHumanWaveNumber } from './data/humans.js';

import { getAM, processSounds } from './audio/AudioEngine.js';

import { mkSoldier } from './entities/soldier.js';
import { mkBarricade } from './entities/barricade.js';
import { mkTurret } from './entities/turret.js';
import { mkWave, mkHumanWave } from './entities/wave.js';
import { mkGS } from './entities/gameState.js';
import { hasSavedGame, saveGame, loadGame, clearSave } from './entities/persistence.js';
import { BALANCE, CRAFT_RECIPES, RESEARCHES, PERKS, getResearchEffect } from './data/difficulty.js';

import { dBg } from './render/background.js';
import { dBase } from './render/base.js';
import { dSoldier } from './render/soldier.js';
import { dZombie } from './render/zombie.js';
import { dHuman } from './render/human.js';
import { dBarricade, dBlt, dFx } from './render/effects.js';
import { dTurret } from './render/turret.js';
import { dSquadMarker, dHUD, HUD_MUTE, HUD_SPEED, HUD_RADAR } from './render/hud.js';
import { dEvacScene, EVAC_DURATION } from './render/evac.js';
import { dIntroScene, INTRO_DURATION } from './render/intro.js';
import { dDefeatScene, DEFEAT_DURATION } from './render/defeat.js';
import { dTransmissionScene } from './render/transmission.js';
import { dExtractionScene, EXTRACTION_DURATION, EXTRACTION_SCRIPT, mkExtraction } from './render/extraction.js';
import { TRANSMISSIONS } from './data/transmissions.js';
import { pushRadio } from './audio/radio.js';
import { initRadioVoice, isRadioVoiceEnabled, isRadioVoiceAvailable, setRadioVoiceEnabled, speakRadio } from './audio/radioVoice.js';

import { update } from './update/siege.js';
import { mkMission, updateMission, dMissionWorld, dMissionHUD } from './update/mission.js';

import { finishMission } from './expedition/missionFinish.js';
import {
  mkVaccineCampaign, advanceVaccineScenario, finishVaccineCampaign,
} from './expedition/vaccineCampaign.js';
import { VACCINE_SCENARIOS } from './data/vaccineMission.js';

// "2h 14m" / "47 min" / "—" depending on how long the run took. Combines
// the persisted playMs (sessions before this one) with the live delta
// since the current session started.
function fmtPlayTime(gs) {
  if (!gs) return '—';
  const startedAt = gs.startedAt || Date.now();
  const total = (gs.playMs || 0) + Math.max(0, Date.now() - startedAt);
  const mins = Math.floor(total / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

// Lightweight snapshot of the mutable game state for React. Module-level
// so every callback (not just the game-loop effect) can use it.
const mkSnap = gs => ({
  phase: gs.phase, day: gs.day, wave: gs.wave, baseHp: gs.baseHp, baseMaxHp: gs.baseMaxHp,
  resources: { ...(gs.resources || {}) },
  soldiers: (gs.soldiers || []).map(s => ({ ...s })),
  barricades: (gs.barricades || []).map(b => ({ ...b })),
  turrets: (gs.turrets || []).map(t => ({ ...t })),
  reserve: (gs.reserve || []).map(r => ({ ...r })),
  selectedSoldierId: gs.selectedSoldierId,
  kills: gs.kills, score: gs.score,
  isHumanWave: gs.isHumanWave,
  expeditionsToday: gs.expeditionsToday || 0,
  lastEvacWave: gs.lastEvacWave ?? -10,
  // Story-beat fields the management UI banners read. Forgetting
  // any of these here used to cause the post-transmission
  // management screen to render with stale data (or to never
  // render at all if mkSnap throws on a missing field).
  transmissionsDone: Array.isArray(gs.transmissionsDone) ? [...gs.transmissionsDone] : [],
  pendingTransmission: gs.pendingTransmission ?? null,
  lastFoodReport:  gs.lastFoodReport  ?? null,
  lastSupplyDrop:  gs.lastSupplyDrop  ?? null,
  cameraX: gs.cameraX || 0,
  workbench: gs.workbench, researchLab: gs.researchLab, research: gs.research,
  soldiersLost: gs.soldiersLost || 0, civiliansLost: gs.civiliansLost || 0,
  playMs: gs.playMs || 0, startedAt: gs.startedAt,
});

export default function DeadPerimeter() {
  const cvs = useRef(null), gsRef = useRef(null), rafId = useRef(null), prevT = useRef(0), mutedR = useRef(false);
  const missionRef = useRef(null);
  const evacRef = useRef(null);                // active helicopter-evac animation, if any
  const introRef = useRef(null);               // opening cinematic state, if any
  const defeatRef = useRef(null);              // game-over cinematic state, if any
  const transmissionRef = useRef(null);        // intermediate radio cinematic (waves 10/20/25)
  const extractionRef = useRef(null);          // (legacy) wave-30 convoy cinematic — unused now that the vaccine campaign is playable
  const vaccineRef = useRef(null);             // active wave-30 vaccine campaign (3 sequential scenarios)
  const vaccineResultRef = useRef(null);       // { tier, survivors, scenariosCleared } when the campaign ends
  const placementRef = useRef(null);           // active build-placement, if any: { kind, validRange, mouseWorldX }
  const inputRef = useRef({ left: false, right: false, shoot: false });
  const pausedRef = useRef(false);
  const [scr, setScr] = useState('menu'), [ui, setUi] = useState(null), [muted, setMuted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const voiceAvail = isRadioVoiceAvailable();
  const [paused, setPaused] = useState(false);
  const [hasSave, setHasSave] = useState(false);
  // Which soldier card currently has its upgrade panel expanded (id).
  // null = none. Toggled by the ⚙ UPGRADES button on each card.
  const [upgOpenId, setUpgOpenId] = useState(null);
  const [, setMissionTick] = useState(0);
  // Multi-soldier picker: an array of soldier indices (max BALANCE.maxExpeditionParty)
  const [expSoldierIdxs, setExpSoldierIdxs] = useState([]);
  const [expDestIdx, setExpDestIdx] = useState(null);
  // Magazines per soldier for the upcoming sortie. 1 = loaded only
  // (no reloads possible during the mission), 2 = loaded + 1 spare,
  // up to 4. The player picks the loadout before clicking LAUNCH.
  const [magsPerSoldier, setMagsPerSoldier] = useState(2);
  const magsRef = useRef(2);
  const [expResult, setExpResult] = useState(null);
  const [expPhase, setExpPhase] = useState(null);
  const [expEvents, setExpEvents] = useState([]);
  const [expVisible, setExpVisible] = useState(0);
  const expSolsRef = useRef([]);
  const expDstRef = useRef(null);
  // The three destinations currently shown on the expedition screen.
  // Re-rolled by resetExp() so consecutive sortie sessions never see
  // the same trio of locations.
  const expDestsRef = useRef(rollDestinations());
  const [expDests, setExpDests] = useState(expDestsRef.current);
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

  const toggleVoice = useCallback(() => {
    const n = !isRadioVoiceEnabled();
    setRadioVoiceEnabled(n);
    setVoiceOn(n);
  }, []);

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

  // Siege fast-forward (1× ↔ 2×). Stored on gs so the HUD can show it.
  const [fastOn, setFastOn] = useState(false);
  const toggleSpeed = useCallback(() => {
    const gs = gsRef.current; if (!gs) return;
    gs.speed = (gs.speed || 1) > 1 ? 1 : 2;
    setFastOn(gs.speed > 1);
  }, []);

  // Detect existing save + load radio-voice preference on mount.
  useEffect(() => {
    setHasSave(hasSavedGame());
    initRadioVoice();
    setVoiceOn(isRadioVoiceEnabled());
  }, []);

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

  // Triggered from the intro (or its SKIP button) to actually drop the
  // player into management once the cinematic is finished. Cleans up
  // every persistent audio loop the cinematic might have started.
  const finishIntro = useCallback(() => {
    const am = getAM();
    if (am) { am.heliStop(); am.windStop(); am.cityHumStop(); }
    introRef.current = null;
    setScr('management');
  }, []);

  // Same teardown for the game-over cinematic, routes into the stats
  // screen once the cinematic ends (or is skipped).
  const finishDefeat = useCallback(() => {
    const am = getAM();
    if (am) { am.windStop(); am.heliStop(); am.cityHumStop(); }
    try { window.speechSynthesis?.cancel(); } catch {}
    defeatRef.current = null;
    setScr('gameover');
  }, []);

  // Intermediate radio transmission (waves 10/20/25): on finish, mark
  // the wave done so it never replays, save, and drop into management.
  // Wrapped defensively — any throw here would kill the rAF loop and
  // freeze the canvas on the last cinematic frame.
  const finishTransmission = useCallback(() => {
    try {
      const gs = gsRef.current;
      const tr = transmissionRef.current;
      if (gs && tr) {
        if (!Array.isArray(gs.transmissionsDone)) gs.transmissionsDone = [];
        if (!gs.transmissionsDone.includes(tr.wave)) {
          gs.transmissionsDone.push(tr.wave);
          // Apply the supply drop payload Central Command promised in
          // the transmission. The management screen surfaces a banner
          // showing what was received via gs.lastSupplyDrop.
          const drop = tr.data && tr.data.supplyDrop;
          if (drop) {
            const breakdown = {};
            const apply = (k, cap) => {
              const inc = drop[k];
              if (!inc) return;
              const before = (gs.resources && gs.resources[k]) || 0;
              const after  = Math.min(cap, before + inc);
              gs.resources[k] = after;
              breakdown[k] = after - before;
            };
            if (!gs.resources) gs.resources = {};
            apply('ammo', 999);
            apply('food', 999);
            apply('medicine', 999);
            apply('materials', 999);
            apply('sniperAmmo', 99);
            apply('turretAmmo', 999);
            gs.lastSupplyDrop = { wave: tr.wave, breakdown };
          }
        }
        gs.pendingTransmission = null;
        try { saveGame(gs); } catch (e) { /* save failure is non-fatal */ }
      }
      try { window.speechSynthesis?.cancel(); } catch {}
    } catch (e) {
      // Swallow + log: a bug in the drop apply must not freeze the game.
      console.error('finishTransmission error:', e);
    }
    // Always clear the cinematic ref + route to management, even if
    // the payload application above threw. The player must never be
    // stuck on a finished cinematic.
    transmissionRef.current = null;
    try { setUi(mkSnap(gsRef.current)); } catch (e) { /* fall through */ }
    setScr('management');
  }, []);

  // Wave-30 convoy cinematic: route to the victory stats screen.
  // Wrapped defensively for the same reason as finishTransmission —
  // any throw here would freeze the canvas on the last cinematic
  // frame instead of advancing to the stats screen.
  const finishExtraction = useCallback(() => {
    try {
      const gs = gsRef.current;
      if (gs) gs.phase = 'victory';
      try { window.speechSynthesis?.cancel(); } catch {}
      clearSave();
      setHasSave(false);
    } catch (e) {
      console.error('finishExtraction error:', e);
    }
    extractionRef.current = null;
    try { setUi(mkSnap(gsRef.current)); } catch (e) { /* fall through */ }
    setScr('victory');
  }, []);

  const newGame = useCallback(() => {
    const am = getAM(); if (am) am.resume();
    clearSave();
    const gs = mkGS();
    gs.soldiers.forEach(s => { s.ammo = WPN[s.weapon].ammo; gs.resources.ammo -= WPN[s.weapon].ammoCost; });
    gsRef.current = gs; setUi({ ...gs });
    setHasSave(false);
    transmissionRef.current = null;
    extractionRef.current = null;
    // Roll the opening cinematic before the player sees management.
    // Loaded games (continueGame) skip this and go straight to play.
    introRef.current = { startedAt: 0 };
    setScr('intro');
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
    gs.waveTotal = gs.spawnQueue.length;
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

  const playMission = useCallback(() => {
    const idxs = expSolsRef.current, di = expDstRef.current;
    if (!idxs || idxs.length === 0 || di === null) return;
    const gs = gsRef.current;
    if ((gs.expeditionsToday || 0) >= BALANCE.expeditionsPerDay) return;

    const party = idxs.map(i => gs.soldiers[i]).filter(s => s && s.state !== 'dead');
    if (party.length === 0) return;
    const dest = expDestsRef.current[di];

    // Issue ammo from Fort Omega's pool for every party member.
    // Each soldier carries `mags` magazines total: 1 loaded + (mags-1)
    // spare. mkMission reads each soldier's stored _sortieMags to seed
    // its magsLeft field (= spare mags after the loaded one).
    const mags = Math.max(1, Math.min(4, magsRef.current || 2));
    party.forEach(soldier => {
      const poolKey = soldier.weapon === 'sniper' ? 'sniperAmmo' : 'ammo';
      // Top up the loaded mag first.
      const wantLoaded = Math.max(0, soldier.maxAmmo - (soldier.ammo || 0));
      const giveLoaded = Math.min(wantLoaded, gs.resources[poolKey] || 0);
      gs.resources[poolKey] = (gs.resources[poolKey] || 0) - giveLoaded;
      soldier.ammo = (soldier.ammo || 0) + giveLoaded;
      // Then issue the requested spare mags (capped by the pool).
      const wantSpare = (mags - 1) * soldier.maxAmmo;
      const giveSpare = Math.min(wantSpare, gs.resources[poolKey] || 0);
      gs.resources[poolKey] = (gs.resources[poolKey] || 0) - giveSpare;
      soldier._sortieMags = 1 + Math.floor(giveSpare / soldier.maxAmmo);
      soldier.onExpedition = true;
    });

    // mkMission's buildMissionSoldier seeds magsLeft from
    // orig._sortieMags - 1. Pass the requested mag count as the
    // default for any soldier whose _sortieMags wasn't preset.
    const m = mkMission(party, dest, gs.wave || 1, mags);
    missionRef.current = m;
    inputRef.current = { left: false, right: false, shoot: false, up: false, down: false };
    gs.expeditionsToday = (gs.expeditionsToday || 0) + 1;
    setScr('mission');
  }, []);

  const finalizeMission = useCallback(() => {
    const m = missionRef.current; if (!m) return;
    const gs = gsRef.current;
    // finishMission writes back every party member's hp/state/onExpedition.
    const result = finishMission(m, gs);
    missionRef.current = null;
    setExpResult(result); setExpPhase('done'); setExpEvents([]); setExpVisible(0);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
    setScr('expedition');
  }, []);

  // Vaccine campaign — start the playable wave-30 finale. Builds the
  // first of three scenarios (highway/hospital/rooftop), wires its
  // mission into missionRef so the regular siege loop renders + drives
  // it, and stashes the campaign wrapper on vaccineRef for the scenario
  // advance + finalize handlers to read.
  const startVaccineMission = useCallback(() => {
    const gs = gsRef.current; if (!gs) return;
    const campaign = mkVaccineCampaign(gs, 3);
    if (!campaign) return;
    vaccineRef.current = campaign;
    missionRef.current = campaign.current;
    inputRef.current = { left: false, right: false, shoot: false, up: false, down: false };
    gs.phase = 'vaccine-mission';
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
    setScr('mission');
  }, []);

  // Called when the current scenario's state flips to won / lost.
  // If won and there's another scenario, advance — otherwise wrap up
  // the campaign and route to victory (any tier) or gameover (failure
  // = total wipe before any scenario was cleared).
  const advanceOrFinishVaccine = useCallback(() => {
    const campaign = vaccineRef.current; if (!campaign) return;
    const gs = gsRef.current; if (!gs) return;
    const m = campaign.current;
    if (m.state === 'won') {
      const next = advanceVaccineScenario(campaign, gs);
      if (next) {
        missionRef.current = next;
        // Stay on the mission screen; the new scenario renders in the
        // same canvas with its own biome / layout.
        setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
        return;
      }
    }
    // No next scenario (we won the last one, or the party wiped). Wrap up.
    // Even a campaign wipe routes to the victory screen — the fort held,
    // but the convoy didn't make it. The screen shows the 'failure' tier
    // text instead of the misleading "FORT OMEGA FALLEN" gameover panel.
    const result = finishVaccineCampaign(campaign, gs);
    vaccineResultRef.current = result;
    vaccineRef.current = null;
    missionRef.current = null;
    gs.phase = 'victory';
    // The run is over — a stale pre-wave-30 save would let the player
    // "continue" a finished campaign.
    clearSave(); setHasSave(false);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
    setScr('victory');
  }, []);

  const recruit = useCallback(() => {
    const gs = gsRef.current;
    if (gs.resources.food < 20 || gs.resources.materials < 15 || gs.soldiers.filter(s => s.state !== 'dead').length >= BALANCE.maxActiveSoldiers) return;
    // Pick the name BEFORE charging so an exhausted name pool never
    // eats the player's food + materials for nothing.
    const avail = RECRUIT_NAMES.filter(n => !gs.usedNames.has(n));
    if (!avail.length) return;
    gs.resources.food -= 20; gs.resources.materials -= 15;
    const name = avail[Math.floor(Math.random() * avail.length)];
    const weapon = RECRUIT_WEAPONS[Math.floor(Math.random() * RECRUIT_WEAPONS.length)];
    gs.usedNames.add(name);
    const ns = mkSoldier(name, weapon, 270, 100, Math.floor(Math.random() * 3));
    ns.ammo = 0; gs.soldiers.push(ns);
    saveGame(gs); setHasSave(true);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  // Enter placement mode for a new barricade. The actual mkBarricade
  // + resource deduction runs in confirmPlacement once the player
  // clicks a valid spot on the siege view. The placement camera
  // (pl.cameraX) follows the cursor so the player can roam the full
  // valid range without bumping into the viewport edge.
  const buildBarricade = useCallback(() => {
    const gs = gsRef.current;
    if (gs.resources.materials < 15 || gs.barricades.length >= BALANCE.maxBarricades) return;
    const mouseWorldX = WX + 240;
    placementRef.current = {
      kind: 'barricade',
      cost: { materials: 15 },
      // Anywhere from just past the inner wall out to most of the
      // killbox — barricades are physical obstacles for the zombies.
      validRange: [WX + 50, WORLD_W - 100],
      mouseWorldX,
      cameraX: Math.max(0, Math.min(WORLD_W - CW, mouseWorldX - CW / 2)),
    };
    setScr('placement');
  }, []);

  // Repair the perimeter wall: spend wallRepairCost materials for
  // wallRepairHp HP, capped at baseMaxHp. Only available during the
  // management phase and disabled when wall is already full.
  const repairWall = useCallback(() => {
    const gs = gsRef.current;
    if (!gs || gs.phase !== 'management') return;
    if (gs.resources.materials < BALANCE.wallRepairCost) return;
    if (gs.baseHp >= gs.baseMaxHp) return;
    gs.resources.materials -= BALANCE.wallRepairCost;
    const hpPerTick = BALANCE.wallRepairHp + getResearchEffect(gs, 'wallRepairBonus', 0);
    gs.baseHp = Math.min(gs.baseMaxHp, gs.baseHp + hpPerTick);
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
  }, []);

  // Workshop — one-time build of the workbench. Unlocks the crafting
  // panel (CRAFT_RECIPES) that converts 🔧 materials into combat consumables.
  const buildWorkbench = useCallback(() => {
    const gs = gsRef.current; if (!gs || gs.phase !== 'management') return;
    if (gs.workbench?.built) return;
    const cost = BALANCE.workbenchCost;
    if ((gs.resources.materials || 0) < cost.materials) return;
    gs.resources.materials -= cost.materials;
    gs.workbench = { built: true };
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
  }, []);

  // Craft one batch of a recipe. Output is multiplied by the
  // 'craftMultiplier' research effect (default 1×).
  const craft = useCallback(recipeId => {
    const gs = gsRef.current; if (!gs || !gs.workbench?.built) return;
    const r = CRAFT_RECIPES.find(x => x.id === recipeId); if (!r) return;
    for (const [k, v] of Object.entries(r.cost)) {
      if ((gs.resources[k] || 0) < v) return;
    }
    for (const [k, v] of Object.entries(r.cost)) gs.resources[k] -= v;
    const mul = getResearchEffect(gs, 'craftMultiplier', 1);
    const caps = { food: 999, ammo: 999, medicine: 999, materials: 999, sniperAmmo: 99, turretAmmo: 999 };
    for (const [k, v] of Object.entries(r.output)) {
      const add = Math.max(1, Math.round(v * mul));
      gs.resources[k] = Math.min(caps[k] ?? 999, (gs.resources[k] || 0) + add);
    }
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
  }, []);

  const buildResearchLab = useCallback(() => {
    const gs = gsRef.current; if (!gs || gs.phase !== 'management') return;
    if (gs.researchLab?.built) return;
    const cost = BALANCE.researchLabCost;
    for (const [k, v] of Object.entries(cost)) {
      if ((gs.resources[k] || 0) < v) return;
    }
    for (const [k, v] of Object.entries(cost)) gs.resources[k] -= v;
    gs.researchLab = { built: true };
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
  }, []);

  // Start a research node. Cost is paid immediately; progress ticks
  // up by 1 on each wave clear (see update/siege.js) and the effects
  // are applied when progress reaches r.waves.
  const startResearch = useCallback(id => {
    const gs = gsRef.current; if (!gs || !gs.researchLab?.built) return;
    if (gs.research?.activeId) return;
    if ((gs.research?.completed || []).includes(id)) return;
    const r = RESEARCHES.find(x => x.id === id); if (!r) return;
    for (const [k, v] of Object.entries(r.cost)) {
      if ((gs.resources[k] || 0) < v) return;
    }
    for (const [k, v] of Object.entries(r.cost)) gs.resources[k] -= v;
    gs.research = { ...gs.research, activeId: id, progress: 0 };
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
  }, []);

  // Cancel the active research. The resources spent are forfeit
  // (no refund) — meant for desperate pivots, not free re-rolls.
  const cancelResearch = useCallback(() => {
    const gs = gsRef.current; if (!gs?.research?.activeId) return;
    gs.research = { ...gs.research, activeId: null, progress: 0 };
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
  }, []);

  const benchSoldier = useCallback(idx => {
    const gs = gsRef.current; if (!gs) return;
    const s = gs.soldiers[idx]; if (!s || s.state === 'dead') return;
    // Sniper / Delta on the rooftop can't be benched (would lose her post).
    if (s.onRoof) return;
    if ((gs.reserve?.length || 0) >= BALANCE.maxReserveSoldiers) return;
    gs.reserve = gs.reserve || [];
    gs.reserve.push({ name: s.name, weapon: s.weapon, civilian: !!s.civilian, veteran: !!s.veteran, hp: s.hp });
    gs.soldiers.splice(idx, 1);
    saveGame(gs); setHasSave(true);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  const activateReserve = useCallback(idx => {
    const gs = gsRef.current; if (!gs) return;
    const r = (gs.reserve || [])[idx]; if (!r) return;
    if (gs.soldiers.filter(s => s.state !== 'dead').length >= BALANCE.maxActiveSoldiers) return;
    const ns = mkSoldier(r.name, r.weapon, 270, r.hp ?? 100, Math.floor(Math.random() * 3), !!r.civilian, false, { veteran: !!r.veteran });
    ns.ammo = 0;
    gs.soldiers.push(ns);
    gs.reserve.splice(idx, 1);
    saveGame(gs); setHasSave(true);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  const selectSoldierById = useCallback(id => {
    const gs = gsRef.current; if (!gs) return;
    gs.selectedSoldierId = (gs.selectedSoldierId === id) ? null : id;
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  // Apply the actual evac effects (called by the animation when it ends).
  const applyEvac = useCallback(() => {
    const gs = gsRef.current; const evac = evacRef.current;
    if (!gs || !evac) return;
    const am = getAM(); if (am) am.heliStop();
    gs.reserve = (gs.reserve || []).filter(r => !r.civilian);
    gs.resources.food       = Math.min(999, (gs.resources.food       || 0) + (evac.reward.food       || 0));
    gs.resources.medicine   = Math.min(999, (gs.resources.medicine   || 0) + (evac.reward.medicine   || 0));
    gs.resources.sniperAmmo = Math.min(99,  (gs.resources.sniperAmmo || 0) + (evac.reward.sniperAmmo || 0));
    gs.resources.materials  = Math.min(999, (gs.resources.materials  || 0) + (evac.reward.materials  || 0));
    gs.lastEvacWave = gs.wave;
    evacRef.current = null;
    saveGame(gs); setHasSave(true);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
    setScr('management');
  }, []);

  const callEvac = useCallback(() => {
    const gs = gsRef.current; if (!gs) return;
    const civs = (gs.reserve || []).filter(r => r.civilian).length;
    if (civs < BALANCE.evacMinReserve) return;
    if ((gs.wave - (gs.lastEvacWave ?? -10)) < BALANCE.evacWaveCooldown) return;

    // Stage the animation. The actual reserve / resource mutation
    // happens in applyEvac when the helicopter is gone.
    evacRef.current = {
      startedAt: 0, // initialised on the first frame of the loop
      civCount: civs,
      baseHp: gs.baseHp, baseMaxHp: gs.baseMaxHp,
      reward: {
        food:       civs * BALANCE.evacFoodPerCiv,
        medicine:   civs * BALANCE.evacMedicinePerCiv,
        sniperAmmo: civs * BALANCE.evacSniperAmmoPerCiv,
        materials:  civs * BALANCE.evacMaterialsPerCiv,
      },
    };
    setScr('evac');
  }, []);

  const skipEvac = useCallback(() => { applyEvac(); }, [applyEvac]);

  // Resolves an open survivor-trade dialog. ACCEPT swaps resources +
  // makes the camp vanish; REFUSE turns the whole camp hostile.
  const resolveTrade = useCallback((action) => {
    const m = missionRef.current; const gs = gsRef.current;
    if (!m?.dialog || !m.encounter || !gs) return;
    const ids = m.encounter.humanIds || [];
    if (action === 'accept') {
      const offer = m.dialog.offer;
      const ok = Object.entries(offer.give).every(([k, v]) => (gs.resources[k] || 0) >= v);
      if (!ok) {
        // Keep dialog open; the player can REFUSE to back out.
        m.dialog._error = 'Not enough supplies at Fort Omega.';
        return;
      }
      Object.entries(offer.give).forEach(([k, v]) => { gs.resources[k] = (gs.resources[k] || 0) - v; });
      Object.entries(offer.get).forEach(([k, v]) => { m.collected[k] = (m.collected[k] || 0) + v; });
      m.humans = (m.humans || []).filter(h => !ids.includes(h.id));
      m.encounter.resolved = true;
      m.dialog = null;
    } else if (action === 'refuse') {
      (m.humans || []).forEach(h => {
        if (ids.includes(h.id)) {
          h.hostile = true; h.bandit = true; h.activated = true;
        }
      });
      m.encounter.resolved = true;
      m.dialog = null;
    }
  }, []);

  const buildTurret = useCallback(() => {
    const gs = gsRef.current;
    if (
      gs.resources.materials < BALANCE.turretCostMaterials ||
      (gs.resources.turretAmmo || 0) < BALANCE.turretCostAmmo ||
      (gs.turrets?.length || 0) >= BALANCE.maxTurrets
    ) return;
    const mouseWorldX = WX + 60;
    placementRef.current = {
      kind: 'turret',
      cost: { materials: BALANCE.turretCostMaterials, turretAmmo: BALANCE.turretCostAmmo },
      // Turrets can mount along the wall OR be set forward into the
      // killbox as an advance emplacement. Wider strip than barricade
      // gives the player real tactical choice (forward vs anchored).
      validRange: [WX - 40, WX + 600],
      mouseWorldX,
      cameraX: Math.max(0, Math.min(WORLD_W - CW, mouseWorldX - CW / 2)),
    };
    setScr('placement');
  }, []);

  // Confirm a build placement at the current mouseWorldX. Deducts
  // cost, inserts the new entity, persists, returns to management.
  const confirmPlacement = useCallback(() => {
    const gs = gsRef.current;
    const p = placementRef.current;
    if (!gs || !p) return;
    const [minX, maxX] = p.validRange;
    const x = Math.max(minX, Math.min(maxX, p.mouseWorldX));
    if (p.kind === 'barricade') {
      gs.resources.materials -= p.cost.materials;
      gs.barricades.push(mkBarricade(x));
    } else if (p.kind === 'turret') {
      gs.resources.materials -= p.cost.materials;
      gs.resources.turretAmmo = (gs.resources.turretAmmo || 0) - p.cost.turretAmmo;
      gs.turrets = gs.turrets || [];
      gs.turrets.push(mkTurret(gs.turrets.length, x));
    }
    placementRef.current = null;
    saveGame(gs); setHasSave(true);
    setUi({ ...gs });
    setScr('management');
  }, []);

  const cancelPlacement = useCallback(() => {
    placementRef.current = null;
    setScr('management');
  }, []);

  const healSoldier = useCallback(idx => {
    const gs = gsRef.current;
    if (gs.resources.medicine < 5) return;
    const s = gs.soldiers[idx]; if (!s || s.state === 'dead') return;
    gs.resources.medicine -= 5;
    const heal = Math.round(40 * getResearchEffect(gs, 'medicineMul', 1));
    s.hp = Math.min(s.maxHp, s.hp + heal);
    saveGame(gs); setHasSave(true);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  // Buy a perk for a specific soldier. Requires the workbench. One-shot
  // bumps (maxHpBonus / maxAmmoBonus) are applied directly here so the
  // soldier card immediately reflects the new caps. Per-shot multipliers
  // are read by siege.js at fire time.
  const upgradeSoldier = useCallback((idx, perkId) => {
    const gs = gsRef.current;
    if (!gs?.workbench?.built) return;
    const s = gs.soldiers[idx]; if (!s || s.state === 'dead') return;
    const p = PERKS.find(x => x.id === perkId); if (!p) return;
    if (s.upgrades && s.upgrades[perkId]) return;
    if (p.weapons !== 'all' && !p.weapons.includes(s.weapon)) return;
    for (const [k, v] of Object.entries(p.cost)) {
      if ((gs.resources[k] || 0) < v) return;
    }
    for (const [k, v] of Object.entries(p.cost)) gs.resources[k] -= v;
    s.upgrades = { ...(s.upgrades || {}), [perkId]: true };
    if (p.maxHpBonus)   { s.maxHp += p.maxHpBonus; s.hp = Math.min(s.maxHp, s.hp + p.maxHpBonus); }
    if (p.maxAmmoBonus) { s.maxAmmo += p.maxAmmoBonus; }
    saveGame(gs); setHasSave(true);
    setUi({ ...gs, soldiers: gs.soldiers.map(s => ({ ...s })) });
  }, []);

  const moveSquad = useCallback(dir => {
    const gs = gsRef.current; if (!gs || gs.phase !== 'siege') return;
    const cur = gs.squadTarget ?? 270;
    // Advance limit is well past the legacy viewport edge — the
    // battlefield is WORLD_W wide and soldiers should be able to
    // push forward into the killbox to meet the horde, not be
    // clamped at x≈820 where bullets used to despawn.
    const advanceMax = WORLD_W - 700;
    gs.squadTarget = dir === 'retreat' ? Math.max(WX + 40, cur - 80) : Math.min(advanceMax, cur + 80);
    const movables = gs.selectedSoldierId
      ? gs.soldiers.filter(s => s.id === gs.selectedSoldierId && s.state !== 'dead' && !s.onExpedition && !s.onRoof && s.state !== 'reload')
      : gs.soldiers.filter(s => s.state !== 'dead' && !s.onExpedition && !s.onRoof && s.state !== 'reload');
    // Per-soldier destX clamp uses the same advanceMax (WORLD_W - 700)
    // as gs.squadTarget. The old CW - 70 (= 830) clamp would silently
    // truncate the destination so soldiers visually stopped at the
    // legacy viewport edge even when the squad target was further
    // out in the wider world.
    movables.forEach((s, i) => {
      s.destX = Math.max(WX + 35, Math.min(WORLD_W - 700, gs.squadTarget + (i - 1) * 22));
      s.state = 'walk';
    });
    if (movables.length > 0) {
      pushRadio(gs, dir === 'retreat' ? 'retreat' : 'advance',
        { urgent: dir === 'retreat', speaker: movables[0] });
    }
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
      // Cinematics: tap anywhere to skip.
      if (transmissionRef.current) { finishTransmission(); return; }
      if (extractionRef.current)   { finishExtraction();   return; }
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (CW / r.width), my = (e.clientY - r.top) * (CH / r.height);
      // Build placement: click in the green zone to confirm.
      const pl = placementRef.current;
      if (pl) {
        const [minX, maxX] = pl.validRange;
        // Header band swallows clicks (could be a cancel-button area later)
        if (my < 38) return;
        if (pl.mouseWorldX >= minX && pl.mouseWorldX <= maxX) confirmPlacement();
        return;
      }
      // Intro SKIP button.
      const intro = introRef.current;
      if (intro && intro._skipBtn) {
        const b = intro._skipBtn;
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          finishIntro(); return;
        }
        return;
      }

      // Game-over cinematic SKIP button.
      const defeat = defeatRef.current;
      if (defeat && defeat._skipBtn) {
        const b = defeat._skipBtn;
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          finishDefeat(); return;
        }
        return;
      }

      // Mission survivor-trade dialog: route clicks to ACCEPT / REFUSE.
      const md = missionRef.current?.dialog;
      if (md && md._buttons) {
        const hit = b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
        if (hit(md._buttons.accept)) { resolveTrade('accept'); return; }
        if (hit(md._buttons.refuse)) { resolveTrade('refuse'); return; }
        return;
      }
      const inRect = R => mx >= R.x && mx <= R.x + R.w && my >= R.y && my <= R.y + R.h;
      if (inRect(HUD_MUTE)) { toggleMute(); return; }
      const gs = gsRef.current;
      if (!gs || gs.phase !== 'siege') return;
      if (inRect(HUD_SPEED)) { toggleSpeed(); return; }
      // Radar click: centre the camera on that slice of the battlefield.
      if (inRect(HUD_RADAR)) {
        const wx = ((mx - HUD_RADAR.x) / HUD_RADAR.w) * WORLD_W;
        gs.cameraX = Math.max(0, Math.min(WORLD_W - CW, wx - CW / 2));
        return;
      }
      if (my <= 38) return;

      // The world is wider than the viewport (WORLD_W vs CW) and the
      // siege view scrolls. Translate the click into world coordinates
      // so entity-hit tests and target placement line up with what the
      // player sees regardless of cameraX.
      const worldX = mx + (gs.cameraX || 0);

      const clickedSol = gs.soldiers.find(s => {
        if (s.state === 'dead' || s.onExpedition || s.onRoof) return false;
        const sly = laneY(s.lane);
        return Math.abs(s.x - worldX) < 22 && my > sly - 58 && my < sly + 10;
      });
      if (clickedSol) {
        gs.selectedSoldierId = (gs.selectedSoldierId === clickedSol.id) ? null : clickedSol.id;
        return;
      }

      if (worldX > WX + 40) {
        const clickedLane = clickToLane(my);
        // Click-target clamp matches the ADVANCE limit so the player
        // can route the squad anywhere in the meaningful killbox.
        const targetX = Math.max(WX + 40, Math.min(WORLD_W - 700, worldX));
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
            s.destX = Math.max(WX + 35, Math.min(WORLD_W - 700, targetX + (i - 1) * 22));
            s.state = 'walk';
          });
        }
      }
    };

    const onKeyDown = e => {
      // Space / Enter skip cinematics that have a skip hint.
      const skipKey = e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter' || e.key === 'Escape' || e.key === 'Esc';
      if (skipKey && (transmissionRef.current || extractionRef.current || introRef.current || defeatRef.current)) {
        if (transmissionRef.current) finishTransmission();
        else if (extractionRef.current) finishExtraction();
        else if (introRef.current) finishIntro();
        else if (defeatRef.current) finishDefeat();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' || e.key === 'Esc') {
        // Cancel build placement if active.
        if (placementRef.current) { cancelPlacement(); e.preventDefault(); return; }
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
        if (e.key === 'ArrowUp'    || e.key === 'w' || e.key === 'W') { inputRef.current.up = true;    e.preventDefault(); }
        if (e.key === 'ArrowDown'  || e.key === 's' || e.key === 'S') { inputRef.current.down = true;  e.preventDefault(); }
        if (e.key === ' ' || e.key === 'Spacebar') { inputRef.current.shoot = true; e.preventDefault(); }
      } else {
        // Siege phase: arrow keys pan the camera across the wider WORLD_W.
        const gs = gsRef.current;
        if (gs && gs.phase === 'siege' && !missionRef.current) {
          if (e.key === 'f' || e.key === 'F') { toggleSpeed(); e.preventDefault(); return; }
          // 1-9: quick-select a ground soldier (same order as the chips
          // under the canvas). Pressing the selected one again deselects.
          if (/^[1-9]$/.test(e.key)) {
            const ground = gs.soldiers.filter(s => s.state !== 'dead' && !s.onExpedition && !s.onRoof);
            const pick = ground[Number(e.key) - 1];
            if (pick) {
              gs.selectedSoldierId = gs.selectedSoldierId === pick.id ? null : pick.id;
              // Bring the picked soldier into view.
              if (gs.selectedSoldierId) gs.cameraX = Math.max(0, Math.min(WORLD_W - CW, pick.x - CW / 3));
            }
            e.preventDefault(); return;
          }
          if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') { inputRef.current.panLeft  = true; e.preventDefault(); }
          if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { inputRef.current.panRight = true; e.preventDefault(); }
        }
      }
    };
    const onKeyUp = e => {
      if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') { inputRef.current.left = false; inputRef.current.panLeft = false; }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { inputRef.current.right = false; inputRef.current.panRight = false; }
      if (e.key === 'ArrowUp'    || e.key === 'w' || e.key === 'W') inputRef.current.up = false;
      if (e.key === 'ArrowDown'  || e.key === 's' || e.key === 'S') inputRef.current.down = false;
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
      // Cinematics skip on first tap.
      if (transmissionRef.current) { e.preventDefault(); finishTransmission(); return; }
      if (extractionRef.current)   { e.preventDefault(); finishExtraction();   return; }
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
      // Build placement: tap = move cursor + confirm if inside range.
      if (placementRef.current) {
        e.preventDefault();
        const t = e.changedTouches[0]; if (!t) return;
        onMouseMove({ clientX: t.clientX, clientY: t.clientY });
        onClick({ clientX: t.clientX, clientY: t.clientY });
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

    // Mouse move tracks cursor world-X for build placement so the
    // ghost preview follows the pointer. Uses the same pl.cameraX
    // the renderer uses (the camera follows the cursor) so screen→
    // world conversion stays consistent frame to frame.
    const onMouseMove = e => {
      const pl = placementRef.current;
      if (!pl) return;
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (CW / r.width);
      const camX = pl.cameraX ?? 0;
      pl.mouseWorldX = mx + camX;
    };

    // Right-click during placement cancels.
    const onContextMenu = e => {
      if (placementRef.current) {
        e.preventDefault();
        cancelPlacement();
      }
    };

    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);


    const loop = now => {
      const dt = Math.min(now - prevT.current, 50); prevT.current = now;
      const gs = gsRef.current;

      // Opening cinematic overrides everything else when present.
      const intro = introRef.current;
      if (intro) {
        if (!intro.startedAt) intro.startedAt = now;
        if (!intro.soundQ) intro.soundQ = [];
        dIntroScene(ctx, intro, now);
        processSounds(intro.soundQ, getAM(), mutedR);
        if (now - intro.startedAt >= INTRO_DURATION) finishIntro();
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      // Game-over cinematic — plays before the stats screen.
      const defeat = defeatRef.current;
      if (defeat) {
        if (!defeat.startedAt) defeat.startedAt = now;
        if (!defeat.soundQ) defeat.soundQ = [];
        dDefeatScene(ctx, defeat, now);
        processSounds(defeat.soundQ, getAM(), mutedR);
        if (now - defeat.startedAt >= DEFEAT_DURATION) finishDefeat();
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      // Intermediate radio transmission cinematic (waves 10/20/25).
      const tr = transmissionRef.current;
      if (tr) {
        if (!tr.startedAt) tr.startedAt = now;
        dTransmissionScene(ctx, tr, now);
        // Fire each scripted line through speakRadio() the first time
        // its offset becomes active.
        const off = now - tr.startedAt;
        while (tr.lineIdx < tr.data.lines.length && off >= tr.data.lines[tr.lineIdx].at) {
          const l = tr.data.lines[tr.lineIdx];
          speakRadio(l.text, { pitch: l.pitch });
          tr.lineIdx++;
        }
        if (off >= tr.data.durMs) finishTransmission();
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      // Wave-30 extraction cinematic — convoy rolling out of Fort Omega.
      const ext = extractionRef.current;
      if (ext) {
        if (!ext.startedAt) ext.startedAt = now;
        dExtractionScene(ctx, ext, now);
        const off = now - ext.startedAt;
        while (ext.lineIdx < EXTRACTION_SCRIPT.length && off >= EXTRACTION_SCRIPT[ext.lineIdx].at) {
          const l = EXTRACTION_SCRIPT[ext.lineIdx];
          speakRadio(l.text, { pitch: l.pitch });
          ext.lineIdx++;
        }
        if (off >= EXTRACTION_DURATION) finishExtraction();
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      // Helicopter evac animation overrides everything else.
      const evac = evacRef.current;
      if (evac) {
        if (!evac.startedAt) evac.startedAt = now;
        if (!evac.soundQ) evac.soundQ = [];
        dEvacScene(ctx, evac, now);
        processSounds(evac.soundQ, getAM(), mutedR);
        if (now - evac.startedAt >= EVAC_DURATION) applyEvac();
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      // Build-placement view: static siege backdrop + soldiers + wall +
      // existing barricades/turrets, plus a ghost preview at the cursor
      // and a green/red overlay marking the valid placement strip.
      const pl = placementRef.current;
      if (pl) {
        ctx.save(); ctx.clearRect(0, 0, CW, CH);
        const [minX, maxX] = pl.validRange;
        // Camera follows the cursor smoothly so the whole valid range
        // is reachable no matter how wide. Smoothing avoids jitter
        // when the cursor moves fast. Clamped so we never scroll off
        // the world.
        const targetCam = Math.max(0, Math.min(WORLD_W - CW, pl.mouseWorldX - CW / 2));
        pl.cameraX = (pl.cameraX ?? targetCam)
                   + (targetCam - (pl.cameraX ?? targetCam)) * 0.18;
        const camX = pl.cameraX;
        ctx.save();
        ctx.translate(-camX, 0);
        dBg(ctx); dBase(ctx, gs.baseHp, gs.baseMaxHp);
        // Draw the existing fort: soldiers, barricades, turrets
        for (let lane = 2; lane >= 0; lane--) {
          gs.soldiers.filter(s => (s.lane || 0) === lane && !s.onExpedition && s.state !== 'dead').forEach(s => dSoldier(ctx, s, now, false));
          if (lane === 2) gs.barricades.forEach(b => dBarricade(ctx, b));
        }
        (gs.turrets || []).forEach(t => dTurret(ctx, t, now));
        // Valid-zone strip on the front lane
        ctx.fillStyle = 'rgba(100, 220, 120, 0.18)';
        ctx.fillRect(minX, GY - 30, maxX - minX, 30);
        ctx.strokeStyle = 'rgba(100, 220, 120, 0.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(minX + 0.5, GY - 30, maxX - minX - 1, 30);
        // Ghost preview at cursor position, clamped to the valid range
        const gx = Math.max(minX, Math.min(maxX, pl.mouseWorldX));
        const inRange = pl.mouseWorldX >= minX && pl.mouseWorldX <= maxX;
        ctx.globalAlpha = 0.7;
        if (pl.kind === 'barricade') {
          dBarricade(ctx, { x: gx, hp: 140, maxHp: 140 });
        } else {
          dTurret(ctx, { x: gx, y: GY - 50, lane: 0, lastShot: 0, hp: 200, maxHp: 200 }, now);
        }
        ctx.globalAlpha = 1;
        // Out-of-range hint: red cross at cursor
        if (!inRange) {
          ctx.strokeStyle = '#dd3333'; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pl.mouseWorldX - 10, GY - 10); ctx.lineTo(pl.mouseWorldX + 10, GY + 10);
          ctx.moveTo(pl.mouseWorldX - 10, GY + 10); ctx.lineTo(pl.mouseWorldX + 10, GY - 10);
          ctx.stroke();
        }
        ctx.restore();
        // Off-screen wall indicator: arrow + "FORT OMEGA" hint when the
        // wall (at WX) has scrolled out of view on the left so the
        // player keeps their bearings while panning far out.
        if (camX > WX + 20) {
          ctx.fillStyle = 'rgba(10, 16, 8, 0.78)';
          ctx.fillRect(6, CH / 2 - 22, 86, 44);
          ctx.strokeStyle = C.acc; ctx.strokeRect(6.5, CH / 2 - 22, 86, 44);
          ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
          ctx.fillText('◀ FORT', 14, CH / 2 - 5);
          ctx.fillText('  OMEGA', 14, CH / 2 + 8);
          ctx.fillStyle = '#88ee99'; ctx.font = '9px monospace';
          ctx.fillText(`${Math.round(camX - WX)}px`, 14, CH / 2 + 18);
        }
        // Off-screen far-edge indicator: when there's more world to
        // the right that the player can reach with the cursor.
        if (camX < WORLD_W - CW - 20) {
          ctx.fillStyle = 'rgba(10, 16, 8, 0.78)';
          ctx.fillRect(CW - 92, CH / 2 - 22, 86, 44);
          ctx.strokeStyle = C.acc; ctx.strokeRect(CW - 91.5, CH / 2 - 22, 86, 44);
          ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'right';
          ctx.fillText('PERIMETER ▶', CW - 12, CH / 2 - 5);
          ctx.fillStyle = '#88ee99'; ctx.font = '9px monospace';
          ctx.fillText(`${Math.round(WORLD_W - CW - camX)}px`, CW - 12, CH / 2 + 8);
        }
        ctx.textAlign = 'left';
        // Header banner (screen space)
        ctx.fillStyle = 'rgba(10, 16, 8, 0.92)';
        ctx.fillRect(0, 0, CW, 36);
        ctx.fillStyle = C.acc; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
        ctx.fillText(`PLACE ${pl.kind === 'barricade' ? '🪵 BARRICADE' : '🛠 MG TURRET'} — click in green zone`, CW / 2, 18);
        ctx.fillStyle = C.txt; ctx.font = '10px monospace';
        ctx.fillText('move cursor freely · [ESC] or right-click to cancel', CW / 2, 31);
        ctx.textAlign = 'left';
        ctx.restore();
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      const m = missionRef.current;
      if (m) {
        m.inputUp    = inputRef.current.up;
        m.inputDown  = inputRef.current.down;
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
        // The siege runs on its own clock (gs.simNow) so it can be
        // paused without effects expiring and fast-forwarded (F / ▶▶)
        // by sub-stepping the update — every timer inside update()
        // compares against this clock, so 2× is a true 2×.
        if (gs.simNow === undefined) gs.simNow = now;
        if (!pausedRef.current) {
          const steps = (gs.speed || 1) > 1 ? 2 : 1;
          for (let i = 0; i < steps && gs.phase === 'siege'; i++) {
            gs.simNow += dt;
            update(gs, gs.simNow, dt);
          }
          processSounds(gs.soundQ, getAM(), mutedR);
        }
        const simNow = gs.simNow;
        // Camera pan from arrow-key input. 0.55 px/ms ≈ 33 px/frame at
        // 60 FPS, clamped to [0, WORLD_W - CW].
        if (inputRef.current.panLeft || inputRef.current.panRight) {
          const panSpd = 0.55 * dt;
          let cx = gs.cameraX || 0;
          if (inputRef.current.panLeft)  cx -= panSpd;
          if (inputRef.current.panRight) cx += panSpd;
          gs.cameraX = Math.max(0, Math.min(WORLD_W - CW, cx));
        }
        if (gs.phase !== 'siege') {
          const am = getAM(); if (am) am.stopBg();
          // Auto-save whenever we transition to management; clear save
          // on terminal outcomes (gameover or victory).
          if (gs.phase === 'management') saveGame(gs);
          else if (gs.phase === 'gameover' || gs.phase === 'victory') clearSave();
          setHasSave(hasSavedGame());
          setUi(mkSnap(gs));
          // Defeat goes through a 24 s cinematic before the stats screen.
          if (gs.phase === 'gameover' && !defeatRef.current) {
            defeatRef.current = { startedAt: 0 };
            setScr('defeat');
          } else if (gs.phase === 'vaccine-briefing') {
            // Wave-30 cleared. Show the playable-mission briefing panel;
            // the player clicks DEPLOY to actually start the campaign.
            setScr('vaccine-briefing');
          } else if (gs.phase === 'extraction' && !extractionRef.current) {
            // (Legacy path — replaced by the playable vaccine campaign.
            // Left intact in case a stale save lands here.)
            extractionRef.current = mkExtraction(gs);
            setScr('extraction');
          } else if (gs.phase === 'management' && gs.pendingTransmission && !transmissionRef.current) {
            // Story-beat transmission queued at wave 10/20/25.
            const wave = gs.pendingTransmission;
            const data = TRANSMISSIONS[wave];
            if (data) {
              transmissionRef.current = { startedAt: 0, wave, data, lineIdx: 0 };
              setScr('transmission');
            } else {
              gs.pendingTransmission = null;
              setScr('management');
            }
          } else {
            setScr(gs.phase);
          }
        } else {
          ctx.save(); ctx.clearRect(0, 0, CW, CH);
          if (gs.shakeTimer > 0) ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3);
          // Camera scroll: pan the world coordinate system left by
          // gs.cameraX so the 900-wide viewport maps to a slice of the
          // wider WORLD_W. HUD is drawn after ctx.restore() so it stays
          // in screen-space and never scrolls.
          ctx.save();
          ctx.translate(-(gs.cameraX || 0), 0);
          dBg(ctx); dBase(ctx, gs.baseHp, gs.baseMaxHp, simNow);
          for (let lane = 2; lane >= 0; lane--) {
            gs.zombies.filter(z => z.state === 'dead' && z.lane === lane).forEach(z => dZombie(ctx, z, simNow));
            gs.zombies.filter(z => z.state !== 'dead' && z.lane === lane).forEach(z => dZombie(ctx, z, simNow));
            gs.humans.filter(h => h.state === 'dead' && h.lane === lane).forEach(h => dHuman(ctx, h, simNow));
            gs.humans.filter(h => h.state !== 'dead' && h.lane === lane).forEach(h => dHuman(ctx, h, simNow));
            gs.soldiers.filter(s => (s.lane || 0) === lane && !s.onExpedition).forEach(s => dSoldier(ctx, s, simNow, s.id === gs.selectedSoldierId));
            if (lane === 2) gs.barricades.forEach(b => dBarricade(ctx, b));
          }
          (gs.turrets || []).forEach(t => dTurret(ctx, t, simNow));
          gs.effects.forEach(e => dFx(ctx, e, simNow));
          gs.bullets.forEach(b => dBlt(ctx, b));
          dSquadMarker(ctx, gs.squadTarget, gs.squadLane, simNow);
          ctx.restore();
          // HUD lives in screen-space.
          dHUD(ctx, gs, simNow, mutedR.current);
          if (pausedRef.current) {
            ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, CW, CH);
            ctx.fillStyle = 'rgba(6,14,6,0.95)'; ctx.fillRect(CW / 2 - 170, CH / 2 - 70, 340, 130);
            ctx.strokeStyle = C.acc; ctx.lineWidth = 1; ctx.strokeRect(CW / 2 - 169.5, CH / 2 - 69.5, 339, 129);
            ctx.fillStyle = C.acc; ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center';
            ctx.fillText('⏸ PAUSED', CW / 2, CH / 2 - 26);
            ctx.fillStyle = C.txt; ctx.font = '11px monospace';
            ctx.fillText('Esc — resume', CW / 2, CH / 2 + 2);
            ctx.fillStyle = 'rgba(184,204,170,0.6)'; ctx.font = '10px monospace';
            ctx.fillText('click lane: move · 1-9: select soldier', CW / 2, CH / 2 + 22);
            ctx.fillText('←/→ or radar: pan · F: 2× speed', CW / 2, CH / 2 + 38);
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
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [toggleMute, togglePause, toggleSpeed, applyEvac, cancelPlacement, confirmPlacement, finishDefeat,
      finishExtraction, finishIntro, finishTransmission, resolveTrade]);

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
  // Map resource keys to the icons used elsewhere in the HUD.
  const resIcon = k => ({
    food: '🥫', ammo: '🔫', sniperAmmo: '🎯',
    turretAmmo: '🟠', medicine: '💊', materials: '🔧',
  }[k] || k);

  const gs = ui || gsRef.current;
  const aliveSols = gs?.soldiers?.filter(s => s.state !== 'dead' && !s.onExpedition) || [];
  const canRecruit  = gs && gs.resources.food >= 20 && gs.resources.materials >= 15 && gs.soldiers.filter(s => s.state !== 'dead').length < BALANCE.maxActiveSoldiers;
  const canBarricadeFlag = gs && gs.resources.materials >= 15 && (gs.barricades?.length || 0) < BALANCE.maxBarricades;
  const canTurret = gs &&
    gs.resources.materials >= BALANCE.turretCostMaterials &&
    (gs.resources.turretAmmo || 0) >= BALANCE.turretCostAmmo &&
    (gs.turrets?.length || 0) < BALANCE.maxTurrets;
  const reserveCount = gs?.reserve?.length || 0;
  const reserveCivCount = gs?.reserve?.filter(r => r.civilian).length || 0;
  const turretCount = gs?.turrets?.length || 0;
  const evacCooldownLeft = gs ? Math.max(0, BALANCE.evacWaveCooldown - (gs.wave - (gs.lastEvacWave ?? -10))) : BALANCE.evacWaveCooldown;
  const canEvac = gs && reserveCivCount >= BALANCE.evacMinReserve && evacCooldownLeft === 0;
  const nextWaveIsHuman = gs && isHumanWaveNumber(gs.wave);

  const resetExp = () => {
    setExpResult(null); setExpPhase(null); setExpEvents([]); setExpVisible(0);
    expSolsRef.current = []; expDstRef.current = null;
    setExpSoldierIdxs([]); setExpDestIdx(null);
    // Re-roll the three destinations on every fresh expedition session
    // so the player never sees the same trio twice in a row.
    expDestsRef.current = rollDestinations();
    setExpDests(expDestsRef.current);
  };

  const sortiesLeft = gs ? BALANCE.expeditionsPerDay - (gs.expeditionsToday || 0) : 0;
  // Expeditions unlock after the first wave is cleared so the player
  // gets a controlled "tutorial" wave before adding the off-map layer.
  const expeditionsUnlocked = !gs || gs.wave >= 2;
  const canSortie = sortiesLeft > 0 && expeditionsUnlocked;
  const partyValid = expSoldierIdxs.length > 0 && expSoldierIdxs.length <= BALANCE.maxExpeditionParty;

  // Total ammo this sortie would draw from the stash based on the
  // currently-selected party + mags loadout. Used by the loadout UI
  // to surface the cost before the player commits.
  const sortieAmmoCost = (() => {
    if (!gs || !partyValid) return { ammo: 0, sniperAmmo: 0 };
    const totals = { ammo: 0, sniperAmmo: 0 };
    expSoldierIdxs.forEach(i => {
      const s = gs.soldiers[i]; if (!s || s.state === 'dead') return;
      const key = s.weapon === 'sniper' ? 'sniperAmmo' : 'ammo';
      const wantLoaded = Math.max(0, s.maxAmmo - (s.ammo || 0));
      const wantSpare  = (magsPerSoldier - 1) * s.maxAmmo;
      totals[key] += wantLoaded + wantSpare;
    });
    return totals;
  })();
  const sortieAmmoCovered = gs ?
    (sortieAmmoCost.ammo <= (gs.resources.ammo || 0) && sortieAmmoCost.sniperAmmo <= (gs.resources.sniperAmmo || 0))
    : false;

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
          <div style={{ color: C.dng, fontWeight: 'bold', fontSize: '20px' }}>WAVE {gs?.wave}/{BALANCE.maxWaves}</div>
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
                  {order && <div style={{ position: 'absolute', top: 4, right: 6, background: C.acc, color: '#061006', fontSize: '9px', fontWeight: 'bold', borderRadius: '50%', width: '14px', height: '14px', textAlign: 'center', lineHeight: '14px' }}>{order}</div>}
                  <div style={{ color: C.acc, fontWeight: 'bold', fontSize: '11px' }}>{s.name}</div>
                  <div style={{ fontSize: '9px', color: C.txt }}>{WPN[s.weapon]?.name}</div>
                  <div style={{ fontSize: '9px', color: s.hp > 60 ? C.acc : s.hp > 30 ? C.wrn : C.dng }}>{s.hp}HP</div>
                </div>
              );
            })}</div>
            <div style={h2}>CHOOSE DESTINATION</div>
            <div style={row}>{expDests.map((d, i) => (
              <div key={i} onClick={() => pickDest(i)} style={{ ...card, cursor: 'pointer', flex: 1, borderColor: expDestIdx === i ? d.riskColor : C.uib, opacity: expDestIdx === i ? 1 : 0.72 }}>
                <div style={{ fontSize: '17px', marginBottom: '2px' }}>{d.icon}</div>
                <div style={{ color: C.acc, fontWeight: 'bold', fontSize: '10px' }}>{d.name}</div>
                <div style={{ color: d.riskColor, fontSize: '8px', fontWeight: 'bold', marginTop: '1px' }}>RISK: {d.risk}</div>
                <div style={{ color: C.txt, fontSize: '8px', marginTop: '2px', lineHeight: '1.4' }}>{d.desc}</div>
                <div style={{ color: '#88ddff', fontSize: '8px', marginTop: '2px' }}>{d.rewards}</div>
              </div>
            ))}</div>
            {/* Loadout selector — how many magazines each soldier carries */}
            <div style={{ marginTop: '10px', background: 'rgba(8,16,8,0.7)', border: `1px solid ${C.uib}`, padding: '8px 12px' }}>
              <div style={{ fontSize: '11px', color: C.txt, marginBottom: '6px', letterSpacing: '.04em' }}>
                LOADOUT — magazines per soldier
              </div>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                {[1, 2, 3, 4].map(n => (
                  <button
                    key={n}
                    style={{
                      ...btn(magsPerSoldier === n ? '#225522' : '#1a1a18', magsPerSoldier === n ? '#44aa44' : '#3a3a36'),
                      fontSize: '11px', padding: '4px 14px',
                    }}
                    onClick={() => { setMagsPerSoldier(n); magsRef.current = n; }}
                  >{n} MAG{n > 1 ? 'S' : ''}</button>
                ))}
              </div>
              <div style={{ fontSize: '9px', marginTop: '6px', color: sortieAmmoCovered ? C.txt : C.dng, opacity: 0.9 }}>
                Stash cost:{' '}
                {sortieAmmoCost.ammo > 0       && <>🔫 {sortieAmmoCost.ammo}{sortieAmmoCost.sniperAmmo > 0 ? '  ·  ' : ''}</>}
                {sortieAmmoCost.sniperAmmo > 0 && <>🎯 {sortieAmmoCost.sniperAmmo}</>}
                {(sortieAmmoCost.ammo + sortieAmmoCost.sniperAmmo) === 0 && <span style={{ opacity: 0.5 }}>(pick a party first)</span>}
                {!sortieAmmoCovered && (sortieAmmoCost.ammo + sortieAmmoCost.sniperAmmo) > 0 && (
                  <span style={{ marginLeft: '8px' }}>⚠ stash short — soldiers will go in light</span>
                )}
              </div>
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                style={btn('#1a3a18')}
                disabled={!partyValid || expDestIdx === null || !canSortie}
                onClick={playMission}
              >🎮 LAUNCH SORTIE</button>
            </div>
            <div style={{ fontSize: '9px', color: C.txt, opacity: 0.5, marginTop: '8px', lineHeight: '1.5' }}>
              You control the first picked soldier; the others follow as AI (auto-shoot in range, knife on dry mag). Lead death = mission failed — but a surviving follower takes point. When a soldier burns through every magazine they holster the firearm and switch to a knife.
              {!expeditionsUnlocked && <><br /><b style={{ color: C.dng }}>LOCKED</b>: expeditions unlock from wave 2 onward.</>}
              {expeditionsUnlocked && sortiesLeft <= 0 && <><br /><b style={{ color: C.dng }}>NIGHTFALL</b>: no more sorties today — survive the next wave to dispatch again.</>}
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
            {Object.keys(expResult.reward || {}).length > 0 && (() => {
              // Split positive recoveries from the foodCost line so the
              // log reads "Recovered: ammo +N  ·  Eaten: 9 food" rather
              // than burying the deduction in the same comma-list.
              const { foodCost, ...gained } = expResult.reward;
              return (
                <>
                  {Object.keys(gained).length > 0 && (
                    <div style={{ fontSize: '11px', color: C.acc, marginTop: '5px' }}>
                      Recovered: {Object.entries(gained).map(([k, v]) => `${k} +${v}`).join('  ·  ')}
                    </div>
                  )}
                  {foodCost > 0 && (
                    <div style={{ fontSize: '11px', color: C.wrn, marginTop: '3px' }}>
                      Eaten on the road: −{foodCost} 🥫
                    </div>
                  )}
                </>
              );
            })()}
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
      <div style={{ display: (scr === 'siege' || scr === 'mission' || scr === 'evac' || scr === 'intro' || scr === 'defeat' || scr === 'transmission' || scr === 'extraction' || scr === 'placement') ? 'flex' : 'none', flexDirection: 'column', alignItems: 'center', padding: '10px 0' }}>
        <canvas ref={cvs} width={CW} height={CH} style={{ border: `1px solid ${C.uib}`, maxWidth: '100%', cursor: scr === 'mission' ? 'crosshair' : 'crosshair', display: 'block', outline: 'none' }} tabIndex={0} />
        {scr === 'siege' && (
          <div style={{ display: 'flex', gap: '7px', marginTop: '7px', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: CW }}>
            <button style={ctrlBtn} onClick={() => moveSquad('retreat')}>◀ RETREAT</button>
            {(() => {
              // Hotkey numbers follow the same order as the 1-9 keys:
              // living, non-rooftop soldiers in roster order.
              const groundIds = (ui?.soldiers || []).filter(s => s.state !== 'dead' && !s.onExpedition && !s.onRoof).map(s => s.id);
              return ui?.soldiers?.filter(s => !s.onExpedition && s.state !== 'dead').map(s => {
                const isSel = ui?.selectedSoldierId === s.id;
                const hk = groundIds.indexOf(s.id) + 1;
                const hpPct = Math.max(0, s.hp / (s.maxHp || 100));
                const hpCol = hpPct > 0.6 ? C.acc : hpPct > 0.3 ? C.wrn : C.dng;
                const stateLbl = s.onRoof ? 'ROOF' : s.state === 'knife' ? 'MELEE' : s.state.toUpperCase();
                return (
                  <div
                    key={s.id}
                    onClick={s.onRoof ? undefined : () => selectSoldierById(s.id)}
                    style={{
                      background: isSel ? 'rgba(40,90,30,0.95)' : 'rgba(18,30,12,0.92)',
                      border: `1px solid ${isSel ? C.acc : s.ammo === 0 ? C.dng : C.uib}`,
                      padding: '3px 8px 4px', minWidth: '92px',
                      cursor: s.onRoof ? 'default' : 'pointer',
                      userSelect: 'none',
                    }}
                    title={s.onRoof ? 'Rooftop sniper — cannot be moved' : `${isSel ? 'Click to deselect' : 'Click to select & move'}${hk ? ` (key ${hk})` : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      {hk > 0 && hk < 10 && <span style={{ color: '#7a8a6a', fontSize: '8px' }}>{hk}</span>}
                      <span style={{ color: s.ammo === 0 ? C.dng : isSel ? '#fff' : C.acc, fontWeight: 'bold', fontSize: '10px' }}>{s.name}</span>
                      <span style={{ color: '#7a7a6a', fontSize: '8px' }}>{s.onRoof ? '▲' : 'FMB'[s.lane || 0]}</span>
                      <span style={{ color: s.ammo === 0 ? C.dng : C.txt, fontSize: '9px', marginLeft: 'auto' }}>{s.ammo}/{s.maxAmmo}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                      <div style={{ flex: 1, height: '3px', background: '#1a1a1a' }}><div style={{ height: '3px', width: `${hpPct * 100}%`, background: hpCol }} /></div>
                      <span style={{ color: '#8a9a7a', fontSize: '7px', letterSpacing: '.04em' }}>{stateLbl}</span>
                    </div>
                  </div>
                );
              });
            })()}
            <button style={ctrlBtn} onClick={() => moveSquad('advance')}>ADVANCE ▶</button>
            <button style={mbtn} onClick={togglePause}>{paused ? '▶ RESUME' : '⏸ PAUSE'}</button>
            <button style={{ ...mbtn, color: fastOn ? C.wrn : C.txt, borderColor: fastOn ? C.wrn : C.uib }} onClick={toggleSpeed} title="Fast-forward (F)">{fastOn ? '▶▶ 2×' : '▶ 1×'}</button>
            <button style={mbtn} onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
            {voiceAvail && (
              <button style={mbtn} onClick={toggleVoice} title="Radio voice (TTS)">{voiceOn ? '🗣' : '🚫'}</button>
            )}
          </div>
        )}
        {scr === 'mission' && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: CW }}>
            {missionRef.current && missionRef.current.state === 'active' ? (
              <>
                <span style={{ color: '#888', fontSize: '10px' }}>← / A or tap-left  ·  → / D or tap-right  ·  SPACE / tap-center : FIRE</span>
                <button style={mbtn} onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
                {voiceAvail && (
                  <button style={mbtn} onClick={toggleVoice} title="Radio voice (TTS)">{voiceOn ? '🗣' : '🚫'}</button>
                )}
              </>
            ) : vaccineRef.current ? (() => {
              const camp = vaccineRef.current;
              const m = camp.current;
              const isLast = camp.currentIndex >= VACCINE_SCENARIOS.length - 1;
              const won = m && m.state === 'won';
              const label = won
                ? (isLast ? '✦ COMPLETE EXTRACTION ✦' : `→ ADVANCE TO ${(VACCINE_SCENARIOS[camp.currentIndex + 1].name).toUpperCase()}`)
                : '✦ END CAMPAIGN ✦';
              return <button style={btn(won ? '#1a3a18' : '#3a1818')} onClick={advanceOrFinishVaccine}>{label}</button>;
            })() : (
              <button style={btn('#1a3a18')} onClick={finalizeMission}>✦ RETURN TO BASE ✦</button>
            )}
          </div>
        )}
        {scr === 'evac' && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: CW }}>
            <span style={{ color: '#88ddff', fontSize: '11px' }}>🚁 Helicopter evac in progress…</span>
            <button style={mbtn} onClick={skipEvac}>⏩ SKIP</button>
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
              <div><div style={h1}>COMMAND CENTER</div><div style={{ color: C.txt, opacity: 0.5, fontSize: '10px', marginTop: '3px' }}>DAY {gs?.day || 1} — Wave {gs?.wave}/{BALANCE.maxWaves} incoming</div></div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
                <div style={{ color: C.dng, fontWeight: 'bold', fontSize: '20px' }}>WAVE {gs?.wave || 1}/{BALANCE.maxWaves}</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button style={mbtn} onClick={toggleMute}>{muted ? '🔇 MUTED' : '🔊 SOUND'}</button>
                  {voiceAvail && (
                    <button style={mbtn} onClick={toggleVoice} title="Radio voice (TTS)">{voiceOn ? '🗣 VOICE' : '🚫 SILENT'}</button>
                  )}
                </div>
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
            {/* Supply drop received from Central Command (wave 10/20/25) */}
            {gs.lastSupplyDrop && gs.lastSupplyDrop.wave === gs.wave && (
              <div style={{ background: 'rgba(20,60,40,0.92)', border: `1px solid #44aa66`, padding: '10px 14px', marginTop: '8px' }}>
                <div style={{ color: '#88ee99', fontWeight: 'bold', fontSize: '13px', letterSpacing: '.05em' }}>
                  📦 SUPPLY DROP RECEIVED — DAY {gs.day}
                </div>
                <div style={{ color: C.txt, fontSize: '11px', marginTop: '4px', lineHeight: '1.5' }}>
                  Central Command parachuted a crate to your perimeter:
                  {' '}
                  {Object.entries(gs.lastSupplyDrop.breakdown).map(([k, v], i, arr) => {
                    const icon = k === 'ammo' ? '🔫' : k === 'food' ? '🥫' : k === 'medicine' ? '💊'
                              : k === 'materials' ? '🔧' : k === 'sniperAmmo' ? '🎯' : k === 'turretAmmo' ? '🟠' : '?';
                    return <span key={k} style={{ color: '#88ee99', fontWeight: 'bold' }}>+{v} {icon}{i < arr.length - 1 ? '  ' : ''}</span>;
                  })}
                </div>
              </div>
            )}
            {/* Wave 30: extraction-day warning */}
            {gs.wave === BALANCE.maxWaves && (
              <div style={{ background: 'rgba(30,20,80,0.92)', border: `1px solid #5a7acc`, padding: '10px 14px', marginTop: '8px' }}>
                <div style={{ color: '#88aaff', fontWeight: 'bold', fontSize: '13px', letterSpacing: '.05em' }}>
                  ★ EXTRACTION DAY — FINAL WAVE
                </div>
                <div style={{ color: C.txt, fontSize: '10px', marginTop: '4px', lineHeight: '1.5' }}>
                  Central Command needs the vaccine sample out. Hold the wall through one last assault — the convoy is on standby.
                </div>
              </div>
            )}
            {/* Daily food consumption report */}
            {gs.lastFoodReport && gs.lastFoodReport.hungry > 0 && (
              <div style={{ background: 'rgba(80,40,20,0.92)', border: `1px solid ${C.wrn}`, padding: '10px 14px', marginTop: '8px' }}>
                <div style={{ color: C.wrn, fontWeight: 'bold', fontSize: '13px', letterSpacing: '.05em' }}>
                  ⚠ DAY {gs.lastFoodReport.day} — RATIONS SHORT
                </div>
                <div style={{ color: C.txt, fontSize: '10px', marginTop: '4px', lineHeight: '1.5' }}>
                  {gs.lastFoodReport.hungry} {gs.lastFoodReport.hungry === 1 ? 'person' : 'people'} went hungry and lost {gs.lastFoodReport.dmg} HP. Every soldier (active + reserve) eats {BALANCE.foodPerPersonPerDay} food per day.
                </div>
              </div>
            )}
            {gs.lastFoodReport && gs.lastFoodReport.hungry === 0 && gs.lastFoodReport.ate > 0 && (
              <div style={{ background: 'rgba(20,40,20,0.85)', border: `1px solid ${C.acc}`, padding: '6px 14px', marginTop: '8px', fontSize: '10px', color: C.txt }}>
                ✔ Day {gs.lastFoodReport.day}: {gs.lastFoodReport.ate} fed, rations holding.
              </div>
            )}
            <hr style={hr} />
            <div style={h2}>📦 RESOURCES</div>
            <div style={row}>
              {[
                ['🥫', 'FOOD',   gs?.resources?.food],
                ['🔫', 'AMMO',   gs?.resources?.ammo],
                ['🎯', 'SNIPER', gs?.resources?.sniperAmmo ?? 0],
                ['🟠', 'MG',     gs?.resources?.turretAmmo ?? 0],
                ['💊', 'MED',    gs?.resources?.medicine],
                ['🔧', 'MAT',    gs?.resources?.materials],
              ].map(([ic, lb, v]) => (
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
                <button style={{ ...btn('#1a2438', '#446699'), fontSize: '10px', padding: '4px 10px' }} disabled={!canTurret} onClick={buildTurret}>🛠 MG TURRET (🔧{BALANCE.turretCostMaterials} 🟠{BALANCE.turretCostAmmo})</button>
                <button
                  style={{ ...btn('#2a1818', '#883333'), fontSize: '10px', padding: '4px 10px' }}
                  disabled={!gs || gs.baseHp >= gs.baseMaxHp || (gs.resources?.materials || 0) < BALANCE.wallRepairCost}
                  onClick={repairWall}
                >🧱 REPAIR WALL (🔧{BALANCE.wallRepairCost} → +{BALANCE.wallRepairHp} HP)</button>
                {!gs?.workbench?.built && (
                  <button
                    style={{ ...btn('#2a2418', '#aa8833'), fontSize: '10px', padding: '4px 10px' }}
                    disabled={!gs || (gs.resources?.materials || 0) < BALANCE.workbenchCost.materials}
                    onClick={buildWorkbench}
                    title="Unlocks the crafting bench (convert materials to ammo / medicine)."
                  >🔨 WORKBENCH (🔧{BALANCE.workbenchCost.materials})</button>
                )}
                {!gs?.researchLab?.built && (
                  <button
                    style={{ ...btn('#2a1828', '#7744aa'), fontSize: '10px', padding: '4px 10px' }}
                    disabled={
                      !gs ||
                      (gs.resources?.materials || 0) < BALANCE.researchLabCost.materials ||
                      (gs.resources?.medicine  || 0) < BALANCE.researchLabCost.medicine
                    }
                    onClick={buildResearchLab}
                    title="Unlocks the research tree (permanent base-wide upgrades)."
                  >🧪 RESEARCH LAB (🔧{BALANCE.researchLabCost.materials} 💊{BALANCE.researchLabCost.medicine})</button>
                )}
              </div>
            </div>
            <div style={row}>
              {gs?.soldiers?.map((s, i) => (
                <div key={s.id} style={{ ...card, opacity: s.state === 'dead' ? 0.34 : 1, borderColor: s.state === 'dead' ? C.dng : C.uib, minWidth: '130px' }}>
                  <div style={{ color: s.state === 'dead' ? C.dng : C.acc, fontWeight: 'bold', fontSize: '11px' }}>
                    {s.name} {s.state === 'dead' && '†'}
                    {s.civilian && s.state !== 'dead' && <span style={{ color: '#88ddff', fontSize: '9px', marginLeft: '2px' }}>· civ</span>}
                    {s.veteran && s.state !== 'dead' && <span style={{ color: '#ffd54a', fontSize: '9px', marginLeft: '2px' }}>· vet</span>}
                  </div>
                  <div style={{ fontSize: '9px', color: C.txt }}>{WPN[s.weapon]?.name} · Lane {'FMB'[s.lane || 0]}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                    <div style={{ flex: 1, height: '3px', background: '#1a1a1a' }}><div style={{ height: '3px', width: `${(s.hp / s.maxHp) * 100}%`, background: s.hp > 60 ? C.acc : s.hp > 30 ? C.wrn : C.dng }} /></div>
                    <span style={{ ...lbl, minWidth: '28px' }}>{s.state === 'dead' ? 'KIA' : `${s.hp}HP`}</span>
                  </div>
                  {s.state !== 'dead' && (() => {
                    const owned = Object.keys(s.upgrades || {});
                    const wbBuilt = !!gs.workbench?.built;
                    return (
                      <>
                        {owned.length > 0 && (
                          <div style={{ fontSize: '9px', marginTop: '3px', letterSpacing: '.03em' }}>
                            {owned.map(pid => {
                              const p = PERKS.find(x => x.id === pid);
                              return p ? <span key={pid} title={`${p.name} — ${p.desc}`} style={{ marginRight: '2px' }}>{p.icon}</span> : null;
                            })}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '3px', marginTop: '3px', flexWrap: 'wrap' }}>
                          {s.hp < s.maxHp && (
                            <button style={{ ...btn('#162814', '#336622'), fontSize: '8px', padding: '2px 6px', marginRight: 0 }} onClick={() => healSoldier(i)} disabled={gs.resources.medicine < 5}>💊 HEAL</button>
                          )}
                          {!s.onRoof && (
                            <button
                              style={{ ...btn('#1a2435', '#3a5588'), fontSize: '8px', padding: '2px 6px', marginRight: 0 }}
                              onClick={() => benchSoldier(i)}
                              disabled={(gs.reserve?.length || 0) >= BALANCE.maxReserveSoldiers}
                              title={(gs.reserve?.length || 0) >= BALANCE.maxReserveSoldiers ? 'Reserve full' : 'Send to reserve'}
                            >🛏 BENCH</button>
                          )}
                          {wbBuilt && !s.civilian && (
                            <button
                              style={{ ...btn('#2a2418', '#aa8833'), fontSize: '8px', padding: '2px 6px', marginRight: 0 }}
                              onClick={() => setUpgOpenId(upgOpenId === s.id ? null : s.id)}
                              title="Buy weapon perks at the workbench"
                            >⚙ UPGRADES {upgOpenId === s.id ? '▴' : '▾'}</button>
                          )}
                        </div>
                        {wbBuilt && upgOpenId === s.id && (
                          <div style={{ marginTop: '4px', borderTop: `1px solid ${C.uib}`, paddingTop: '4px' }}>
                            {PERKS.filter(p => p.weapons === 'all' || p.weapons.includes(s.weapon)).map(p => {
                              const have = !!(s.upgrades && s.upgrades[p.id]);
                              const canPay = !have && Object.entries(p.cost).every(([k, v]) => (gs.resources[k] || 0) >= v);
                              const costLbl = Object.entries(p.cost).map(([k, v]) => `${resIcon(k)}${v}`).join(' ');
                              return (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                                  <span style={{ fontSize: '11px' }}>{p.icon}</span>
                                  <div style={{ flex: 1, fontSize: '8px', lineHeight: '1.25' }}>
                                    <div style={{ color: have ? C.acc : C.txt, fontWeight: 'bold' }}>{p.name}{have ? ' ✔' : ''}</div>
                                    <div style={{ opacity: 0.65 }}>{p.desc}</div>
                                  </div>
                                  {have ? (
                                    <span style={{ fontSize: '8px', color: C.acc }}>OWNED</span>
                                  ) : (
                                    <button
                                      style={{ ...btn('#2a2418', '#aa8833'), fontSize: '8px', padding: '2px 5px', marginRight: 0, marginTop: 0 }}
                                      disabled={!canPay}
                                      onClick={() => upgradeSoldier(i, p.id)}
                                      title={`Pay ${costLbl}`}
                                    >BUY {costLbl}</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
            {(gs?.workbench?.built || gs?.researchLab?.built) && (
              <>
                <hr style={hr} />
                <div style={h2}>🛠 WORKSHOP</div>
                {gs.workbench?.built && (
                  <div style={{ marginBottom: '6px' }}>
                    <div style={{ ...lbl, color: '#ffcc66' }}>🔨 CRAFTING BENCH</div>
                    <div style={{ fontSize: '9px', color: C.txt, opacity: 0.55, marginBottom: '4px' }}>
                      Convert raw materials into combat consumables.
                      {getResearchEffect(gs, 'craftMultiplier', 1) > 1 && (
                        <span style={{ color: '#ffd54a', marginLeft: '6px' }}>
                          · Improved Mags active (+{Math.round((getResearchEffect(gs, 'craftMultiplier', 1) - 1) * 100)}% yield)
                        </span>
                      )}
                    </div>
                    <div style={row}>
                      {CRAFT_RECIPES.map(r => {
                        const mul = getResearchEffect(gs, 'craftMultiplier', 1);
                        const canPay = Object.entries(r.cost).every(([k, v]) => (gs.resources[k] || 0) >= v);
                        const costLbl = Object.entries(r.cost).map(([k, v]) => `${resIcon(k)}${v}`).join(' ');
                        const outLbl  = Object.entries(r.output).map(([k, v]) => `+${Math.max(1, Math.round(v * mul))}${resIcon(k)}`).join(' ');
                        return (
                          <button
                            key={r.id}
                            style={{ ...btn('#2a2410', '#aa8822'), fontSize: '9px', padding: '4px 8px', minWidth: '110px', textAlign: 'left' }}
                            disabled={!canPay}
                            onClick={() => craft(r.id)}
                            title={`${r.name}: pay ${costLbl}, get ${outLbl}`}
                          >
                            {r.icon} {outLbl}
                            <div style={{ fontSize: '8px', opacity: 0.7, marginTop: '2px' }}>cost {costLbl}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {gs.researchLab?.built && (() => {
                  const active = gs.research?.activeId ? RESEARCHES.find(r => r.id === gs.research.activeId) : null;
                  const completed = gs.research?.completed || [];
                  return (
                    <div>
                      <div style={{ ...lbl, color: '#cc99ff' }}>🧪 RESEARCH LAB</div>
                      <div style={{ fontSize: '9px', color: C.txt, opacity: 0.55, marginBottom: '4px' }}>
                        One node at a time. Progress ticks +1 per wave clear. Costs paid up-front; cancel forfeits the spend.
                      </div>
                      {active && (
                        <div style={{ background: 'rgba(40,20,60,0.6)', border: '1px solid #5a3a88', padding: '6px 10px', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ color: '#cc99ff', fontSize: '11px', fontWeight: 'bold' }}>⏳ {active.name}</div>
                            <button style={{ ...btn('#2a1818', '#883333'), fontSize: '8px', padding: '2px 6px', marginRight: 0 }} onClick={cancelResearch}>CANCEL</button>
                          </div>
                          <div style={{ fontSize: '9px', color: C.txt, opacity: 0.7 }}>{active.desc}</div>
                          <div style={{ height: '4px', background: '#1a1a1a', marginTop: '4px' }}>
                            <div style={{ height: '4px', width: `${Math.min(100, (gs.research.progress / active.waves) * 100)}%`, background: '#aa66ff' }} />
                          </div>
                          <div style={{ ...lbl, marginTop: '2px' }}>{gs.research.progress}/{active.waves} waves</div>
                        </div>
                      )}
                      <div style={row}>
                        {RESEARCHES.map(r => {
                          const done = completed.includes(r.id);
                          const isActive = active && active.id === r.id;
                          if (isActive) return null;
                          const canPay = !active && !done && Object.entries(r.cost).every(([k, v]) => (gs.resources[k] || 0) >= v);
                          const costLbl = Object.entries(r.cost).map(([k, v]) => `${resIcon(k)}${v}`).join(' ');
                          return (
                            <div
                              key={r.id}
                              style={{
                                ...card, minWidth: '170px',
                                borderColor: done ? '#446644' : '#3a2a55',
                                background: done ? 'rgba(20,40,20,0.6)' : 'rgba(30,20,50,0.6)',
                                opacity: done ? 0.7 : 1,
                              }}
                            >
                              <div style={{ color: done ? C.acc : '#cc99ff', fontSize: '11px', fontWeight: 'bold' }}>
                                {done ? '✔ ' : ''}{r.name}
                              </div>
                              <div style={{ fontSize: '9px', color: C.txt, opacity: 0.75, marginTop: '2px', lineHeight: '1.3' }}>{r.desc}</div>
                              <div style={{ ...lbl, marginTop: '4px' }}>{r.waves} waves · {costLbl}</div>
                              {!done && (
                                <button
                                  style={{ ...btn('#2a1838', '#7744aa'), fontSize: '9px', padding: '3px 8px', marginTop: '3px', marginRight: 0 }}
                                  disabled={!canPay}
                                  onClick={() => startResearch(r.id)}
                                  title={active ? 'Another research is already running' : !canPay ? 'Not enough resources' : 'Begin research'}
                                >▶ START</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
            {reserveCount > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={h2}>🛏 RESERVE ROSTER ({reserveCount}/{BALANCE.maxReserveSoldiers})</div>
                  {reserveCivCount > 0 && (
                    <button
                      style={{
                        ...btn('#1a2c3a', '#3380b8'),
                        fontSize: '10px', padding: '4px 10px',
                        opacity: canEvac ? 1 : 0.55,
                      }}
                      onClick={callEvac}
                      disabled={!canEvac}
                      title={
                        reserveCivCount < BALANCE.evacMinReserve
                          ? `Need ${BALANCE.evacMinReserve - reserveCivCount} more civilian${BALANCE.evacMinReserve - reserveCivCount === 1 ? '' : 's'} in reserve`
                          : evacCooldownLeft > 0
                            ? `Cool-down: ${evacCooldownLeft} more wave${evacCooldownLeft === 1 ? '' : 's'}`
                            : `Airlift ${reserveCivCount} civilian${reserveCivCount === 1 ? '' : 's'}`
                      }
                    >
                      🚁 EVAC ({reserveCivCount}/{BALANCE.evacMinReserve})
                      {reserveCivCount < BALANCE.evacMinReserve && ` — need ${BALANCE.evacMinReserve - reserveCivCount}`}
                      {reserveCivCount >= BALANCE.evacMinReserve && evacCooldownLeft > 0 && ` — wait ${evacCooldownLeft}w`}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '9px', color: C.txt, opacity: 0.55, marginBottom: '6px' }}>
                  Civilians and recruits at rest. Auto-promoted to active duty when a slot opens up after each wave.
                  Helicopter evac unlocks at <b>{BALANCE.evacMinReserve} civilians</b> in reserve, then needs a {BALANCE.evacWaveCooldown}-wave cool-down between calls.
                  Reward per civ: +{BALANCE.evacFoodPerCiv} food, +{BALANCE.evacMedicinePerCiv} med, +{BALANCE.evacSniperAmmoPerCiv} sniper ammo, +{BALANCE.evacMaterialsPerCiv} materials.
                </div>
                <div style={row}>
                  {gs.reserve.map((r, i) => {
                    const activeFull = gs.soldiers.filter(s => s.state !== 'dead').length >= BALANCE.maxActiveSoldiers;
                    return (
                      <div key={i} style={{ ...card, minWidth: '110px', borderColor: '#1a3a52', background: 'rgba(12,20,30,0.85)' }}>
                        <div style={{ color: '#88ddff', fontWeight: 'bold', fontSize: '11px' }}>
                          {r.name}
                          {r.civilian && <span style={{ color: '#88ddff', fontSize: '8px', marginLeft: '2px' }}>· civ</span>}
                          {r.veteran && <span style={{ color: '#ffd54a', fontSize: '8px', marginLeft: '2px' }}>· vet</span>}
                        </div>
                        <div style={{ fontSize: '9px', color: C.txt }}>{WPN[r.weapon]?.name}</div>
                        <div style={{ fontSize: '8px', color: C.txt, opacity: 0.6, marginTop: '2px' }}>standby</div>
                        <button
                          style={{ ...btn('#1a3028', '#338866'), fontSize: '8px', padding: '2px 6px', marginTop: '3px', marginRight: 0 }}
                          onClick={() => activateReserve(i)}
                          disabled={activeFull}
                          title={activeFull ? 'Active squad full — bench someone first' : 'Promote to active duty'}
                        >⚔ ACTIVATE</button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {turretCount > 0 && (
              <>
                <div style={h2}>🛠 MG TURRETS ({turretCount}/{BALANCE.maxTurrets})</div>
                <div style={{ fontSize: '9px', color: C.txt, opacity: 0.55, marginBottom: '6px' }}>
                  Auto-fire at the closest hostile in range ({BALANCE.turretRange} px). 1 round / shot from the dedicated 🟠 MG pool.
                  Earns +5 🟠 every wave you survive with a turret on the wall.
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
              disabled={!canSortie}
              title={!expeditionsUnlocked ? 'Unlocks after the first wave' : sortiesLeft <= 0 ? 'No sorties left today' : ''}
            >🗺 EXPEDITION{
              !expeditionsUnlocked ? ' — LOCKED'
              : sortiesLeft > 0 ? ` (${sortiesLeft}/${BALANCE.expeditionsPerDay})`
              : ' — NIGHTFALL'
            }</button>
            {!expeditionsUnlocked && (
              <div style={{ fontSize: '9px', color: C.txt, opacity: 0.55, marginTop: '4px', lineHeight: '1.4' }}>
                Expeditions unlock from <b>WAVE 2</b>. Survive the first wave to deploy sorties off-base.
              </div>
            )}
            <button style={btn()} onClick={startWave} disabled={aliveSols.length === 0}>⚔ DEPLOY</button>
            {aliveSols.length === 0 && <span style={{ color: C.dng, fontSize: '11px', marginLeft: '8px' }}>No soldiers available</span>}
            {gs?.resources?.ammo < 30 && <div style={{ color: C.wrn, fontSize: '10px', marginTop: '6px' }}>⚠ Low ammo — soldiers may run dry mid-wave</div>}
          </div>
        </div>
      )}

      {scr === 'expedition' && ExpeditionScreen}

      {scr === 'vaccine-briefing' && (() => {
        const aliveSquad = (gs?.soldiers || []).filter(s => s.state !== 'dead').length;
        const inReserve  = (gs?.reserve || []).length;
        const total = aliveSquad + inReserve;
        return (
          <div style={wrap}>
            <div style={{ ...panel, maxWidth: '660px' }}>
              <div style={{ textAlign: 'center', fontSize: '46px', marginBottom: '6px' }}>📡</div>
              <div style={{ ...h1, color: '#88aaff', fontSize: '22px', textAlign: 'center' }}>FORT OMEGA — FINAL TRANSMISSION</div>
              <hr style={hr} />
              <div style={{ color: C.txt, fontSize: '12px', lineHeight: '1.6', opacity: 0.9 }}>
                Central Command, on the encrypted band:
                <div style={{ color: '#aaccff', marginTop: '8px', fontStyle: 'italic', paddingLeft: '12px', borderLeft: `2px solid ${C.uib}` }}>
                  &ldquo;Fort Omega, this is Central. The vaccine sample at Memorial Hospital is the last working batch on the East Coast. We need it at LZ Bravo within the hour. Push down Highway 17, recover the vial, hold the rooftop for evac. Whoever&rsquo;s still standing &mdash; go.&rdquo;
                </div>
                <div style={{ marginTop: '12px' }}>
                  Three legs:
                  <ol style={{ marginTop: '6px', paddingLeft: '18px', lineHeight: '1.7' }}>
                    {VACCINE_SCENARIOS.map(s => (
                      <li key={s.name}><b style={{ color: s.riskColor }}>{s.icon} {s.name}</b> — <span style={{ opacity: 0.8 }}>{s.desc}</span></li>
                    ))}
                  </ol>
                </div>
              </div>
              <hr style={hr} />
              <div style={row}>
                <div style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>Going</span><div style={{ ...val, fontSize: '20px' }}>{total}</div></div>
                <div style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>Soldiers</span><div style={{ ...val, fontSize: '20px' }}>{aliveSquad}</div></div>
                <div style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>Civilians</span><div style={{ ...val, fontSize: '20px' }}>{inReserve}</div></div>
                <div style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>Mags / Soldier</span><div style={{ ...val, fontSize: '20px' }}>3</div></div>
              </div>
              <hr style={hr} />
              <div style={{ textAlign: 'center' }}>
                <button style={btn('#1a3a5a', '#4474aa')} onClick={startVaccineMission}>📡 DEPLOY — MOVE OUT</button>
              </div>
            </div>
          </div>
        );
      })()}

      {scr === 'gameover' && (
        <div style={wrap}>
          <div style={{ ...panel, textAlign: 'center', maxWidth: '620px' }}>
            <div style={{ fontSize: '48px', marginBottom: '6px' }}>💀</div>
            <div style={{ ...h1, color: C.dng, fontSize: '22px' }}>FORT OMEGA FALLEN</div>
            <hr style={hr} />
            <div style={row}>{[
              ['Days', gs?.day],
              ['Waves Cleared', (gs?.wave || 1) - 1],
              ['Kills', gs?.kills],
              ['Score', gs?.score],
            ].map(([l, v]) => (
              <div key={l} style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>{l}</span><div style={{ ...val, fontSize: '20px' }}>{v}</div></div>
            ))}</div>
            <div style={{ ...row, marginTop: '6px' }}>{[
              ['Play Time', fmtPlayTime(gs)],
              ['Soldiers Lost', gs?.soldiersLost || 0],
              ['Civilians Lost', gs?.civiliansLost || 0],
            ].map(([l, v]) => (
              <div key={l} style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>{l}</span><div style={{ ...val, fontSize: '18px' }}>{v}</div></div>
            ))}</div>
            <hr style={hr} />
            <button style={btn('#5a1a1a', '#883030')} onClick={newGame}>↺ TRY AGAIN</button>
          </div>
        </div>
      )}

      {scr === 'victory' && (() => {
        const r = vaccineResultRef.current;
        const tierMeta = {
          gold:    { emoji: '🏆', title: 'VACCINE DELIVERED — FULL EXTRACTION', color: '#f0c850',
            blurb: 'Vial intact. Squad mostly intact. LZ Bravo lifts you out and Central Command broadcasts the formula across what\'s left of the network. Fort Omega was worth it.' },
          silver:  { emoji: '🥈', title: 'VACCINE DELIVERED — HEAVY LOSSES', color: '#c8c8c8',
            blurb: 'The vial made it onto the chopper. Most of you didn\'t. Central Command will name a street after every one of them — once there are streets again.' },
          bronze:  { emoji: '🥉', title: 'EVAC — VACCINE LOST EN ROUTE', color: '#c8884a',
            blurb: 'You made it out, but the sample didn\'t. Central Command will try again from another vault. Fort Omega bought them more time.' },
          failure: { emoji: '☠', title: 'CONVOY LOST', color: '#aa3030',
            blurb: 'Fort Omega held. The road did not. The vial is somewhere on the asphalt of Highway 17, and Central Command is calling for volunteers from another garrison. You bought them everything you had.' },
        };
        const meta = (r && tierMeta[r.tier]) || { emoji: '🚁', title: 'EXTRACTION COMPLETE', color: '#88aaff',
          blurb: 'You held the wall for 30 waves. Whoever made it out of Fort Omega is on the road now.' };
        return (
        <div style={wrap}>
          <div style={{ ...panel, textAlign: 'center', maxWidth: '640px' }}>
            <div style={{ fontSize: '48px', marginBottom: '6px' }}>{meta.emoji}</div>
            <div style={{ ...h1, color: meta.color, fontSize: '22px' }}>{meta.title}</div>
            <div style={{ color: C.txt, fontSize: '11px', marginTop: '8px', opacity: 0.7, lineHeight: '1.5' }}>
              {meta.blurb}
            </div>
            <hr style={hr} />
            <div style={row}>
              {[
                ['Waves', BALANCE.maxWaves],
                ['Days', gs?.day],
                ['Kills', gs?.kills],
                ['Score', gs?.score],
                ['Survivors', (gs?.soldiers?.filter(s => s.state !== 'dead').length || 0) + (gs?.reserve?.length || 0)],
              ].map(([l, v]) => (
                <div key={l} style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>{l}</span><div style={{ ...val, fontSize: '18px' }}>{v}</div></div>
              ))}
            </div>
            <div style={{ ...row, marginTop: '6px' }}>
              {[
                ['Play Time', fmtPlayTime(gs)],
                ['Soldiers Lost', gs?.soldiersLost || 0],
                ['Civilians Lost', gs?.civiliansLost || 0],
                ['Convoy Cleared', r ? `${r.scenariosCleared} / 3` : '—'],
                ['Vaccine', r ? (r.vaccineDelivered ? '✓' : '✗') : '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ ...card, flex: 1, textAlign: 'center' }}><span style={lbl}>{l}</span><div style={{ ...val, fontSize: '18px' }}>{v}</div></div>
              ))}
            </div>
            <hr style={hr} />
            <button style={btn('#1a3a5a', '#4474aa')} onClick={newGame}>↻ NEW OPERATION</button>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
