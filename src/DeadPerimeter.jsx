import { useState, useEffect, useRef, useCallback } from "react";

// ════════════════════════════════════════════════════════════════
// AUDIO ENGINE
// ════════════════════════════════════════════════════════════════
let _AM = null;
class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value=0.55; this.master.connect(this.ctx.destination);
    this.fx=this.ctx.createGain(); this.fx.gain.value=0.9; this.fx.connect(this.master);
    this.bg=this.ctx.createGain(); this.bg.gain.value=0;   this.bg.connect(this.master);
    this.bgRunning=false; this.bgNodes=[]; this.beatTO=null; this.lastGroan=0; this.lastHit=0;
    const b=this.ctx.createBuffer(1,this.ctx.sampleRate*4,this.ctx.sampleRate);
    const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; this._nb=b;
  }
  _ns(){ const s=this.ctx.createBufferSource(); s.buffer=this._nb; s.loop=true; return s; }
  resume(){ if(this.ctx.state==='suspended') this.ctx.resume(); }
  mute(on){ this.master.gain.setTargetAtTime(on?0:0.55,this.ctx.currentTime,0.05); }
  startBg(){
    if(this.bgRunning) return; this.bgRunning=true;
    this.bg.gain.setTargetAtTime(0.36,this.ctx.currentTime,1.4);
    const w=this._ns(),wf=this.ctx.createBiquadFilter(); wf.type='lowpass'; wf.frequency.value=160;
    const wg=this.ctx.createGain(); wg.gain.value=0.12; w.connect(wf); wf.connect(wg); wg.connect(this.bg); w.start();
    const d1=this.ctx.createOscillator(); d1.type='sawtooth'; d1.frequency.value=55;
    const df=this.ctx.createBiquadFilter(); df.type='lowpass'; df.frequency.value=250; df.Q.value=1.6;
    const dg=this.ctx.createGain(); dg.gain.value=0.30; d1.connect(df); df.connect(dg); dg.connect(this.bg); d1.start();
    const d2=this.ctx.createOscillator(); d2.type='sine'; d2.frequency.value=82.4;
    const d2g=this.ctx.createGain(); d2g.gain.value=0.13; d2.connect(d2g); d2g.connect(this.bg); d2.start();
    this.bgNodes=[w,d1,d2]; this._beat();
  }
  stopBg(){
    if(!this.bgRunning) return; this.bgRunning=false; clearTimeout(this.beatTO);
    this.bg.gain.setTargetAtTime(0,this.ctx.currentTime,1.2);
    setTimeout(()=>{ this.bgNodes.forEach(n=>{try{n.stop();}catch(e){}}); this.bgNodes=[]; },3500);
  }
  _beat(){
    if(!this.bgRunning) return; this._kick(0.26);
    this.beatTO=setTimeout(()=>{
      if(!this.bgRunning) return; this._kick(0.12);
      this.beatTO=setTimeout(()=>{
        if(!this.bgRunning) return; this._kick(0.20);
        this.beatTO=setTimeout(()=>{ if(this.bgRunning) this._beat(); },680+Math.random()*320);
      },510+Math.random()*190);
    },860+Math.random()*300);
  }
  _kick(v){
    if(!this.bgRunning) return; const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(88,t); o.frequency.exponentialRampToValueAtTime(24,t+0.40);
    const g=this.ctx.createGain(); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.50);
    o.connect(g); g.connect(this.bg); o.start(t); o.stop(t+0.55);
  }
  shot(w){
    const t=this.ctx.currentTime;
    const dur=w==='shotgun'?0.32:w==='rifle'?0.22:0.13;
    const vol=w==='shotgun'?1.25:w==='rifle'?0.95:0.70;
    const fc=w==='shotgun'?360:w==='rifle'?880:1650;
    const len=Math.ceil(this.ctx.sampleRate*dur);
    const buf=this.ctx.createBuffer(1,len,this.ctx.sampleRate);
    const d=buf.getChannelData(0); for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,1.4);
    const src=this.ctx.createBufferSource(); src.buffer=buf;
    const bp=this.ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=fc; bp.Q.value=w==='shotgun'?0.4:0.85;
    const gn=this.ctx.createGain(); gn.gain.setValueAtTime(vol,t); gn.gain.exponentialRampToValueAtTime(0.001,t+dur*2.4);
    src.connect(bp); bp.connect(gn); gn.connect(this.fx); src.start(t);
    if(w!=='pistol'){
      const s=this.ctx.createOscillator(); s.type='sine';
      s.frequency.setValueAtTime(w==='shotgun'?72:50,t); s.frequency.exponentialRampToValueAtTime(15,t+0.24);
      const sg=this.ctx.createGain(); sg.gain.setValueAtTime(w==='shotgun'?0.7:0.40,t); sg.gain.exponentialRampToValueAtTime(0.001,t+0.30);
      s.connect(sg); sg.connect(this.fx); s.start(t); s.stop(t+0.32);
    }
  }
  reload(w,dur){
    this._click(510,0.44,0.08);
    setTimeout(()=>this._click(330,0.52,0.07),dur*0.46);
    setTimeout(()=>{ this._click(970,0.62,0.04); setTimeout(()=>this._click(710,0.38,0.035),80); },dur*0.82);
  }
  _click(freq,vol,dur){
    const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(); o.type='sine'; o.frequency.value=freq;
    const og=this.ctx.createGain(); og.gain.setValueAtTime(vol,t); og.gain.exponentialRampToValueAtTime(0.001,t+dur);
    o.connect(og); og.connect(this.fx); o.start(t); o.stop(t+dur+0.01);
    const nl=Math.ceil(this.ctx.sampleRate*dur);
    const nb=this.ctx.createBuffer(1,nl,this.ctx.sampleRate);
    const nd=nb.getChannelData(0); for(let i=0;i<nl;i++) nd[i]=(Math.random()*2-1)*(1-i/nl);
    const ns=this.ctx.createBufferSource(); ns.buffer=nb;
    const nf=this.ctx.createBiquadFilter(); nf.type='bandpass'; nf.frequency.value=freq*2.1; nf.Q.value=4;
    const ng=this.ctx.createGain(); ng.gain.value=vol*0.32;
    ns.connect(nf); nf.connect(ng); ng.connect(this.fx); ns.start(t);
  }
  shell(){
    const t=this.ctx.currentTime; const l=Math.ceil(this.ctx.sampleRate*0.05);
    const b=this.ctx.createBuffer(1,l,this.ctx.sampleRate); const d=b.getChannelData(0);
    for(let i=0;i<l;i++) d[i]=(Math.random()*2-1)*(1-i/l)*0.38;
    const s=this.ctx.createBufferSource(); s.buffer=b;
    const hp=this.ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=2700;
    const g=this.ctx.createGain(); g.gain.value=0.16;
    s.connect(hp); hp.connect(g); g.connect(this.fx); s.start(t);
  }
  hit(now){
    if(now-this.lastHit<85) return; this.lastHit=now;
    const t=this.ctx.currentTime; const l=Math.ceil(this.ctx.sampleRate*0.09);
    const b=this.ctx.createBuffer(1,l,this.ctx.sampleRate); const d=b.getChannelData(0);
    for(let i=0;i<l;i++) d[i]=(Math.random()*2-1)*(1-i/l);
    const s=this.ctx.createBufferSource(); s.buffer=b;
    const lp=this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=680;
    const g=this.ctx.createGain(); g.gain.setValueAtTime(0.26,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.13);
    s.connect(lp); lp.connect(g); g.connect(this.fx); s.start(t);
  }
  zombieDie(type){
    const t=this.ctx.currentTime; const f=type==='tank'?52:type==='runner'?108:78;
    const o=this.ctx.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(f+Math.random()*28,t); o.frequency.exponentialRampToValueAtTime(f*0.33,t+0.68);
    const bp=this.ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=310; bp.Q.value=2.4;
    const g=this.ctx.createGain(); g.gain.setValueAtTime(0.40,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.74);
    o.connect(bp); bp.connect(g); g.connect(this.fx); o.start(t); o.stop(t+0.78);
  }
  groan(now,type){
    if(now-this.lastGroan<2800) return; this.lastGroan=now;
    const t=this.ctx.currentTime;
    const f=type==='tank'?50+Math.random()*16:type==='runner'?98+Math.random()*38:70+Math.random()*32;
    const o=this.ctx.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(f,t); o.frequency.linearRampToValueAtTime(f*0.70,t+0.58); o.frequency.linearRampToValueAtTime(f*0.84,t+1.12);
    const bp=this.ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=370; bp.Q.value=3.0;
    const g=this.ctx.createGain();
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.28,t+0.09);
    g.gain.linearRampToValueAtTime(0.18,t+0.58); g.gain.linearRampToValueAtTime(0,t+1.08);
    o.connect(bp); bp.connect(g); g.connect(this.fx); o.start(t); o.stop(t+1.12);
  }
  zombieAtk(){
    const t=this.ctx.currentTime; const l=Math.ceil(this.ctx.sampleRate*0.15);
    const b=this.ctx.createBuffer(1,l,this.ctx.sampleRate); const d=b.getChannelData(0);
    for(let i=0;i<l;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/l,0.75);
    const s=this.ctx.createBufferSource(); s.buffer=b;
    const lp=this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=300;
    const g=this.ctx.createGain(); g.gain.setValueAtTime(0.48,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.22);
    s.connect(lp); lp.connect(g); g.connect(this.fx); s.start(t);
  }
  baseHit(){
    const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(56,t); o.frequency.exponentialRampToValueAtTime(17,t+0.58);
    const g=this.ctx.createGain(); g.gain.setValueAtTime(0.82,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.68);
    o.connect(g); g.connect(this.fx); o.start(t); o.stop(t+0.72);
    this.lastHit=0; this.hit(0);
  }
  waveCleared(){
    [392,523,659,784].forEach((f,i)=>{
      const t=this.ctx.currentTime+i*0.19;
      const o=this.ctx.createOscillator(); o.type='triangle'; o.frequency.value=f;
      const g=this.ctx.createGain(); g.gain.setValueAtTime(0.20,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.36);
      o.connect(g); g.connect(this.fx); o.start(t); o.stop(t+0.38);
    });
  }
}
function getAM(){ if(!_AM){try{_AM=new AudioEngine();}catch(e){return null;}} if(_AM.ctx.state==='suspended')_AM.ctx.resume(); return _AM; }
function processSounds(q,am,mutedRef){
  if(!am||mutedRef.current){q.length=0;return;}
  q.forEach(e=>{
    switch(e.t){
      case 'shot':  am.shot(e.w);          break; case 'shell': am.shell();          break;
      case 'reload':am.reload(e.w,e.dur);  break; case 'hit':   am.hit(e.now);       break;
      case 'zdie':  am.zombieDie(e.zt);    break; case 'groan': am.groan(e.now,e.zt);break;
      case 'zatk':  am.zombieAtk();        break; case 'bhit':  am.baseHit();        break;
      case 'wclr':  am.waveCleared();      break;
    }
  });
  q.length=0;
}

// ════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════
const CW=900, CH=530, GY=400, WX=162;

// ── DEPTH LANES ─────────────────────────────────────────────────
// Lane 0 = FRONT (nearest, biggest), Lane 2 = BACK (farthest, smallest)
const LANES=[
  {dy:0,   sc:1.00, gshade:'#1d1b11'}, // front
  {dy:-34, sc:0.80, gshade:'#171510'}, // mid
  {dy:-64, sc:0.64, gshade:'#111008'}, // back
];
const laneY = lane => GY + LANES[lane].dy;
const laneSc = lane => LANES[lane].sc;
const clickToLane = my => my < GY-50 ? 2 : my < GY-20 ? 1 : 0;

const C={
  sky1:'#040710',sky2:'#0c1520',g1:'#1d1b11',g2:'#100e08',
  hel:'#2a3922',jac:'#465737',pan:'#384530',sk:'#bf8a6a',boot:'#171210',
  muz:'#ff8800',trc:'#ffee44',bld:'#bc1010',bldd:'#7a0808',
  zsk:'#698059',zcl:'#353226',rsk:'#907f52',rcl:'#262217',tsk:'#466040',tcl:'#172018',
  acc:'#72bc40',dng:'#cc3333',wrn:'#c8a020',txt:'#b8ccaa',
  ui:'rgba(4,8,4,0.97)',uib:'#1d3c12',
  bar:'#7a5a1e', // barricade wood color
};
const WPN={
  rifle:  {name:'M4A1',    dmg:25,range:430,rate:720, ammo:30,rl:1900,spd:14,sp:0.030,ammoCost:30},
  pistol: {name:'Glock 17',dmg:14,range:265,rate:430, ammo:15,rl:1050,spd:11,sp:0.060,ammoCost:15},
  shotgun:{name:'SPAS-12', dmg:50,range:158,rate:1300,ammo:8, rl:2200,spd:9, sp:0.180,pel:5,ammoCost:8},
  sniper: {name:'M24 SWS', dmg:60,range:900,rate:1400,ammo:5, rl:2400,spd:22,sp:0.005,ammoCost:5},
};
const ZTP={
  walker:{hp:60, spd:0.55,dmg:6, sc:C.zsk,cc:C.zcl},
  runner:{hp:35, spd:1.30,dmg:4, sc:C.rsk,cc:C.rcl},
  tank:  {hp:220,spd:0.28,dmg:18,sc:C.tsk,cc:C.tcl},
};
const RECRUIT_NAMES=['Delta','Echo','Foxtrot','Ghost','Hunter','Iris','Kilo','Lima','Mako','Nova','Oscar','Puma','Quinn','Recon','Sierra','Tango','Viper','Wolf'];
const RECRUIT_WEAPONS=['rifle','rifle','pistol','pistol','shotgun'];
const EXPEDITION_DESTS=[
  {name:'Ruined Hospital', icon:'🏥', risk:'LOW',  riskColor:'#44bb44',
   desc:'Scout nearby clinic ruins. Low zombie density.',
   rewards:'Medicine +15–25, food +10–18, chance of civilian', solDmg:[0,14],
   missionLen:1400, zSpawn:0.6}, // playable parameters
  {name:'Armory Cache',    icon:'🔫', risk:'MED',  riskColor:C.wrn,
   desc:'Raid an overrun armory depot. Heavy resistance.',
   rewards:'Ammo +20–40, materials +5–12, chance of civilian', solDmg:[10,34],
   missionLen:1700, zSpawn:1.1},
  {name:'Downtown Core',   icon:'🏙️', risk:'HIGH', riskColor:C.dng,
   desc:'Dangerous run into the city center. Maximum reward.',
   rewards:'All resources + materials, civilian guaranteed', solDmg:[20,58],
   missionLen:2000, zSpawn:1.7},
];

// ── MISSION (playable side-scroll) ─────────────────────────────
const MISSION_W=1900;        // total scroll width
const MISSION_VIEW=CW;       // visible width = canvas width
const MGY=GY;                // mission ground y
const objIcons={medicine:'💊',ammo:'🔫',food:'🥫',materials:'🔧',sniperAmmo:'🎯',civilian:'👤'};

const STARS =Array.from({length:28},(_,i)=>({x:(i*181+53)%CW,y:(i*97+17)%(GY-80),r:i%4===0?1.3:.7}));
const BLDGS=[{x:445,w:72,h:162},{x:562,w:58,h:138},{x:655,w:90,h:190},{x:775,w:52,h:118},{x:843,w:62,h:156}];
let _id=200; const uid=()=>++_id;
const rng=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;

// ════════════════════════════════════════════════════════════════
// ENTITIES
// ════════════════════════════════════════════════════════════════
const mkSoldier=(name,weapon,destX,hp=100,lane=0,civilian=false,onRoof=false)=>{
  const w=WPN[weapon];
  return{id:uid(),name,weapon,destX,lane,x:WX+20,hp,maxHp:100,
    ammo:0,maxAmmo:w.ammo,state:'walk',facing:1,civilian,onRoof,
    lastShot:0,reloadStart:0,shootAt:0,knifeTimer:0,recoil:0,
    walkPhase:Math.random()*Math.PI*2,hurtTimer:0,reloadTriggered:false,onExpedition:false};
};
const mkZombie=type=>{
  const z=ZTP[type];
  return{id:uid(),type,z,x:CW+50,
    lane:Math.floor(Math.random()*3), // random lane
    hp:z.hp,maxHp:z.hp,
    spd:z.spd*(0.82+Math.random()*0.36),state:'walk',facing:-1,
    walkPhase:Math.random()*Math.PI*2,atkTimer:0,hurtTimer:0,deadAt:0,targetSolId:null,targetBarId:null};
};
const mkBarricade=(x)=>({id:uid(),x,hp:140,maxHp:140}); // spans all lanes
const mkWave=n=>{
  const q=[],nw=5+n*3,nr=Math.max(0,n-1)*2,nt=Math.max(0,n-3);
  for(let i=0;i<nw;i++) q.push({type:'walker',at:i*1700+Math.random()*600});
  for(let i=0;i<nr;i++) q.push({type:'runner',at:1800+i*950+Math.random()*400});
  for(let i=0;i<nt;i++) q.push({type:'tank',  at:3500+i*4000});
  return q.sort((a,b)=>a.at-b.at);
};
const mkGS=()=>{
  const delta=mkSoldier('Delta','sniper',0,100,0,false,true); // onRoof=true
  delta.x=WX-40; delta.state='idle';
  return{
  phase:'menu',day:1,wave:1,baseHp:200,baseMaxHp:200,
  resources:{food:40,ammo:80,medicine:6,materials:25,sniperAmmo:5},
  soldiers:[
    mkSoldier('Alpha',  'rifle', 224,100,0),
    mkSoldier('Bravo',  'rifle', 248,100,1),
    mkSoldier('Charlie','pistol',272,100,2),
    delta, // sniper on the rooftop
  ],
  zombies:[],bullets:[],effects:[],barricades:[],soundQ:[],
  spawnQueue:[],waveTime:0,waveClearAt:null,waveComplete:false,
  score:0,kills:0,zombiesSpawned:0,shakeTimer:0,
  squadTarget:null, squadLane:null, selectedSoldierId:null,
  expeditionResult:null,
  isHumanWave:false, // true if current wave is hostile survivors instead of zombies
  usedNames:new Set(['Alpha','Bravo','Charlie','Delta']),
};};

// ════════════════════════════════════════════════════════════════
// DRAW — BACKGROUND (with lane strips)
// ════════════════════════════════════════════════════════════════
function dBg(ctx){
  // Sky
  const sg=ctx.createLinearGradient(0,0,0,GY-80);sg.addColorStop(0,C.sky1);sg.addColorStop(1,C.sky2);
  ctx.fillStyle=sg;ctx.fillRect(0,0,CW,GY-80);
  STARS.forEach(s=>{ctx.fillStyle=`rgba(255,255,255,${0.35+s.r*0.22})`;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle='rgba(200,212,185,0.13)';ctx.beginPath();ctx.arc(818,42,22,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(255,80,0,0.07)';ctx.beginPath();ctx.arc(660,GY-90,90,0,Math.PI*2);ctx.fill();
  // Ruined buildings
  BLDGS.forEach(b=>{
    ctx.fillStyle='#090c11';ctx.fillRect(b.x,GY-80-b.h,b.w,b.h);ctx.fillRect(b.x+b.w-20,GY-80-b.h-14,20,14);
    for(let wx=b.x+8;wx<b.x+b.w-8;wx+=18)
      for(let wy=GY-80-b.h+12;wy<GY-90;wy+=22)
        if(Math.sin((b.x+wx)*0.1+wy*0.07)>0.15){ctx.fillStyle='#0d1828';ctx.fillRect(wx,wy,10,12);}
  });

  // ── LANE GROUND STRIPS (back→front, each darker→lighter) ──────
  // Back lane strip
  ctx.fillStyle=LANES[2].gshade; ctx.fillRect(WX,GY+LANES[2].dy-4,CW-WX,38);
  // Ground line back lane
  ctx.strokeStyle='#1a1810';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(WX,GY+LANES[2].dy);ctx.lineTo(CW,GY+LANES[2].dy);ctx.stroke();

  // Mid lane strip
  ctx.fillStyle=LANES[1].gshade; ctx.fillRect(WX,GY+LANES[1].dy-4,CW-WX,38);
  ctx.strokeStyle='#201e12';
  ctx.beginPath();ctx.moveTo(WX,GY+LANES[1].dy);ctx.lineTo(CW,GY+LANES[1].dy);ctx.stroke();

  // Front lane + full ground
  const gg=ctx.createLinearGradient(0,GY,0,CH);gg.addColorStop(0,C.g1);gg.addColorStop(1,C.g2);
  ctx.fillStyle=gg;ctx.fillRect(0,GY,CW,CH-GY);
  ctx.strokeStyle='#2a2716';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(0,GY);ctx.lineTo(CW,GY);ctx.stroke();

  // Lane labels (faint)
  ctx.fillStyle='rgba(80,80,60,0.28)';ctx.font='8px monospace';
  ctx.fillText('FRONT',WX+6,GY+12);
  ctx.fillText('MID',  WX+6,GY+LANES[1].dy+12);
  ctx.fillText('BACK', WX+6,GY+LANES[2].dy+12);
}

// ════════════════════════════════════════════════════════════════
// DRAW — BASE
// ════════════════════════════════════════════════════════════════
function dBase(ctx,hp,mhp){
  const g=ctx.createLinearGradient(0,0,WX,0);g.addColorStop(0,'#141210');g.addColorStop(1,'#272219');
  ctx.fillStyle=g;ctx.fillRect(0,GY-160,WX+12,160+(CH-GY));
  for(let py=GY-150;py<GY+15;py+=32){ctx.fillStyle='#2d2720';ctx.fillRect(5,py,WX,24);ctx.strokeStyle='#181310';ctx.lineWidth=1;ctx.strokeRect(5,py,WX,24);}
  ctx.fillStyle='#37312a';ctx.fillRect(0,GY-160,WX+12,8);
  for(let bx=8;bx<WX;bx+=22){ctx.fillStyle='#1e1a15';ctx.fillRect(bx,GY-175,13,20);}
  ctx.strokeStyle='#484840';ctx.lineWidth=1;for(let wx=5;wx<WX;wx+=10){ctx.beginPath();ctx.arc(wx,GY-160,5,0,Math.PI*2);ctx.stroke();}
  for(let sx=5;sx<WX+80;sx+=20){
    ctx.fillStyle='#483c28';ctx.beginPath();ctx.ellipse(sx+8,GY+4,10,7,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#3c3020';ctx.beginPath();ctx.ellipse(sx+18,GY+6,10,6,0.2,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#15120e';ctx.fillRect(14,GY-135,126,26);ctx.strokeStyle='#467822';ctx.lineWidth=1;ctx.strokeRect(14,GY-135,126,26);
  ctx.fillStyle=C.acc;ctx.font='bold 11px monospace';ctx.fillText('✦ FORT OMEGA ✦',20,GY-115);
  const bw=WX+12,pct=hp/mhp;ctx.fillStyle='#1a1a1a';ctx.fillRect(0,GY-175,bw,5);
  ctx.fillStyle=pct>0.6?C.acc:pct>0.3?C.wrn:C.dng;ctx.fillRect(0,GY-175,bw*pct,5);
}

// ════════════════════════════════════════════════════════════════
// DRAW — ROOFTOP SNIPER  (stationary, on top of fort wall)
// ════════════════════════════════════════════════════════════════
function dRooftopSniper(ctx,sn,now){
  ctx.save();
  ctx.translate(sn.x,sn.y);

  // Sandbag emplacement under sniper
  ctx.fillStyle='#483c28';
  ctx.beginPath();ctx.ellipse(-12,8,12,5,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#3c3020';
  ctx.beginPath();ctx.ellipse(8,8,13,5,0.1,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#5a4830';
  ctx.beginPath();ctx.ellipse(-2,4,12,5,-0.1,0,Math.PI*2);ctx.fill();

  // Idle subtle bob
  const bob=Math.sin(now/650)*1.2;
  ctx.translate(0,bob);

  // Crouched / prone profile (kneeling). Body is wider, lower stance.
  // Legs (folded under)
  ctx.fillStyle=C.pan;ctx.fillRect(-6,-2,14,6);
  ctx.fillStyle=C.boot;ctx.fillRect(-7,2,7,4);ctx.fillRect(2,2,7,4);

  // Torso (leaning forward, prone-style)
  ctx.fillStyle=C.jac;ctx.fillRect(-9,-15,18,15);
  ctx.fillStyle='#3b4d2e';ctx.fillRect(-7,-12,5,4);ctx.fillRect(2,-12,5,4); // pockets
  ctx.fillStyle='#181408';ctx.fillRect(-9,-3,18,2); // belt

  // Head & helmet
  ctx.fillStyle=C.sk;ctx.beginPath();ctx.ellipse(2,-19,6,7,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=C.hel;ctx.beginPath();ctx.arc(2,-21,8,Math.PI,0);ctx.fill();
  ctx.fillRect(-6,-21,16,5);ctx.fillRect(-7,-17,18,3);
  // Scope band
  ctx.fillStyle='#0a1808';ctx.fillRect(-2,-17,8,3);

  // Sniper rifle — long barrel pointing right
  // Stock (under shoulder)
  ctx.fillStyle='#3a2810';ctx.fillRect(-10,-9,8,5);
  // Body / receiver
  ctx.fillStyle='#181614';ctx.fillRect(-2,-10,16,5);
  // Magazine
  ctx.fillStyle='#222018';ctx.fillRect(2,-5,6,7);
  // Long barrel (cherry-pick recoil for shake)
  const recoil=sn.recoil>0?Math.sin(now/30)*1.5:0;
  ctx.fillStyle='#0e0c0a';ctx.fillRect(14-recoil,-9,28,3);
  // Bipod
  ctx.strokeStyle='#222018';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(20,-7);ctx.lineTo(18,1);ctx.stroke();
  ctx.beginPath();ctx.moveTo(24,-7);ctx.lineTo(26,1);ctx.stroke();
  // Scope (big optic)
  ctx.fillStyle='#1a1816';ctx.fillRect(2,-15,10,5);
  ctx.fillStyle='#3e3838';ctx.fillRect(3,-14,8,3);
  ctx.fillStyle='#1a1816';ctx.beginPath();ctx.arc(3,-12,2.5,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(11,-12,2.5,0,Math.PI*2);ctx.fill();
  // Suppressor
  ctx.fillStyle='#1c1a18';ctx.fillRect(40-recoil,-10,8,5);

  // Muzzle flash on shot
  if(now-sn.shootAt<90){
    const fa=1-(now-sn.shootAt)/90;
    ctx.save();ctx.globalAlpha=fa;
    const fl=ctx.createRadialGradient(50,-7,0,50,-7,16);
    fl.addColorStop(0,'rgba(255,230,80,1)');fl.addColorStop(0.4,'rgba(255,100,0,0.7)');fl.addColorStop(1,'rgba(255,50,0,0)');
    ctx.fillStyle=fl;ctx.beginPath();ctx.arc(50,-7,16,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(50,-7,4,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  ctx.restore();

  // "ROOFTOP" label and kill counter
  ctx.fillStyle=C.acc;ctx.font='bold 7px monospace';ctx.textAlign='center';
  ctx.fillText('SNIPER',sn.x,sn.y+18);
  if(sn.kills>0){
    ctx.fillStyle=C.txt;ctx.font='7px monospace';
    ctx.fillText(`☠ ${sn.kills}`,sn.x,sn.y-30);
  }
  ctx.textAlign='left';
}

// ════════════════════════════════════════════════════════════════
// DRAW — BARRICADE  (spans all 3 lanes as a continuous wall)
// ════════════════════════════════════════════════════════════════
function dBarricade(ctx,b){
  const pct=b.hp/b.maxHp;

  // ── Connecting side posts (depth perspective back→front) ──────
  // Draw diagonal connecting sides between lane faces
  for(let i=0;i<2;i++){
    const ly0=laneY(2-i),sc0=laneSc(2-i);
    const ly1=laneY(1-i),sc1=laneSc(1-i);
    // Left post connecting strip
    ctx.fillStyle='#3a2810';
    ctx.beginPath();
    ctx.moveTo(b.x-16*sc0,ly0); ctx.lineTo(b.x-16*sc1,ly1);
    ctx.lineTo(b.x-13*sc1,ly1); ctx.lineTo(b.x-13*sc0,ly0);
    ctx.closePath();ctx.fill();
    // Right post connecting strip
    ctx.beginPath();
    ctx.moveTo(b.x+13*sc0,ly0); ctx.lineTo(b.x+13*sc1,ly1);
    ctx.lineTo(b.x+16*sc1,ly1); ctx.lineTo(b.x+16*sc0,ly0);
    ctx.closePath();ctx.fill();
    // Top plank connecting (dark top strip)
    ctx.fillStyle='#281c08';
    ctx.beginPath();
    ctx.moveTo(b.x-16*sc0,ly0-22*sc0); ctx.lineTo(b.x-16*sc1,ly1-22*sc1);
    ctx.lineTo(b.x+16*sc1,ly1-22*sc1); ctx.lineTo(b.x+16*sc0,ly0-22*sc0);
    ctx.closePath();ctx.fill();
    // Mid rail connecting
    ctx.fillStyle='#4a3210';
    ctx.beginPath();
    ctx.moveTo(b.x-16*sc0,ly0-13*sc0); ctx.lineTo(b.x-16*sc1,ly1-13*sc1);
    ctx.lineTo(b.x+16*sc1,ly1-13*sc1); ctx.lineTo(b.x+16*sc0,ly0-13*sc0);
    ctx.closePath();ctx.fill();
  }

  // ── Barricade face at each lane (back→front for occlusion) ────
  for(let lane=2;lane>=0;lane--){
    const ly=laneY(lane),sc=laneSc(lane);
    ctx.save();ctx.translate(b.x,ly);ctx.scale(sc,sc);

    // Main plank body
    ctx.fillStyle='#5a3e18';ctx.fillRect(-16,-22,32,22);
    // Plank vertical divisions
    ctx.fillStyle='#4a3210';
    ctx.fillRect(-15,-21,10,20);ctx.fillRect(-4,-21,9,20);ctx.fillRect(6,-21,9,20);
    // Horizontal reinforcing strips
    ctx.fillStyle='#6a4820';ctx.fillRect(-16,-14,32,3);ctx.fillRect(-16,-7,32,2);
    // Left/right posts
    ctx.fillStyle='#3a2810';ctx.fillRect(-17,-22,3,22);ctx.fillRect(14,-22,3,22);
    // Wood grain lines
    ctx.fillStyle='rgba(0,0,0,0.12)';
    for(let gy=-18;gy<0;gy+=5)ctx.fillRect(-14,gy,28,1);
    // Damage
    if(pct<0.66){ctx.strokeStyle='rgba(0,0,0,0.45)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-3,-20);ctx.lineTo(4,-9);ctx.lineTo(0,-5);ctx.stroke();}
    if(pct<0.33){ctx.beginPath();ctx.moveTo(6,-19);ctx.lineTo(12,-7);ctx.stroke();}

    // Front lane extras
    if(lane===0){
      // Sandbags at base
      ctx.fillStyle='#584030';ctx.beginPath();ctx.ellipse(-10,1,10,6,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#4a3228';ctx.beginPath();ctx.ellipse(5,2,11,5,0.2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#503a2e';ctx.beginPath();ctx.ellipse(17,1,8,5,-0.1,0,Math.PI*2);ctx.fill();
      // Barbed wire on top
      ctx.strokeStyle='#484840';ctx.lineWidth=1.5;
      ctx.beginPath();for(let wx=-12;wx<12;wx+=7){ctx.arc(wx,-23,3.5,0,Math.PI*2);}ctx.stroke();
      // HP bar (world space, drawn after restore)
    }
    ctx.restore();
  }
  // HP bar in world space (at front lane)
  const frontY=laneY(0);
  ctx.fillStyle='#1a1a1a';ctx.fillRect(b.x-20,frontY-34,40,5);
  ctx.fillStyle=pct>0.5?C.wrn:C.dng;ctx.fillRect(b.x-20,frontY-34,40*pct,5);
  ctx.fillStyle=C.txt;ctx.font='8px monospace';ctx.textAlign='center';
  ctx.fillText(`${b.hp}/${b.maxHp}`,b.x,frontY-37);ctx.textAlign='left';
}

// ════════════════════════════════════════════════════════════════
// DRAW — WEAPONS
// ════════════════════════════════════════════════════════════════
function dWpn(ctx,w,rcl=0){
  ctx.save();ctx.translate(-rcl,0);
  if(w==='rifle'){
    ctx.fillStyle='#1a1816';ctx.fillRect(-22,-3,13,5);ctx.fillStyle='#252220';ctx.fillRect(-22,-5,13,3);ctx.fillStyle='#111010';ctx.fillRect(-22,2,13,2);
    ctx.fillStyle='#2c2a26';ctx.fillRect(-10,-4,8,7);
    ctx.fillStyle='#22201c';ctx.beginPath();ctx.moveTo(-2,-8);ctx.lineTo(20,-8);ctx.lineTo(20,3);ctx.lineTo(-2,3);ctx.closePath();ctx.fill();
    ctx.fillStyle='#1c1a16';ctx.beginPath();ctx.moveTo(4,3);ctx.lineTo(10,3);ctx.lineTo(8,18);ctx.lineTo(2,18);ctx.closePath();ctx.fill();
    ctx.fillStyle='#141210';for(let gy=5;gy<17;gy+=3)ctx.fillRect(3,gy,6,1.5);
    ctx.strokeStyle='#1a1816';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(6,9,5.5,0.05,Math.PI*0.92);ctx.stroke();
    ctx.fillStyle='#2a2824';ctx.beginPath();ctx.moveTo(5,3);ctx.lineTo(13,3);ctx.lineTo(12,20);ctx.lineTo(4,20);ctx.closePath();ctx.fill();
    ctx.fillStyle='#1e1c18';ctx.fillRect(7,3,2,17);
    ctx.fillStyle='#2a2824';ctx.fillRect(-2,-16,34,9);ctx.fillStyle='#1e1c18';ctx.fillRect(0,-18,30,3);ctx.fillStyle='#161412';for(let rx=1;rx<29;rx+=4)ctx.fillRect(rx,-18,2,3);
    ctx.fillStyle='#302e2a';ctx.fillRect(20,-15,18,10);ctx.fillStyle='#1e1c18';for(let rx=22;rx<36;rx+=5){ctx.fillRect(rx,-15,2,2);ctx.fillRect(rx,-3,2,2);}ctx.fillStyle='#1a1816';ctx.fillRect(20,-8,18,2);
    ctx.fillStyle='#141210';ctx.fillRect(23,-14,6,3);ctx.fillRect(27,-16,3,3);
    ctx.fillStyle='#181614';ctx.fillRect(38,-6,28,4);
    ctx.fillStyle='#222020';ctx.fillRect(50,-10,5,8);ctx.fillRect(51,-12,3,3);ctx.fillStyle='#1a1816';ctx.fillRect(51,-12,2,7);
    ctx.fillStyle='#181614';ctx.fillRect(62,-12,4,10);ctx.beginPath();ctx.moveTo(61,-12);ctx.lineTo(66,-12);ctx.lineTo(64,-15);ctx.closePath();ctx.fill();
    ctx.fillStyle='#141210';ctx.fillRect(64,-7,6,6);ctx.fillStyle='#0e0d0c';ctx.fillRect(65,-9,2,2);ctx.fillRect(65,1,2,2);ctx.fillRect(68,-9,2,2);ctx.fillRect(68,1,2,2);
  }else if(w==='pistol'){
    ctx.fillStyle='#2c1c0e';ctx.beginPath();ctx.moveTo(-2,3);ctx.lineTo(9,3);ctx.lineTo(7,19);ctx.lineTo(-4,19);ctx.closePath();ctx.fill();
    ctx.fillStyle='#1e1208';for(let gx=0;gx<3;gx++)for(let gy=0;gy<5;gy++){ctx.beginPath();ctx.arc(-1+gx*3,8+gy*2.1,0.75,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#1c1208';ctx.beginPath();ctx.arc(7.5,5.5,2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#2c1c0e';ctx.fillRect(-2,4,14,5);ctx.fillStyle='#1e1208';ctx.fillRect(6,4,5,6);
    ctx.fillStyle='#241808';ctx.fillRect(-3,1,26,3);ctx.fillStyle='#201e1a';ctx.fillRect(-4,-5,30,10);
    ctx.fillStyle='#2e2c28';ctx.beginPath();ctx.moveTo(-4,-14);ctx.lineTo(28,-14);ctx.lineTo(28,-5);ctx.lineTo(-4,-5);ctx.closePath();ctx.fill();
    ctx.fillStyle='#1a1816';for(let sx=1;sx>=-5;sx-=2.5)ctx.fillRect(sx,-13,1.5,8);
    ctx.fillStyle='#141210';ctx.fillRect(8,-13,14,8);ctx.fillStyle='#0c0b0a';ctx.fillRect(9,-12,12,6);
    ctx.fillStyle='#2e2c28';ctx.fillRect(10,-10,10,3);ctx.fillStyle='#181614';ctx.fillRect(28,-11,14,4);
    ctx.fillStyle='#141210';ctx.fillRect(-2,-16,7,3);ctx.fillStyle='#e8e8e8';ctx.beginPath();ctx.arc(0,-14,1.1,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(4,-14,1.1,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#141210';ctx.fillRect(22,-16,4,3);ctx.fillStyle='#e83020';ctx.beginPath();ctx.arc(24,-14,1.1,0,Math.PI*2);ctx.fill();
  }else{
    ctx.fillStyle='#2c2a22';ctx.fillRect(-24,-3,14,5);ctx.fillStyle='#1e1c16';ctx.fillRect(-24,-5,4,9);ctx.fillStyle='#222018';ctx.fillRect(-10,-5,5,10);
    ctx.fillStyle='#201e1a';ctx.fillRect(-6,-14,50,19);ctx.fillStyle='#2a2826';ctx.beginPath();ctx.moveTo(-6,-14);ctx.lineTo(44,-14);ctx.lineTo(44,-8);ctx.lineTo(-6,-8);ctx.closePath();ctx.fill();
    ctx.fillStyle='#cc8800';ctx.beginPath();ctx.arc(40,-10,2.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#aa6600';ctx.fillRect(38,-10,2,1);
    ctx.fillStyle='#5e3c1c';ctx.beginPath();ctx.moveTo(7,5);ctx.lineTo(15,5);ctx.lineTo(13,20);ctx.lineTo(5,20);ctx.closePath();ctx.fill();
    ctx.fillStyle='#3e2810';for(let gy=7;gy<19;gy+=3)ctx.fillRect(6,gy,8,1.5);
    ctx.strokeStyle='#5e3c1c';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(10,12,6.5,0,Math.PI*0.88);ctx.stroke();
    ctx.fillStyle='#262420';ctx.fillRect(12,3,32,7);ctx.fillStyle='#2e2c28';ctx.fillRect(12,4,32,2);ctx.fillStyle='#1e1c18';ctx.fillRect(12,9,32,2);
    ctx.fillStyle='#1c1a16';ctx.fillRect(12,-14,32,8);ctx.fillStyle='#262422';ctx.fillRect(12,-14,32,2);ctx.fillStyle='#141210';ctx.fillRect(12,-6,32,2);
    ctx.fillStyle='#4c3216';ctx.beginPath();ctx.moveTo(16,-14);ctx.lineTo(30,-14);ctx.lineTo(30,10);ctx.lineTo(16,10);ctx.closePath();ctx.fill();
    ctx.fillStyle='#341e0a';for(let px=18;px<29;px+=3)ctx.fillRect(px,-13,1.5,22);
    ctx.fillStyle='#1a1814';ctx.fillRect(12,-15,32,2);
    ctx.fillStyle='#141210';ctx.fillRect(43,-14,6,8);ctx.fillRect(43,3,6,7);ctx.fillStyle='#0a0908';ctx.fillRect(44,-12,4,5);ctx.fillRect(44,4,4,4);
    ctx.fillStyle='#cc9900';ctx.beginPath();ctx.arc(43,-11,1.8,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════
// DRAW — SOLDIER  (with lane depth + distinct dead sprite)
// ════════════════════════════════════════════════════════════════
function dSoldier(ctx,s,now,isSelected){
  // ── ROOFTOP SOLDIER — uses the dedicated prone/crouched sprite ───
  // When climbed down (onRoof=false), falls through to the standard ground sprite.
  if(s.onRoof && s.state !== 'dead'){
    const sn={x:s.x, y:GY-160, shootAt:s.shootAt||0, recoil:s.recoil||0, kills:s.kills||0};
    dRooftopSniper(ctx,sn,now);
    // HP bar
    if(s.hp<s.maxHp){
      ctx.fillStyle='#1a1a1a';ctx.fillRect(s.x-18,GY-188,36,4);
      ctx.fillStyle=s.hp>60?'#44bb44':s.hp>30?C.wrn:C.dng;
      ctx.fillRect(s.x-18,GY-188,36*(s.hp/s.maxHp),4);
    }
    // Reload indicator
    if(s.state==='reload'){
      ctx.fillStyle=C.wrn;ctx.font='bold 8px monospace';ctx.textAlign='center';
      ctx.fillText('RELOAD',s.x,GY-194);ctx.textAlign='left';
    }
    // Ammo low warning
    if(s.ammo<=1&&s.state!=='reload'){
      ctx.fillStyle='rgba(200,40,20,0.95)';ctx.font='bold 7px monospace';ctx.textAlign='center';
      ctx.fillText(s.ammo===0?'DRY':'LOW',s.x,GY-194);ctx.textAlign='left';
    }
    // Selection ring around the sandbag emplacement
    if(isSelected){
      const ring=0.7+0.3*Math.sin(now/180);
      ctx.strokeStyle=`rgba(114,188,64,${ring})`;ctx.lineWidth=2;
      ctx.beginPath();ctx.ellipse(s.x,GY-152,22,6,0,0,Math.PI*2);ctx.stroke();
    }
    return;
  }

  const ly = laneY(s.lane);
  const sc = laneSc(s.lane);
  // Civilian uses different color palette + no helmet, baseball cap instead
  const isCiv=s.civilian;
  const COL_jac=isCiv?'#5a3a28':C.jac;     // civ: brown/tan jacket
  const COL_pan=isCiv?'#3a4858':C.pan;     // civ: blue jeans
  const COL_hel=isCiv?'#a04020':C.hel;     // civ: red baseball cap
  const COL_pkt=isCiv?'#4a2a18':'#3b4d2e'; // civ: pocket detail
  ctx.save();
  ctx.translate(s.x, ly);
  ctx.scale(sc*s.facing, sc);

  // ── DEAD SOLDIER — lies on ground, head left (toward base) ────
  if(s.state==='dead'){
    ctx.save();
    // Undo facing flip so corpse always faces same way
    ctx.scale(s.facing,1);

    // Ground shadow
    ctx.fillStyle='rgba(0,0,0,0.22)';
    ctx.beginPath();ctx.ellipse(-20,2,30,6,0,0,Math.PI*2);ctx.fill();
    // Blood pool under torso
    ctx.fillStyle='rgba(110,5,5,0.58)';
    ctx.beginPath();ctx.ellipse(-24,0,12,5,0.2,0,Math.PI*2);ctx.fill();

    // Boots (RIGHT side = feet, x ≈ 0)
    ctx.fillStyle=C.boot;
    ctx.fillRect(-6,-4,7,5);ctx.fillRect(-6,0,7,4);   // upper boot pair
    ctx.fillRect(-8,3,8,4); ctx.fillRect(1,3,8,4);     // soles
    ctx.fillStyle='#0a0808';ctx.fillRect(-8,6,16,2);   // heel line

    // Legs (going left from boots)
    ctx.fillStyle=COL_pan;
    ctx.fillRect(-24,-4,18,4);ctx.fillRect(-24,0,18,4);
    ctx.fillStyle='#2a321e';ctx.fillRect(-22,-5,5,2);  // knee pad

    // Hip/belt
    ctx.fillStyle='#181408';ctx.fillRect(-25,-2,5,3);
    ctx.fillStyle='#372c1a';ctx.fillRect(-26,-2,4,4);  // buckle

    // Torso
    ctx.fillStyle=COL_jac;ctx.fillRect(-40,-8,18,14);
    ctx.fillStyle='#3b4d2e';
    ctx.fillRect(-39,-6,5,4);ctx.fillRect(-31,-6,5,4); // chest pockets
    ctx.fillStyle='#181408';ctx.fillRect(-40,4,18,2);  // jacket bottom

    // Top arm (draped over body toward viewer)
    ctx.save();ctx.translate(-32,-2);ctx.rotate(-0.22);
    ctx.fillStyle=COL_jac;ctx.fillRect(-3,-12,6,14);
    ctx.fillStyle=C.sk;ctx.beginPath();ctx.arc(0,-13,4,0,Math.PI*2);ctx.fill();
    ctx.restore();

    // Bottom arm (lying flat under body, barely visible)
    ctx.fillStyle=COL_jac;ctx.fillRect(-38,5,14,4);ctx.fillStyle=C.sk;ctx.beginPath();ctx.arc(-38+13,7,4,0,Math.PI*2);ctx.fill();

    // Neck
    ctx.fillStyle=C.sk;ctx.fillRect(-44,-4,5,6);

    // Head (side profile, facing left)
    ctx.beginPath();ctx.ellipse(-49,0,7,9,0,0,Math.PI*2);ctx.fillStyle=C.sk;ctx.fill();
    // Closed eye
    ctx.strokeStyle='#8a5a3a';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(-53,0);ctx.lineTo(-47,0);ctx.stroke();

    // Helmet (side on): dome arc + brim
    ctx.fillStyle=COL_hel;
    ctx.beginPath();ctx.arc(-49,-2,10,Math.PI*1.05,0,false);ctx.fill(); // dome
    ctx.fillRect(-59,-2,20,4);  // brim
    ctx.fillRect(-60,1,22,3);   // lower brim
    ctx.fillStyle='#1a2918';ctx.fillRect(-56,1,14,3); // visor
    ctx.fillStyle='#243318';ctx.fillRect(-50,-10,3,5); // top nub

    // Rifle dropped, lying above the body
    ctx.save();ctx.translate(-20,-14);ctx.rotate(0.05);
    ctx.fillStyle='#1a1816';ctx.fillRect(-22,-2,14,4); // stock
    ctx.fillStyle='#252220';ctx.fillRect(-8,-3,30,6);  // receiver
    ctx.fillStyle='#1e1c18';ctx.save();ctx.translate(4,4);ctx.rotate(-0.3);ctx.fillRect(-3,-1,6,12);ctx.restore(); // mag
    ctx.fillStyle='#181614';ctx.fillRect(22,-1,22,3);  // barrel
    ctx.fillStyle='#141210';ctx.fillRect(41,-2,5,5);   // flash hider
    ctx.restore();

    ctx.restore(); ctx.restore();
    return;
  }

  // ── LIVING SOLDIER ────────────────────────────────────────────
  const isWalk=s.state==='walk',isShoot=s.state==='shoot',isRl=s.state==='reload',isKnife=s.state==='knife';
  const t=now/300+s.walkPhase;
  const la=isWalk?Math.sin(t)*28:0,bb=isWalk?Math.abs(Math.sin(t))*2.5:0,aa=isWalk?Math.sin(t)*12:0;
  const breath=(!isWalk&&!isShoot&&!isRl)?Math.sin(now/900+s.walkPhase)*0.7:0;
  const by=-(bb+breath);
  const rcl=isShoot?Math.max(0,1-(now-s.shootAt)/185)*5:0;
  const rlp=isRl?Math.min(1,(now-s.reloadStart)/WPN[s.weapon].rl):0;
  const rla=isRl?(rlp<0.35?(rlp/0.35)*68:rlp<0.65?68:68-((rlp-0.65)/0.35)*68):0;

  ctx.save();ctx.translate(4,-bb);ctx.rotate(la*Math.PI/180);ctx.fillStyle=COL_pan;ctx.fillRect(-4,0,8,20);ctx.fillStyle=C.boot;ctx.fillRect(-4,18,9,8);ctx.fillRect(-4,24,14,5);ctx.restore();
  ctx.save();ctx.translate(-4,-bb);ctx.rotate(-la*Math.PI/180);ctx.fillStyle=COL_pan;ctx.fillRect(-4,0,8,20);ctx.fillStyle=C.boot;ctx.fillRect(-4,18,9,8);ctx.fillRect(-4,24,14,5);ctx.restore();
  ctx.fillStyle=COL_jac;ctx.fillRect(-11,by-34,22,25);ctx.fillStyle='#3b4d2e';ctx.fillRect(-9,by-28,7,5);ctx.fillRect(2,by-28,7,5);ctx.fillStyle='#181408';ctx.fillRect(-11,by-10,22,4);ctx.fillStyle='#372c1a';ctx.fillRect(-3,by-13,6,7);
  if(isRl){
    ctx.save();ctx.translate(6,by-30);ctx.rotate(rla*Math.PI/180);ctx.fillStyle=COL_jac;ctx.fillRect(-4,0,7,16);ctx.fillStyle=C.sk;ctx.beginPath();ctx.arc(0,16,4,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.save();ctx.translate(-4,by-30);ctx.rotate(rla*0.65*Math.PI/180);ctx.fillStyle=COL_jac;ctx.fillRect(-4,0,7,14);ctx.fillStyle=C.sk;ctx.beginPath();ctx.arc(0,14,4,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.save();ctx.translate(8,by-17);ctx.rotate(rla*0.38*Math.PI/180);dWpn(ctx,s.weapon,0);ctx.restore();
    if(rlp>0.28&&rlp<0.67){const drop=(rlp-0.28)/0.39*34,spin=(rlp-0.28)*2.4;ctx.save();ctx.translate(14,by-15+drop);ctx.rotate(spin);ctx.fillStyle='#252018';ctx.fillRect(-3,-6,7,14);ctx.fillStyle='#3a3028';ctx.fillRect(-2,-4,5,3);ctx.restore();}
  }else if(isKnife){
    // Back arm
    ctx.save();ctx.translate(-5,by-31);ctx.fillStyle=COL_jac;ctx.fillRect(-3,0,7,16);ctx.fillStyle=C.sk;ctx.beginPath();ctx.arc(0,16,4,0,Math.PI*2);ctx.fill();ctx.restore();
    // Stabbing arm — lurches forward based on attack phase
    const kf=Math.max(0,1-(now-(s.shootAt||0))/300);
    ctx.save();ctx.translate(4+kf*16,by-30);ctx.rotate(-0.25+kf*0.55);
    ctx.fillStyle=COL_jac;ctx.fillRect(-3,0,7,14);
    ctx.fillStyle=C.sk;ctx.beginPath();ctx.arc(0,14,4,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(0,14);ctx.rotate(-1.0+kf*0.3);
    ctx.fillStyle='#9090a0';ctx.beginPath();ctx.moveTo(-1,-22);ctx.lineTo(2,-22);ctx.lineTo(1,0);ctx.lineTo(-2,0);ctx.closePath();ctx.fill();
    ctx.fillStyle='#888';ctx.fillRect(-1,-24,3,3);
    ctx.fillStyle='#5a3010';ctx.fillRect(-3,0,7,9);
    ctx.fillStyle='#3a1a08';ctx.fillRect(-3,8,7,3);
    ctx.restore();ctx.restore();
  }else{ // shoot / idlectx.fillStyle=COL_jac;ctx.fillRect(-3,0,7,16);ctx.fillStyle=C.sk;ctx.beginPath();ctx.arc(0,16,4,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.save();ctx.translate(4,by-30);ctx.rotate(-aa*0.4*Math.PI/180+(isShoot?0.12:0));ctx.fillStyle=COL_jac;ctx.fillRect(-3,0,7,14);ctx.fillStyle=C.sk;ctx.beginPath();ctx.arc(0,14,4,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.save();ctx.translate(0,by-22);dWpn(ctx,s.weapon,rcl);
    if(isShoot&&now-s.shootAt<90){
      const fa=1-(now-s.shootAt)/90;
      const mx=s.weapon==='rifle'?68:s.weapon==='pistol'?41:48, my=s.weapon==='rifle'?-4:s.weapon==='pistol'?-9:-10;
      ctx.save();ctx.globalAlpha=fa;
      const fl=ctx.createRadialGradient(mx,my,0,mx,my,18);fl.addColorStop(0,'rgba(255,230,80,1)');fl.addColorStop(0.4,'rgba(255,100,0,0.7)');fl.addColorStop(1,'rgba(255,50,0,0)');
      ctx.fillStyle=fl;ctx.beginPath();ctx.arc(mx,my,18,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(mx,my,5,0,Math.PI*2);ctx.fill();
      for(let sp=0;sp<5;sp++){const ang=sp*1.26+fa*4;ctx.fillStyle=C.muz;ctx.fillRect(mx+Math.cos(ang)*10,my+Math.sin(ang)*10,2,2);}
      ctx.restore();
    }
    ctx.restore();
  }
  if(s.ammo<=3&&s.ammo>0&&!isRl){ctx.fillStyle='rgba(200,160,20,0.9)';ctx.font='bold 7px monospace';ctx.textAlign='center';ctx.fillText('LOW',0,by-52);ctx.textAlign='left';}
  if(s.ammo===0&&!isRl){ctx.fillStyle='rgba(200,40,20,0.95)';ctx.font='bold 7px monospace';ctx.textAlign='center';ctx.fillText(isKnife?'🔪':' DRY',0,by-52);ctx.textAlign='left';}
  const hy=by-34;
  ctx.fillStyle=C.sk;ctx.fillRect(-3,hy-5,6,7);ctx.beginPath();ctx.ellipse(0,hy-14,8,9,0,0,Math.PI*2);ctx.fillStyle=C.sk;ctx.fill();
  if(isCiv){
    // Baseball cap: rounded top + visor
    ctx.fillStyle=COL_hel;
    ctx.beginPath();ctx.arc(0,hy-15,9,Math.PI,0);ctx.fill();   // crown
    ctx.fillRect(-9,hy-15,18,3);                                 // band
    ctx.fillStyle='#7a2810';ctx.fillRect(2,hy-18,5,3);           // hat highlight
    // Visor extends forward
    ctx.fillStyle='#5a2010';ctx.beginPath();ctx.ellipse(6,hy-12,10,2,0,0,Math.PI*2);ctx.fill();
    // Beard scruff (visual cue)
    ctx.fillStyle='#3a2818';ctx.fillRect(-2,hy-7,4,2);
  }else{
    ctx.fillStyle=COL_hel;ctx.beginPath();ctx.arc(0,hy-16,10,Math.PI,0);ctx.fill();
    ctx.fillRect(-10,hy-16,20,6);ctx.fillRect(-12,hy-11,24,4);
    ctx.fillStyle='#1a2918';ctx.fillRect(-6,hy-11,12,4);
  }
  if(s.hurtTimer>0){ctx.fillStyle=`rgba(255,30,30,${Math.min(1,s.hurtTimer/200)*0.4})`;ctx.fillRect(-15,hy-22,30,68);}
  ctx.restore();
  // HP bar in world space
  if(s.hp<s.maxHp){
    const bary=ly-Math.round(60*sc);
    ctx.fillStyle='#1a1a1a';ctx.fillRect(s.x-18,bary,36,4);
    ctx.fillStyle=s.hp>60?'#44bb44':s.hp>30?C.wrn:C.dng;ctx.fillRect(s.x-18,bary,36*(s.hp/s.maxHp),4);
  }
  if(isRl){ctx.fillStyle=C.wrn;ctx.font='bold 8px monospace';ctx.textAlign='center';ctx.fillText('RELOAD',s.x,ly-Math.round(68*sc));ctx.textAlign='left';}
  // Selection indicator
  if(isSelected){
    const ring=0.7+0.3*Math.sin(now/180);
    ctx.strokeStyle=`rgba(114,188,64,${ring})`;ctx.lineWidth=2;
    ctx.beginPath();ctx.ellipse(s.x,ly+2,18,5,0,0,Math.PI*2);ctx.stroke();
    // Arrow above head
    ctx.fillStyle=`rgba(114,188,64,${ring})`;
    const arrY=ly-Math.round(74*sc);
    ctx.beginPath();ctx.moveTo(s.x,arrY);ctx.lineTo(s.x-5,arrY-7);ctx.lineTo(s.x+5,arrY-7);ctx.closePath();ctx.fill();
  }
}

// ════════════════════════════════════════════════════════════════
// DRAW — ZOMBIE  (lane-depth + fall animation)
// ════════════════════════════════════════════════════════════════
function dZombie(ctx,z,now){
  const ly=laneY(z.lane), sc=laneSc(z.lane);
  ctx.save();ctx.translate(z.x,ly);ctx.scale(sc,sc);
  if(z.type==='tank') ctx.scale(1.35,1.35);
  ctx.scale(z.facing,1);
  const{sc:zsc,cc}=z.z; // (zsc = zombie skin color, reusing variable name)
  const sc2=z.z.sc; // actual skin color

  if(z.state==='dead'){
    const dp=Math.min(1,(now-z.deadAt)/480);const ease=1-Math.pow(1-dp,2.5);const angle=ease*Math.PI*0.5;
    ctx.rotate(angle);
    if(dp>0.6){ctx.globalAlpha=Math.min(1,(dp-0.6)/0.25);ctx.fillStyle=C.bldd;ctx.beginPath();ctx.arc(16,2,7,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(26,-2,4,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
    ctx.fillStyle=cc;ctx.fillRect(-9,-32,18,32);ctx.fillStyle=sc2;ctx.fillRect(-6,-22,5,8);ctx.fillRect(2,-18,5,8);ctx.fillStyle=C.bldd;ctx.beginPath();ctx.arc(-1,-26,4,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=cc;
    ctx.save();ctx.translate(9,-24);ctx.rotate(0.3+ease*0.6);ctx.fillRect(-3,0,6,14);ctx.restore();
    ctx.save();ctx.translate(-9,-24);ctx.rotate(-(0.3+ease*0.6));ctx.fillRect(-3,0,6,14);ctx.restore();
    ctx.fillStyle=sc2;ctx.beginPath();ctx.arc(0,-35,9,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ee3020';ctx.beginPath();ctx.arc(3,-34,2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#1a0606';ctx.beginPath();ctx.arc(2,-31,4,0,Math.PI);ctx.fill();
    ctx.restore();return;
  }
  const t=now/420+z.walkPhase,isAtk=z.state==='attack';const la=isAtk?0:Math.sin(t)*22,reach=Math.sin(t*0.55)*8+(isAtk?28:0);
  ctx.save();ctx.translate(4,0);ctx.rotate(la*Math.PI/180);ctx.fillStyle=cc;ctx.fillRect(-4,0,8,19);ctx.fillStyle=sc2;ctx.fillRect(-3,14,6,6);ctx.fillStyle='#181208';ctx.fillRect(-4,23,9,6);ctx.restore();
  ctx.save();ctx.translate(-4,0);ctx.rotate(-la*1.4*Math.PI/180);ctx.fillStyle=cc;ctx.fillRect(-4,0,8,19);ctx.fillStyle=sc2;ctx.fillRect(-2,12,5,7);ctx.fillStyle='#181208';ctx.fillRect(-4,23,9,6);ctx.restore();
  ctx.save();ctx.rotate(-0.22);ctx.fillStyle=cc;ctx.fillRect(-10,-31,20,23);ctx.fillStyle=sc2;ctx.fillRect(-8,-22,5,6);ctx.fillRect(3,-18,5,9);ctx.fillStyle=C.bldd;ctx.beginPath();ctx.arc(-1,-25,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(7,-16,3,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.translate(9,-27);ctx.rotate((-32-reach)*Math.PI/180);ctx.fillStyle=cc;ctx.fillRect(-3,0,7,14);ctx.fillStyle=sc2;ctx.fillRect(-3,12,7,10);ctx.beginPath();ctx.arc(0,23,5,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.save();ctx.translate(-6,-27);ctx.rotate((18+Math.sin(t*0.8)*9)*Math.PI/180);ctx.fillStyle=cc;ctx.fillRect(-3,0,7,14);ctx.fillStyle=sc2;ctx.fillRect(-3,12,7,8);ctx.restore();
  ctx.save();ctx.translate(2,-33);ctx.rotate(0.18);ctx.fillStyle=sc2;ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();ctx.fillStyle='#eee';ctx.beginPath();ctx.arc(3,-2,3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#cc1800';ctx.beginPath();ctx.arc(3,-2,1.8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#1a0606';ctx.beginPath();ctx.arc(2,4,4,0,Math.PI);ctx.fill();ctx.fillStyle=C.bld;ctx.beginPath();ctx.arc(-2,6,2.5,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.restore();ctx.restore();
  // HP bar world space
  if(z.hp<z.maxHp){
    const bary=ly-Math.round(58*(z.type==='tank'?sc*1.35:sc));
    ctx.fillStyle='#1a1a1a';ctx.fillRect(z.x-18,bary,36,4);ctx.fillStyle=C.dng;ctx.fillRect(z.x-18,bary,36*(z.hp/z.maxHp),4);
  }
}

// ════════════════════════════════════════════════════════════════
// DRAW — BULLETS / FX / SQUAD MARKER / HUD
// ════════════════════════════════════════════════════════════════
function dBlt(ctx,b){ctx.save();ctx.translate(b.x,b.y);ctx.rotate(Math.atan2(b.dy,b.dx));const g=ctx.createLinearGradient(-14,0,0,0);g.addColorStop(0,'rgba(255,200,0,0)');g.addColorStop(1,C.trc);ctx.fillStyle=g;ctx.fillRect(-14,-1,14,2);ctx.fillStyle='#fff';ctx.fillRect(-2,-1.5,5,3);ctx.restore();}
function dFx(ctx,e,now){
  const life=(now-e.at)/e.dur;if(life>=1)return;
  ctx.save();ctx.globalAlpha=1-life;ctx.translate(e.x,e.y);
  if(e.type==='blood')e.drops.forEach(d=>{const gv=life*life*22;ctx.fillStyle=C.bld;ctx.beginPath();ctx.arc(d.x+d.vx*life*18,d.y+d.vy*life*14+gv,d.r*(1-life*0.4),0,Math.PI*2);ctx.fill();});
  else if(e.type==='shell'){ctx.fillStyle='#ccaa22';ctx.save();ctx.translate(e.vx*life*30,life*life*25);ctx.rotate(life*9);ctx.fillRect(-2,-5,4,10);ctx.restore();}
  else if(e.type==='txt'){ctx.fillStyle=e.col||'#fff';ctx.font=`bold ${13-life*3}px monospace`;ctx.textAlign='center';ctx.fillText(e.v,0,-life*34);ctx.textAlign='left';}
  else if(e.type==='slash'){
    ctx.strokeStyle=`rgba(255,220,100,${(1-life)*0.9})`;ctx.lineWidth=2.5-life*1.5;
    ctx.beginPath();ctx.moveTo(-14,-10);ctx.lineTo(14,10);ctx.stroke();
    ctx.beginPath();ctx.moveTo(-10,10);ctx.lineTo(10,-10);ctx.stroke();
    ctx.strokeStyle=`rgba(255,255,200,${(1-life)*0.5})`;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(-7,-5);ctx.lineTo(7,5);ctx.stroke();
  }
  else if(e.type==='hit'){ctx.fillStyle='rgba(255,160,0,0.7)';ctx.beginPath();ctx.arc(0,0,10*(1-life),0,Math.PI*2);ctx.fill();}
  ctx.restore();
}
function dSquadMarker(ctx,target,lane,now){
  if(target===null||lane===null)return;
  const p=0.55+0.45*Math.sin(now/220), ly=laneY(lane), sc=laneSc(lane);
  ctx.save();
  ctx.strokeStyle=`rgba(114,188,64,${p*0.9})`;ctx.fillStyle=`rgba(114,188,64,${p*0.4})`;ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(target-10*sc,ly-2);ctx.lineTo(target+10*sc,ly-2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(target,ly-2);ctx.lineTo(target,ly-16*sc);ctx.stroke();
  ctx.beginPath();ctx.moveTo(target-7*sc,ly-10*sc);ctx.lineTo(target,ly-2);ctx.lineTo(target+7*sc,ly-10*sc);ctx.closePath();ctx.fill();
  // Lane indicator ring
  ctx.strokeStyle=`rgba(114,188,64,${p*0.5})`;ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(target,ly-28*sc,6*sc,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle=C.acc;ctx.font=`bold ${Math.round(8*sc)}px monospace`;ctx.textAlign='center';
  ctx.fillText(['F','M','B'][lane],target,ly-24*sc);
  ctx.textAlign='left';ctx.restore();
}
function dHUD(ctx,gs,now,muted){
  ctx.fillStyle='rgba(0,0,0,0.74)';ctx.fillRect(0,0,CW,38);ctx.strokeStyle=C.uib;ctx.lineWidth=1;ctx.strokeRect(0,0,CW,38);
  ctx.fillStyle=C.acc;ctx.font='bold 13px monospace';ctx.fillText(`DAY ${gs.day}  WAVE ${gs.wave}`,14,24);
  ctx.fillStyle=C.txt;ctx.font='12px monospace';ctx.fillText(`☠ ${gs.kills}`,200,24);ctx.fillText(`⭐ ${gs.score}`,290,24);
  ctx.fillStyle=C.txt;ctx.font='9px monospace';
  ctx.fillText(`🔫 ${gs.resources.ammo}`,378,16);ctx.fillText('CLICK LANE→MOVE',378,28);
  ctx.fillStyle=muted?'rgba(80,0,0,0.7)':'rgba(0,40,0,0.7)';ctx.fillRect(852,5,38,27);ctx.strokeStyle=muted?C.dng:C.uib;ctx.strokeRect(852,5,38,27);ctx.fillStyle=muted?C.dng:C.acc;ctx.font='15px monospace';ctx.fillText(muted?'🔇':'🔊',858,24);
  gs.soldiers.filter(s=>!s.onExpedition).forEach((s,i)=>{
    if(s.state==='dead')return;
    const bx=CW-385+i*128;ctx.fillStyle=C.uib;ctx.fillRect(bx,6,122,26);
    ctx.fillStyle=s.ammo===0?C.dng:s.state==='reload'?C.wrn:C.acc;ctx.font='9px monospace';
    const lanelbl=['F','M','B'][s.lane||0];
    ctx.fillText(`${s.name}[${lanelbl}] ${s.weapon[0].toUpperCase()} ${s.ammo}/${s.maxAmmo}`,bx+4,22);
  });
  if(gs.waveComplete&&gs.waveClearAt){const age=now-gs.waveClearAt,f=1-Math.min(1,age/2800);if(f>0){ctx.save();ctx.globalAlpha=f;ctx.fillStyle='rgba(0,20,0,0.94)';ctx.fillRect(CW/2-182,CH/2-40,364,72);ctx.strokeStyle=C.acc;ctx.lineWidth=2;ctx.strokeRect(CW/2-182,CH/2-40,364,72);ctx.fillStyle=C.acc;ctx.font='bold 26px monospace';ctx.textAlign='center';ctx.fillText('✦ WAVE CLEARED ✦',CW/2,CH/2+12);ctx.textAlign='left';ctx.restore();}}
}

// ════════════════════════════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════════════════════════════
function update(gs,now,dt){
  if(gs.phase!=='siege')return;
  gs.waveTime+=dt;gs.shakeTimer=Math.max(0,gs.shakeTimer-dt);
  while(gs.spawnQueue.length&&gs.spawnQueue[0].at<=gs.waveTime){gs.zombies.push(mkZombie(gs.spawnQueue.shift().type));gs.zombiesSpawned++;}
  const living=gs.zombies.filter(z=>z.state!=='dead');
  if(living.length>0&&Math.random()<0.004){const rz=living[Math.floor(Math.random()*living.length)];gs.soundQ.push({t:'groan',now,zt:rz.type});}

  // ── ZOMBIES ──────────────────────────────────────────────────
  gs.zombies.forEach(z=>{
    if(z.state==='dead')return;
    z.hurtTimer=Math.max(0,z.hurtTimer-dt);
    if(z.state==='walk'){
      z.x+=z.spd*z.facing*(dt/16);
      // Only engage soldiers/barricades in SAME lane
      const ns=gs.soldiers.find(s=>s.state!=='dead'&&!s.onExpedition&&s.lane===z.lane&&Math.abs(s.x-z.x)<42);
      if(ns){z.state='attack';z.targetSolId=ns.id;z.targetBarId=null;}
      else{
        const nb=gs.barricades.find(b=>Math.abs(b.x-z.x)<24); // barricade blocks all lanes
        if(nb){z.state='attack';z.targetBarId=nb.id;z.targetSolId=null;}
        else if(z.x<WX+46){z.state='attack';z.targetSolId=null;z.targetBarId=null;}
      }
    }else if(z.state==='attack'){
      z.atkTimer+=dt;
      if(z.atkTimer>1100){
        z.atkTimer=0;
        if(z.targetBarId){
          // Attack barricade
          const bar=gs.barricades.find(b=>b.id===z.targetBarId);
          if(bar&&Math.abs(bar.x-z.x)<30){
            bar.hp-=z.z.dmg;gs.soundQ.push({t:'bhit'});
            gs.effects.push({type:'txt',x:bar.x,y:laneY(0)-50,v:`-${z.z.dmg}`,col:C.wrn,at:now,dur:700});
            if(bar.hp<=0){gs.barricades=gs.barricades.filter(b=>b.id!==z.targetBarId);z.state='walk';z.targetBarId=null;}
          }else{z.state='walk';z.targetBarId=null;}
        }else{
          const sol=z.targetSolId?gs.soldiers.find(s=>s.id===z.targetSolId):null;
          if(sol&&sol.state!=='dead'&&sol.lane===z.lane&&Math.abs(sol.x-z.x)<55){
            sol.hp-=z.z.dmg;sol.hurtTimer=360;gs.soundQ.push({t:'zatk'});
            if(sol.hp<=0){sol.hp=0;sol.state='dead';z.targetSolId=null;z.state='walk';}
          }else{
            const ns2=gs.soldiers.find(s=>s.state!=='dead'&&!s.onExpedition&&s.lane===z.lane&&Math.abs(s.x-z.x)<55);
            if(ns2){z.targetSolId=ns2.id;}
            else if(z.x<WX+62){gs.baseHp-=z.z.dmg;gs.shakeTimer=300;gs.soundQ.push({t:'bhit'});gs.effects.push({type:'txt',x:WX/2,y:GY-120,v:`-${z.z.dmg}`,col:C.dng,at:now,dur:900});}
            else{z.state='walk';z.targetSolId=null;}
          }
        }
      }
    }
  });

  // ── SOLDIERS — shoot zombies in ANY lane ─────────────────────
  gs.soldiers.forEach((s,i)=>{
    if(s.state==='dead'||s.onExpedition)return;
    s.hurtTimer=Math.max(0,s.hurtTimer-dt);

    // ── ROOFTOP SOLDIER (sniper/marksman atop the wall) ──────────
    if(s.onRoof){
      // Stationary; high vantage point. Picks furthest threat.
      // When out of ammo and pool empty, climbs down to ground.
      const w=WPN[s.weapon];
      s.recoil=Math.max(0,(s.recoil||0)-dt);
      // Reload finishes as normal
      if(s.state==='reload'){
        if(now-s.reloadStart>=w.rl){s.ammo=s.maxAmmo;s.state='idle';s.reloadTriggered=false;}
        return;
      }
      // Out of ammo — try refill from dedicated sniperAmmo pool, otherwise climb DOWN
      if(s.ammo<=0){
        const refill=Math.min(s.maxAmmo,gs.resources.sniperAmmo||0);
        if(refill>0){
          gs.resources.sniperAmmo-=refill;
          s.state='reload';s.reloadStart=now;s.ammo=refill;
          if(!s.reloadTriggered){s.reloadTriggered=true;gs.soundQ.push({t:'reload',w:s.weapon,dur:w.rl});}
          gs.effects.push({type:'txt',x:s.x+30,y:GY-160,v:'RELOAD!',col:C.wrn,at:now,dur:800});
        }else{
          // Out of sniper ammo and no refill — descend to fight on the ground
          s.onRoof=false;
          s.lane=1;
          s.x=WX+30; s.destX=WX+90; s.state='walk'; s.facing=1;
          s.weapon='pistol'; s.maxAmmo=WPN.pistol.ammo;
          s.ammo=Math.min(WPN.pistol.ammo, gs.resources.ammo);
          gs.resources.ammo=Math.max(0,gs.resources.ammo-s.ammo);
          gs.effects.push({type:'txt',x:WX/2,y:GY-150,v:'DESCENDING!',col:C.dng,at:now,dur:1400});
        }
        return;
      }
      const targets=gs.zombies.filter(z=>z.state!=='dead'&&z.x>WX&&z.x<CW);
      if(targets.length===0)return;
      const tgt=targets.sort((a,b)=>b.x-a.x)[0]; // furthest
      s.facing=1;
      if(now-s.lastShot>=w.rate){
        s.state='shoot';s.lastShot=now;s.shootAt=now;s.recoil=200;s.ammo--;
        gs.soundQ.push({t:'shot',w:'rifle'});
        const sx=s.x, sy=GY-160;
        const by1=laneY(tgt.lane)-Math.round(24*laneSc(tgt.lane));
        const range=Math.max(40,Math.abs(tgt.x-sx));
        gs.bullets.push({id:uid(),x:sx+24,y:sy-2,dx:w.spd,dy:(by1-(sy-2))/(range/w.spd),
          dmg:w.dmg,life:Math.ceil(range/w.spd*1.2),targetLane:tgt.lane,shooterId:s.id});
        gs.effects.push({type:'shell',x:sx-4,y:sy-2,vx:-1.6,at:now,dur:780});
      }else if(now-s.lastShot>w.rate*0.4)s.state='idle';
      return;
    }

    // ── GROUND SOLDIER ──────────────────────────────────────────
    if(s.state==='walk'){
      const dx=s.destX-s.x;
      if(Math.abs(dx)>3){
        const step=Math.sign(dx)*1.8*(dt/16);
        const newX=s.x+step;
        const bars=gs.barricades||[];
        let finalX=newX;
        for(const bar of bars){
          if(!bar) continue;
          const onLeft = s.x <= bar.x-12;
          const onRight= s.x >= bar.x+12;
          if(step>0 && onLeft && newX > bar.x-12){
            finalX=bar.x-13; s.state='idle';
            s.destX=Math.min(s.destX, bar.x-13);
            break;
          }
          if(step<0 && onRight && newX < bar.x+12){
            finalX=bar.x+13; s.state='idle';
            s.destX=Math.max(s.destX, bar.x+13);
            break;
          }
        }
        s.x=finalX;
        if(Math.abs(s.destX-s.x)<=3){s.x=s.destX;s.state='idle';}
      }
      else{s.x=s.destX;s.state='idle';}
      return;
    }
    const w=WPN[s.weapon];
    // Soldiers can hit zombies on ANY lane
    const enms=gs.zombies.filter(z=>z.state!=='dead'&&Math.abs(z.x-s.x)<=w.range&&z.x>WX);
    const tgt=enms.sort((a,b)=>{
      // Prioritise same-lane, then closest
      const lbonus=(b.lane===s.lane?0:1)-(a.lane===s.lane?0:1);
      return lbonus || Math.abs(a.x-s.x)-Math.abs(b.x-s.x);
    })[0];
    if(!tgt){
      if(s.state==='shoot')s.state='idle';s.reloadTriggered=false;
      return;
    }
    s.facing=tgt.x>s.x?1:-1;
    if(s.state==='reload'){if(now-s.reloadStart>=w.rl){s.ammo=s.maxAmmo;s.state='idle';s.reloadTriggered=false;}return;}
    if(s.ammo<=0){
      // ── KNIFE MELEE when ammo dry (loops continuously while enemy near) ──
      // Reset knife state after animation completes so soldier can attack again
      if(s.state==='knife'&&now-s.shootAt>300)s.state='idle';
      if(s.state==='shoot')s.state='idle';
      // Find a zombie close enough to stab (same lane, melee range)
      const meleeTgt=gs.zombies.find(z=>z.state!=='dead'&&z.lane===s.lane&&Math.abs(z.x-s.x)<52&&z.x>WX);
      if(meleeTgt){
        s.facing=meleeTgt.x>s.x?1:-1;
        s.knifeTimer=(s.knifeTimer||0)+dt;
        if(s.knifeTimer>=650){
          s.knifeTimer=0;s.state='knife';s.shootAt=now; // reuse shootAt for anim
          meleeTgt.hp-=10;meleeTgt.hurtTimer=220;
          gs.soundQ.push({t:'zatk'});
          gs.effects.push({type:'slash',x:meleeTgt.x+s.facing*10,y:laneY(meleeTgt.lane)-28,at:now,dur:230});
          gs.effects.push({type:'txt',x:meleeTgt.x,y:laneY(meleeTgt.lane)-58,v:'-10',col:'#ffcc44',at:now,dur:600});
          if(meleeTgt.hp<=0){meleeTgt.hp=0;meleeTgt.state='dead';meleeTgt.deadAt=now;gs.soundQ.push({t:'zdie',zt:meleeTgt.type});gs.kills++;gs.score+=meleeTgt.type==='tank'?50:meleeTgt.type==='runner'?20:10;}
        }
      }else{s.knifeTimer=0;}
      return;
    }
    if(now-s.lastShot>=w.rate){
      s.state='shoot';s.lastShot=now;s.shootAt=now;s.ammo--;
      gs.soundQ.push({t:'shot',w:s.weapon});gs.soundQ.push({t:'shell'});
      // Bullet y interpolates between shooter lane and target lane
      const by0=laneY(s.lane)-Math.round(24*laneSc(s.lane));
      const by1=laneY(tgt.lane)-Math.round(24*laneSc(tgt.lane));
      const bxStart=s.x+s.facing*24;
      for(let p=0;p<(w.pel||1);p++){
        const sp2=(Math.random()-0.5)*w.sp*2;
        const dx=(tgt.x-s.x)*s.facing>0?s.facing*w.spd:s.facing*w.spd;
        gs.bullets.push({id:uid(),x:bxStart,y:by0,dy:(by1-by0)/Math.max(1,w.range/w.spd),dx:s.facing*w.spd*Math.cos(sp2),dmg:w.pel?w.dmg/w.pel:w.dmg,life:Math.ceil(w.range/w.spd*1.15),targetLane:tgt.lane});
      }
      gs.effects.push({type:'shell',x:s.x-s.facing*8,y:by0,vx:-s.facing*(1.4+Math.random()),at:now,dur:780});
      if(s.ammo===0){
        const refill=Math.min(s.maxAmmo,gs.resources.ammo);
        if(refill>0){s.state='reload';s.reloadStart=now;gs.resources.ammo-=refill;s.ammo=refill;
          if(!s.reloadTriggered){s.reloadTriggered=true;gs.soundQ.push({t:'reload',w:s.weapon,dur:w.rl});}
          gs.effects.push({type:'txt',x:s.x,y:laneY(s.lane)-80,v:'RELOAD!',col:C.wrn,at:now,dur:800});
        }else{gs.effects.push({type:'txt',x:s.x,y:laneY(s.lane)-80,v:'DRY!',col:C.dng,at:now,dur:900});}
      }
    }else if(now-s.lastShot>w.rate*0.4)s.state='idle';
  });

  // ── BULLETS ──────────────────────────────────────────────────
  gs.bullets=gs.bullets.filter(b=>{
    b.x+=b.dx;b.y+=b.dy;b.life--;
    if(b.life<=0||b.x<0||b.x>CW)return false;
    const hit=gs.zombies.find(z=>z.state!=='dead'&&Math.abs(z.x-b.x)<20&&z.lane===b.targetLane);
    if(hit){
      hit.hp-=b.dmg;hit.hurtTimer=210;gs.soundQ.push({t:'hit',now});
      gs.effects.push({type:'blood',x:b.x,y:b.y,drops:Array.from({length:7},()=>({x:0,y:0,vx:(Math.random()-.5)*3.5,vy:-Math.random()*2.5-.5,r:1.5+Math.random()*3})),at:now,dur:680});
      gs.effects.push({type:'hit',x:b.x,y:b.y,at:now,dur:200});
      gs.effects.push({type:'txt',x:hit.x,y:laneY(hit.lane)-60,v:`-${Math.round(b.dmg)}`,col:C.bld,at:now,dur:720});
      if(hit.hp<=0){hit.hp=0;hit.state='dead';hit.deadAt=now;gs.soundQ.push({t:'zdie',zt:hit.type});gs.kills++;gs.score+=hit.type==='tank'?50:hit.type==='runner'?20:10;
        if(b.shooterId){const shooter=gs.soldiers.find(x=>x.id===b.shooterId);if(shooter)shooter.kills=(shooter.kills||0)+1;}
      }
      return false;
    }
    return true;
  });

  // Dead body cap
  const dead=gs.zombies.filter(z=>z.state==='dead');
  if(dead.length>60){const rm=new Set(dead.slice(0,dead.length-60).map(z=>z.id));gs.zombies=gs.zombies.filter(z=>!rm.has(z.id));}
  gs.effects=gs.effects.filter(e=>now-e.at<e.dur);

  // Wave clear
  if(!gs.waveComplete){
    const liveCount=gs.zombies.filter(z=>z.state!=='dead').length;
    if(gs.zombiesSpawned>0&&gs.spawnQueue.length===0&&liveCount===0){gs.waveComplete=true;gs.waveClearAt=now;gs.soundQ.push({t:'wclr'});}
  }
  if(gs.waveComplete&&now-gs.waveClearAt>3000){
    gs.waveComplete=false;gs.waveClearAt=null;gs.wave++;gs.day++;gs.phase='management';
    gs.resources.ammo=Math.min(999,gs.resources.ammo+10);gs.resources.food=Math.min(999,gs.resources.food+8);
    // Delta climbs back to roof if she's alive on the ground and we have sniper ammo
    gs.soldiers.forEach(s=>{
      if(s.name==='Delta'&&s.state!=='dead'&&!s.onRoof&&(gs.resources.sniperAmmo||0)>0){
        s.onRoof=true;s.weapon='sniper';s.maxAmmo=WPN.sniper.ammo;
        const r=Math.min(WPN.sniper.ammo,gs.resources.sniperAmmo);
        gs.resources.sniperAmmo-=r;s.ammo=r;
        s.x=WX-40; s.lane=0; s.state='idle'; s.facing=1;
      }
    });
  }
  if(gs.phase==='siege'&&(gs.baseHp<=0||gs.soldiers.filter(s=>!s.onExpedition).every(s=>s.state==='dead'))){gs.phase='gameover';}
}

// ════════════════════════════════════════════════════════════════
// MISSION  (playable side-scroll expedition)
// ════════════════════════════════════════════════════════════════
function mkMission(soldier,dest){
  // Pre-place zombies and pickups across the mission stretch
  const zombies=[],pickups=[],obstacles=[];
  const totalZ=Math.floor(8*dest.zSpawn+rng(0,4));
  for(let i=0;i<totalZ;i++){
    const x=400+Math.random()*(MISSION_W-700);
    const types=dest.risk==='LOW'?['walker']:dest.risk==='MED'?['walker','walker','runner']:['walker','runner','runner','tank'];
    const t=types[Math.floor(Math.random()*types.length)];
    const z=ZTP[t];
    zombies.push({id:uid(),type:t,z,x,hp:z.hp,maxHp:z.hp,
      spd:z.spd*(0.85+Math.random()*0.3),state:'idle',facing:-1,
      walkPhase:Math.random()*Math.PI*2,atkTimer:0,hurtTimer:0,deadAt:0,lane:0,
      activated:false});
  }
  // Pickups along the way
  const pkOptions=dest.risk==='LOW'?['medicine','medicine','food']
                : dest.risk==='MED'?['ammo','ammo','materials','sniperAmmo']
                : ['ammo','medicine','food','materials','sniperAmmo'];
  const pkCount=dest.risk==='LOW'?4:dest.risk==='MED'?5:7;
  for(let i=0;i<pkCount;i++){
    const x=300+Math.floor(MISSION_W/(pkCount+1))*(i+1)+rng(-60,60);
    const type=pkOptions[Math.floor(Math.random()*pkOptions.length)];
    const value=type==='medicine'?rng(4,8):type==='ammo'?rng(8,15):type==='food'?rng(5,10):type==='sniperAmmo'?rng(2,4):rng(3,6);
    pickups.push({id:uid(),x,type,value,collected:false});
  }
  // Civilian at end of mission for HIGH risk, possibly for MED, never for LOW
  const civChance=dest.risk==='HIGH'?1.0:dest.risk==='MED'?0.5:0;
  if(Math.random()<civChance){
    pickups.push({id:uid(),x:MISSION_W-200,type:'civilian',value:1,collected:false});
  }
  // Decorative obstacles (cars, debris) for parallax interest
  for(let i=0;i<6;i++){
    obstacles.push({x:200+i*MISSION_W/7+rng(-50,50),type:Math.random()<0.5?'car':'crate'});
  }

  // Create a mission soldier (separate from siege one — but linked back via origId)
  const w=WPN[soldier.weapon];
  const msol={
    id:uid(),origId:soldier.id,name:soldier.name,weapon:soldier.weapon,
    x:80,lane:0,hp:soldier.hp,maxHp:soldier.maxHp,
    ammo:soldier.ammo>0?soldier.ammo:Math.min(soldier.maxAmmo,15), // some emergency ammo if dry
    maxAmmo:soldier.maxAmmo,
    state:'idle',facing:1,
    lastShot:0,reloadStart:0,shootAt:0,knifeTimer:0,
    walkPhase:Math.random()*Math.PI*2,hurtTimer:0,reloadTriggered:false,
    onExpedition:true,
  };
  return{
    soldier:msol, origSoldier:soldier, dest,
    zombies, pickups, obstacles, bullets:[], effects:[], soundQ:[],
    cameraX:0,
    inputLeft:false, inputRight:false, inputShoot:false,
    state:'active', // active | won | lost
    collected:{ammo:0,medicine:0,food:0,materials:0,sniperAmmo:0,civilian:null},
    startedAt:0, endedAt:0,
  };
}

function updateMission(m,now,dt){
  if(m.state!=='active') return;
  if(!m.startedAt) m.startedAt=now;
  const s=m.soldier;
  s.hurtTimer=Math.max(0,s.hurtTimer-dt);

  // ── INPUT MOVEMENT ───────────────────────────────────
  const moveSpd=2.4*(dt/16);
  if(s.state!=='reload'&&s.state!=='knife'){
    if(m.inputRight){s.x+=moveSpd;s.facing=1;if(s.state==='idle')s.state='walk';}
    else if(m.inputLeft){s.x-=moveSpd;s.facing=-1;if(s.state==='idle')s.state='walk';}
    else if(s.state==='walk')s.state='idle';
  }
  s.x=Math.max(40,Math.min(MISSION_W-40,s.x));

  // Camera follows soldier (centred, clamped)
  m.cameraX=Math.max(0,Math.min(MISSION_W-MISSION_VIEW,s.x-MISSION_VIEW/2));

  // ── ACTIVATE ZOMBIES near soldier ──────────────────────
  m.zombies.forEach(z=>{
    if(!z.activated&&Math.abs(z.x-s.x)<400){z.activated=true;m.soundQ.push({t:'groan',now,zt:z.type});}
  });

  // ── ZOMBIES ──────────────────────────────────────────
  m.zombies.forEach(z=>{
    if(z.state==='dead'||!z.activated) return;
    z.hurtTimer=Math.max(0,z.hurtTimer-dt);
    const dx=s.x-z.x;
    if(z.state==='idle'||z.state==='walk'){
      z.facing=dx>0?1:-1;
      // Walk toward soldier
      if(Math.abs(dx)>40){z.x+=z.spd*z.facing*(dt/16);if(z.state==='idle')z.state='walk';}
      else{z.state='attack';}
    }else if(z.state==='attack'){
      z.atkTimer+=dt;
      z.facing=dx>0?1:-1;
      if(Math.abs(dx)>50){z.state='walk';z.atkTimer=0;return;}
      if(z.atkTimer>1000){
        z.atkTimer=0;
        s.hp-=z.z.dmg; s.hurtTimer=320;
        m.soundQ.push({t:'zatk'});
        if(s.hp<=0){s.hp=0; m.state='lost'; m.endedAt=now;}
      }
    }
  });

  // ── SHOOTING ─────────────────────────────────────────
  const w=WPN[s.weapon];
  if(m.inputShoot&&s.state!=='reload'&&s.ammo>0){
    if(now-s.lastShot>=w.rate){
      s.state='shoot';s.lastShot=now;s.shootAt=now;s.ammo--;
      m.soundQ.push({t:'shot',w:s.weapon});
      m.soundQ.push({t:'shell'});
      const bx=s.x+s.facing*24;
      for(let p=0;p<(w.pel||1);p++){
        const sp2=(Math.random()-0.5)*w.sp*2;
        m.bullets.push({id:uid(),x:bx,y:MGY-26,dx:s.facing*w.spd*Math.cos(sp2),dy:w.spd*Math.sin(sp2),
          dmg:w.pel?w.dmg/w.pel:w.dmg,life:Math.ceil(w.range/w.spd*1.15)});
      }
      m.effects.push({type:'shell',x:s.x-s.facing*8,y:MGY-26,vx:-s.facing*(1.4+Math.random()),at:now,dur:780});
      if(s.ammo===0){s.state='reload';s.reloadStart=now;s.ammo=s.maxAmmo;m.soundQ.push({t:'reload',w:s.weapon,dur:w.rl});}
    }else if(now-s.lastShot>w.rate*0.5)s.state='walk';
  }
  if(s.state==='shoot'&&now-s.shootAt>200)s.state=m.inputLeft||m.inputRight?'walk':'idle';
  if(s.state==='reload'&&now-s.reloadStart>=w.rl){s.state='idle';}

  // Knife when dry & enemy close
  if(s.ammo<=0&&s.state!=='reload'){
    const meleeTgt=m.zombies.find(z=>z.state!=='dead'&&Math.abs(z.x-s.x)<52);
    if(meleeTgt){
      s.facing=meleeTgt.x>s.x?1:-1;
      s.knifeTimer=(s.knifeTimer||0)+dt;
      if(s.knifeTimer>=600){
        s.knifeTimer=0;s.state='knife';s.shootAt=now;
        meleeTgt.hp-=10;meleeTgt.hurtTimer=220;
        m.soundQ.push({t:'zatk'});
        m.effects.push({type:'slash',x:meleeTgt.x+s.facing*10,y:MGY-28,at:now,dur:230});
        m.effects.push({type:'txt',x:meleeTgt.x,y:MGY-58,v:'-10',col:'#ffcc44',at:now,dur:600});
        if(meleeTgt.hp<=0){meleeTgt.hp=0;meleeTgt.state='dead';meleeTgt.deadAt=now;m.soundQ.push({t:'zdie',zt:meleeTgt.type});}
      }
    }else{s.knifeTimer=0;if(s.state==='knife'&&now-s.shootAt>300)s.state='idle';}
  }

  // ── BULLETS ──────────────────────────────────────────
  m.bullets=m.bullets.filter(b=>{
    b.x+=b.dx;b.y+=b.dy;b.life--;
    if(b.life<=0||b.x<0||b.x>MISSION_W)return false;
    const hit=m.zombies.find(z=>z.state!=='dead'&&Math.abs(z.x-b.x)<20);
    if(hit){
      hit.hp-=b.dmg;hit.hurtTimer=210;m.soundQ.push({t:'hit',now});
      m.effects.push({type:'blood',x:b.x,y:b.y,drops:Array.from({length:6},()=>({x:0,y:0,vx:(Math.random()-.5)*3.5,vy:-Math.random()*2.5-.5,r:1.5+Math.random()*3})),at:now,dur:600});
      m.effects.push({type:'hit',x:b.x,y:b.y,at:now,dur:200});
      m.effects.push({type:'txt',x:hit.x,y:MGY-60,v:`-${Math.round(b.dmg)}`,col:C.bld,at:now,dur:680});
      if(hit.hp<=0){hit.hp=0;hit.state='dead';hit.deadAt=now;m.soundQ.push({t:'zdie',zt:hit.type});}
      return false;
    }
    return true;
  });

  // ── PICKUPS ──────────────────────────────────────────
  m.pickups.forEach(p=>{
    if(p.collected)return;
    if(Math.abs(p.x-s.x)<28){
      p.collected=true;
      if(p.type==='civilian'){m.collected.civilian=true;m.effects.push({type:'txt',x:p.x,y:MGY-70,v:'CIVILIAN!',col:'#88ddff',at:now,dur:1000});}
      else{m.collected[p.type]+=p.value;m.effects.push({type:'txt',x:p.x,y:MGY-70,v:`+${p.value} ${p.type}`,col:C.acc,at:now,dur:900});}
    }
  });

  // ── EFFECTS cleanup ──────────────────────────────────
  m.effects=m.effects.filter(e=>now-e.at<e.dur);

  // ── WIN CONDITION: reach end of map ──────────────────
  if(s.x>=MISSION_W-50){m.state='won';m.endedAt=now;}
}

function dMissionWorld(ctx,m,now){
  ctx.save();
  ctx.translate(-m.cameraX,0);

  // Sky + parallax stars (slow scroll)
  const sg=ctx.createLinearGradient(0,0,0,MGY-80);sg.addColorStop(0,C.sky1);sg.addColorStop(1,C.sky2);
  ctx.fillStyle=sg;ctx.fillRect(0,0,MISSION_W,MGY-80);
  // Parallax stars
  for(let i=0;i<60;i++){
    const sx=((i*173+m.cameraX*0.2)%MISSION_W);
    const sy=(i*97+17)%(MGY-100);
    ctx.fillStyle=`rgba(255,255,255,${0.3+(i%4)*0.18})`;
    ctx.fillRect(sx,sy,1.5,1.5);
  }
  // Distant ruined buildings (mid parallax)
  const bldCount=14;
  for(let i=0;i<bldCount;i++){
    const bx=(i*MISSION_W/bldCount)+50+(i%3)*30;
    const bw=50+(i*7)%55;
    const bh=80+(i*23)%150;
    ctx.fillStyle='#080a10';ctx.fillRect(bx,MGY-80-bh,bw,bh);
    ctx.fillStyle='#0d1828';
    for(let wx=bx+8;wx<bx+bw-5;wx+=14)
      for(let wy=MGY-80-bh+10;wy<MGY-90;wy+=18)
        if(Math.sin((bx+wx)*0.1+wy*0.07)>0.2)ctx.fillRect(wx,wy,8,10);
  }
  // Ground
  const gg=ctx.createLinearGradient(0,MGY,0,CH);gg.addColorStop(0,C.g1);gg.addColorStop(1,C.g2);
  ctx.fillStyle=gg;ctx.fillRect(0,MGY,MISSION_W,CH-MGY);
  ctx.strokeStyle='#2a2716';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,MGY);ctx.lineTo(MISSION_W,MGY);ctx.stroke();

  // Decorative obstacles
  m.obstacles.forEach(o=>{
    if(o.type==='car'){
      // Wrecked car
      ctx.fillStyle='#3a2a1a';ctx.fillRect(o.x-22,MGY-22,44,18);
      ctx.fillStyle='#1a1410';ctx.fillRect(o.x-18,MGY-32,32,12);
      ctx.fillStyle='#101010';ctx.beginPath();ctx.arc(o.x-14,MGY-2,5,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(o.x+14,MGY-2,5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(255,140,40,0.15)';ctx.beginPath();ctx.arc(o.x,MGY-26,18,0,Math.PI*2);ctx.fill();
    }else{
      ctx.fillStyle='#5a3e18';ctx.fillRect(o.x-12,MGY-18,24,18);
      ctx.fillStyle='#3e2810';ctx.fillRect(o.x-12,MGY-12,24,2);ctx.fillRect(o.x-12,MGY-6,24,2);
    }
  });

  // ── PROGRESS MARKERS along the road ─────────────────
  for(let mx=200;mx<MISSION_W;mx+=200){
    ctx.fillStyle='rgba(80,80,60,0.3)';ctx.fillRect(mx-1,MGY+2,2,8);
  }

  // ── PICKUPS ─────────────────────────────────────────
  m.pickups.forEach(p=>{
    if(p.collected)return;
    const bob=Math.sin(now/300+p.x*0.01)*3;
    ctx.save();ctx.translate(p.x,MGY-30+bob);
    // Glow
    ctx.fillStyle=p.type==='civilian'?'rgba(136,221,255,0.18)':'rgba(114,188,64,0.18)';
    ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*2);ctx.fill();
    // Icon background
    ctx.fillStyle='rgba(20,30,15,0.85)';ctx.fillRect(-12,-12,24,24);
    ctx.strokeStyle=p.type==='civilian'?'#88ddff':C.acc;ctx.lineWidth=1.5;ctx.strokeRect(-12,-12,24,24);
    // Emoji
    ctx.font='14px monospace';ctx.textAlign='center';ctx.fillStyle='#fff';
    ctx.fillText(objIcons[p.type]||'?',0,5);
    ctx.textAlign='left';ctx.restore();
  });

  // ── DEAD ZOMBIES first, living after, then soldier ──
  m.zombies.filter(z=>z.state==='dead').forEach(z=>{
    // Reuse dZombie but at MGY (force lane=0)
    z.lane=0; dZombie(ctx,z,now);
  });
  m.zombies.filter(z=>z.state!=='dead'&&z.activated).forEach(z=>{
    z.lane=0; dZombie(ctx,z,now);
  });
  // Soldier (force lane 0, no expedition flag for rendering)
  const sCopy={...m.soldier,lane:0,onExpedition:false,state:m.soldier.state};
  dSoldier(ctx,sCopy,now);

  // Effects + bullets
  m.effects.forEach(e=>dFx(ctx,e,now));
  m.bullets.forEach(b=>dBlt(ctx,b));

  // Goal beacon at the end
  const goalX=MISSION_W-30;
  const pulse=0.6+0.4*Math.sin(now/300);
  ctx.fillStyle=`rgba(114,188,64,${pulse*0.4})`;
  ctx.fillRect(goalX-3,MGY-120,6,120);
  ctx.fillStyle=C.acc;ctx.font='bold 11px monospace';
  ctx.fillText('★ GOAL ★',goalX-26,MGY-128);

  ctx.restore();
}

function dMissionHUD(ctx,m,now){
  // Top HUD
  ctx.fillStyle='rgba(0,0,0,0.78)';ctx.fillRect(0,0,CW,40);
  ctx.strokeStyle=C.uib;ctx.lineWidth=1;ctx.strokeRect(0,0,CW,40);
  // Title
  ctx.fillStyle=C.acc;ctx.font='bold 12px monospace';
  ctx.fillText(`MISSION: ${m.dest.name.toUpperCase()}`,12,18);
  ctx.fillStyle=C.txt;ctx.font='10px monospace';
  ctx.fillText(`AGENT ${m.soldier.name}`,12,32);

  // Progress bar
  const px=180,pw=450,ph=10;
  ctx.fillStyle='#1a1a1a';ctx.fillRect(px,14,pw,ph);
  const pct=m.soldier.x/MISSION_W;
  ctx.fillStyle=C.acc;ctx.fillRect(px,14,pw*pct,ph);
  ctx.strokeStyle=C.uib;ctx.strokeRect(px,14,pw,ph);
  // Goal star at end of progress bar
  ctx.fillStyle=C.acc;ctx.fillText('★',px+pw+4,23);

  // Right side: HP + ammo
  ctx.fillStyle=C.txt;ctx.font='10px monospace';
  ctx.fillText(`HP ${m.soldier.hp}/${m.soldier.maxHp}`,CW-200,18);
  ctx.fillStyle=m.soldier.ammo===0?C.dng:m.soldier.ammo<=4?C.wrn:C.acc;
  ctx.fillText(`AMMO ${m.soldier.ammo}/${m.soldier.maxAmmo}`,CW-200,32);

  // Collected
  ctx.fillStyle='#88ddff';ctx.font='10px monospace';
  let cx=CW-90;
  Object.entries(m.collected).forEach(([k,v])=>{
    if(v&&v>0){
      const lbl=k==='civilian'?'👤':objIcons[k]||k[0];
      ctx.fillText(`${lbl}${v===true?'':v}`,cx,k==='civilian'?32:18);
      if(k==='civilian')cx+=22;else cx+=22;
    }
  });

  // Low-bottom controls hint
  ctx.fillStyle='rgba(120,120,80,0.5)';ctx.font='9px monospace';
  ctx.fillText('← → MOVE   SPACE/CLICK FIRE   REACH GOAL',12,CH-12);

  // Win/lose overlay
  if(m.state==='won'||m.state==='lost'){
    const f=Math.min(1,(now-m.endedAt)/600);
    ctx.fillStyle=`rgba(0,0,0,${f*0.7})`;ctx.fillRect(0,0,CW,CH);
    ctx.fillStyle=m.state==='won'?C.acc:C.dng;
    ctx.font='bold 36px monospace';ctx.textAlign='center';
    ctx.fillText(m.state==='won'?'★ MISSION SUCCESS ★':'✖ MISSION FAILED',CW/2,CH/2-20);
    ctx.font='12px monospace';ctx.fillStyle=C.txt;
    ctx.fillText(m.state==='won'?'Returning to Fort Omega...':`${m.soldier.name} did not return.`,CW/2,CH/2+10);
    ctx.textAlign='left';
  }
}

// ════════════════════════════════════════════════════════════════
// EXPEDITION (auto-resolve fallback)
// ════════════════════════════════════════════════════════════════
function resolveExpedition(soldier,dest,gs){
  const dmg=rng(dest.solDmg[0],dest.solDmg[1]);
  const roll=Math.random();
  const threshold=dest.risk==='LOW'?0.80:dest.risk==='MED'?0.60:0.40;
  let outcome,reward={},recruit=null;
  if(roll<threshold){
    outcome='success';
    if(dest.risk==='LOW'){reward.medicine=rng(15,25);reward.food=rng(10,18);}
    else if(dest.risk==='MED'){reward.ammo=rng(20,40);reward.materials=rng(5,12);reward.sniperAmmo=rng(2,5);}
    else{reward.ammo=rng(15,25);reward.medicine=rng(8,15);reward.food=rng(10,20);reward.materials=rng(8,18);reward.sniperAmmo=rng(4,8);}
    const availNames=RECRUIT_NAMES.filter(n=>!gs.usedNames.has(n));
    if(availNames.length>0&&gs.soldiers.filter(s=>s.state!=="dead").length<6){
      const name=availNames[Math.floor(Math.random()*availNames.length)];
      const weapon=RECRUIT_WEAPONS[Math.floor(Math.random()*RECRUIT_WEAPONS.length)];
      recruit={name,weapon,hp:rng(55,85)};gs.usedNames.add(name);
    }
  }else if(roll<threshold+0.25){outcome='injured';}
  else{outcome='kia';}
  soldier.hp=Math.max(1,soldier.hp-dmg);
  if(outcome==='kia'){soldier.hp=0;soldier.state='dead';}
  return{soldierName:soldier.name,destName:dest.name,outcome,reward,recruit,dmgTaken:dmg};
}

// Convert finished playable mission into result
function finishMission(m,gs){
  const orig=gs.soldiers.find(s=>s.id===m.origSoldier.id);
  if(!orig) return null;
  // Apply hp from mission
  orig.hp=Math.max(1,m.soldier.hp);
  // Re-sync ammo
  orig.ammo=m.soldier.ammo;
  let outcome=m.state==='won'?'success':'kia';
  if(m.state==='lost'){orig.hp=0;orig.state='dead';}
  // Apply collected resources
  const reward={};
  if(m.collected.ammo)     {gs.resources.ammo=Math.min(999,gs.resources.ammo+m.collected.ammo);     reward.ammo=m.collected.ammo;}
  if(m.collected.medicine) {gs.resources.medicine=Math.min(999,gs.resources.medicine+m.collected.medicine); reward.medicine=m.collected.medicine;}
  if(m.collected.food)     {gs.resources.food=Math.min(999,gs.resources.food+m.collected.food);     reward.food=m.collected.food;}
  if(m.collected.materials){gs.resources.materials=Math.min(999,gs.resources.materials+m.collected.materials); reward.materials=m.collected.materials;}
  if(m.collected.sniperAmmo){gs.resources.sniperAmmo=Math.min(99,(gs.resources.sniperAmmo||0)+m.collected.sniperAmmo); reward.sniperAmmo=m.collected.sniperAmmo;}
  let recruit=null;
  if(m.collected.civilian&&outcome==='success'){
    const availNames=RECRUIT_NAMES.filter(n=>!gs.usedNames.has(n));
    if(availNames.length>0&&gs.soldiers.filter(s=>s.state!=="dead").length<6){
      const name=availNames[Math.floor(Math.random()*availNames.length)];
      const weapon=RECRUIT_WEAPONS[Math.floor(Math.random()*RECRUIT_WEAPONS.length)];
      recruit={name,weapon,hp:rng(55,85)};gs.usedNames.add(name);
      const ns=mkSoldier(name,weapon,270,recruit.hp,Math.floor(Math.random()*3),true);ns.ammo=0;
      gs.soldiers.push(ns);
    }
  }
  return{soldierName:m.soldier.name,destName:m.dest.name,outcome,reward,recruit,dmgTaken:m.soldier.maxHp-m.soldier.hp};
}

// ════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════
export default function DeadPerimeter(){
  const cvs=useRef(null),gsRef=useRef(null),rafId=useRef(null),prevT=useRef(0),mutedR=useRef(false);
  const missionRef=useRef(null); // playable mission object
  const inputRef=useRef({left:false,right:false,shoot:false});
  const[scr,setScr]=useState('menu'),[ui,setUi]=useState(null),[muted,setMuted]=useState(false);
  const[missionTick,setMissionTick]=useState(0); // forces UI updates during mission
  const[expSoldierIdx,setExpSoldierIdx]=useState(null);
  const[expDestIdx,setExpDestIdx]=useState(null);
  const[expResult,setExpResult]=useState(null);
  const[expPhase,setExpPhase]=useState(null);   // null | 'running' | 'done'
  const[expEvents,setExpEvents]=useState([]);
  const[expVisible,setExpVisible]=useState(0);
  const expSolRef=useRef(null);const expDstRef=useRef(null);
  const pickSoldier=useCallback(i=>{expSolRef.current=i;setExpSoldierIdx(i);},[]);
  const pickDest   =useCallback(i=>{expDstRef.current=i;setExpDestIdx(i);},[]);

  const toggleMute=useCallback(()=>{const am=getAM();const n=!mutedR.current;mutedR.current=n;setMuted(n);if(am)am.mute(n);},[]);

  // Expedition animation ticker
  useEffect(()=>{
    if(expPhase!=='running')return;
    if(expVisible>=expEvents.length){const to=setTimeout(()=>setExpPhase('done'),600);return()=>clearTimeout(to);}
    const delay=expEvents[expVisible]?.delay||1000;
    const to=setTimeout(()=>setExpVisible(v=>v+1),delay);
    return()=>clearTimeout(to);
  },[expPhase,expVisible,expEvents]);

  const newGame=useCallback(()=>{
    const am=getAM();if(am)am.resume();
    const gs=mkGS();
    gs.soldiers.forEach(s=>{s.ammo=WPN[s.weapon].ammo;gs.resources.ammo-=WPN[s.weapon].ammoCost;});
    gsRef.current=gs;setUi({...gs});setScr('management');
  },[]);

  const startWave=useCallback(()=>{
    const gs=gsRef.current;const am=getAM();if(am&&!mutedR.current)am.startBg();
    gs.soldiers.forEach(s=>{
      if(s.state==='dead'||s.onExpedition)return;
      if(s.onRoof){
        // Sniper uses sniperAmmo pool
        const need=s.maxAmmo-s.ammo;
        if(need>0&&(gs.resources.sniperAmmo||0)>0){
          const give=Math.min(need,gs.resources.sniperAmmo);
          gs.resources.sniperAmmo-=give;s.ammo+=give;
        }
        return;
      }
      const need=s.maxAmmo-s.ammo;if(need>0){const give=Math.min(need,gs.resources.ammo);gs.resources.ammo-=give;s.ammo+=give;}
    });
    gs.phase='siege';gs.spawnQueue=mkWave(gs.wave);gs.waveTime=0;
    gs.waveClearAt=null;gs.waveComplete=false;
    gs.zombies=gs.zombies.filter(z=>z.state==='dead');
    gs.bullets=[];gs.effects=[];gs.soundQ=[];gs.zombiesSpawned=0;gs.squadTarget=null;gs.squadLane=null;gs.selectedSoldierId=null;
    // Reset ground soldier positions; leave rooftop soldier where they are
    const ground=gs.soldiers.filter(s=>s.state!=='dead'&&!s.onExpedition&&!s.onRoof);
    ground.forEach((s,i)=>{s.x=WX+20;s.state='walk';s.facing=1;s.destX=224+i*24;s.reloadTriggered=false;});
    // Rooftop soldiers just become idle at their roof position
    gs.soldiers.filter(s=>s.onRoof&&s.state!=='dead').forEach(s=>{s.x=WX-40;s.state='idle';s.facing=1;s.reloadTriggered=false;});
    setScr('siege');setExpResult(null);
  },[]);

  // Generate narrative event log for expedition animation
  const genEvents=useCallback((soldierName,dest,outcome,dmgTaken,recruit)=>{
    const ev=[];
    // Departure
    ev.push({icon:'🚶',text:`${soldierName} leaves Fort Omega toward ${dest.name}.`,delay:900,col:C.txt});
    // Approach flavour
    if(dest.risk==='LOW'){
      ev.push({icon:'🌆',text:'Quiet streets. Minimal zombie presence in the area.',delay:1100,col:C.txt});
      ev.push({icon:'🔍',text:'Entering the building. Scanning for survivors...',delay:1300,col:C.txt});
    }else if(dest.risk==='MED'){
      ev.push({icon:'⚠️',text:'Armory district. Overrun. Taking cover behind vehicle.',delay:1000,col:C.wrn});
      ev.push({icon:'🧟',text:'Three walkers spotted. Moving to engage.',delay:1200,col:C.txt});
      ev.push({icon:'🔫',text:`${soldierName} opens fire — clear!`,delay:900,col:C.acc});
    }else{
      ev.push({icon:'💀',text:'Downtown is hell. Zombies crawling every corridor.',delay:900,col:C.dng});
      ev.push({icon:'🧟',text:'Runner pack incoming! Firing on the move!',delay:1000,col:C.dng});
      ev.push({icon:'🔫',text:`${soldierName} empties a mag — barely makes it through!`,delay:1100,col:C.acc});
    }
    // Damage event
    if(dmgTaken>0&&outcome!=='kia'){
      ev.push({icon:'🩸',text:`Ambushed — ${soldierName} takes ${dmgTaken} damage!`,delay:1100,col:C.dng});
    }
    // Objective
    if(outcome==='success'||outcome==='injured'){
      if(dest.risk==='LOW')   ev.push({icon:'🏥',text:'Supplies located. Packing medicine and food.',delay:1400,col:C.txt});
      if(dest.risk==='MED')   ev.push({icon:'📦',text:'Crates breached. Loading ammo and materials.',delay:1400,col:C.txt});
      if(dest.risk==='HIGH')  ev.push({icon:'🏙️',text:'Hub cleared. Gathering everything useful.',delay:1300,col:C.txt});
    }
    // Recruit
    if(recruit){
      ev.push({icon:'👤',text:`Found a survivor: ${recruit.name}. They agree to fight!`,delay:1500,col:'#88ddff'});
    }
    // Resolution
    if(outcome==='success')   ev.push({icon:'✦',text:`Mission complete. ${soldierName} returns to base.`,delay:1000,col:C.acc});
    else if(outcome==='injured') ev.push({icon:'⚠️',text:`${soldierName} limps back. Injured, but alive.`,delay:1000,col:C.wrn});
    else                         ev.push({icon:'💀',text:`${soldierName} did not return from ${dest.name}.`,delay:1200,col:C.dng});
    return ev;
  },[]);

  // Auto-resolve (text log)
  const sendExpedition=useCallback(()=>{
    const si=expSolRef.current,di=expDstRef.current;
    if(si===null||di===null)return;
    const gs=gsRef.current;const soldier=gs.soldiers[si];
    if(!soldier||soldier.state==='dead')return;
    const dest=EXPEDITION_DESTS[di];
    const result=resolveExpedition(soldier,dest,gs);
    if(result.reward.ammo)    gs.resources.ammo=Math.min(999,gs.resources.ammo+result.reward.ammo);
    if(result.reward.medicine)gs.resources.medicine=Math.min(999,gs.resources.medicine+result.reward.medicine);
    if(result.reward.food)    gs.resources.food=Math.min(999,gs.resources.food+result.reward.food);
    if(result.reward.materials)gs.resources.materials=Math.min(999,gs.resources.materials+result.reward.materials);
    if(result.reward.sniperAmmo)gs.resources.sniperAmmo=Math.min(99,(gs.resources.sniperAmmo||0)+result.reward.sniperAmmo);
    if(result.recruit){const r=result.recruit;const ns=mkSoldier(r.name,r.weapon,270,r.hp,Math.floor(Math.random()*3),true);ns.ammo=0;gs.soldiers.push(ns);}
    const events=genEvents(soldier.name,dest,result.outcome,result.dmgTaken,result.recruit);
    setExpEvents(events);
    setExpVisible(0);
    setExpResult(result);
    setExpPhase('running');
    setUi({...gs,soldiers:gs.soldiers.map(s=>({...s}))});
  },[genEvents]);

  // Playable side-scrolling mission
  const playMission=useCallback(()=>{
    const si=expSolRef.current,di=expDstRef.current;
    if(si===null||di===null)return;
    const gs=gsRef.current;const soldier=gs.soldiers[si];
    if(!soldier||soldier.state==='dead')return;
    const dest=EXPEDITION_DESTS[di];
    const m=mkMission(soldier,dest);
    soldier.onExpedition=true;
    missionRef.current=m;
    inputRef.current={left:false,right:false,shoot:false};
    setScr('mission');
  },[]);

  // Called when player clicks RETURN after mission ends
  const finalizeMission=useCallback(()=>{
    const m=missionRef.current;if(!m)return;
    const gs=gsRef.current;
    const soldier=gs.soldiers.find(s=>s.id===m.origSoldier.id);
    if(soldier) soldier.onExpedition=false;
    const result=finishMission(m,gs);
    missionRef.current=null;
    setExpResult(result);
    setExpPhase('done'); // skip text log
    setExpEvents([]);setExpVisible(0);
    setUi({...gs,soldiers:gs.soldiers.map(s=>({...s}))});
    setScr('expedition');
  },[]);

  const recruit=useCallback(()=>{
    const gs=gsRef.current;if(gs.resources.food<20||gs.resources.materials<15||gs.soldiers.filter(s=>s.state!=="dead").length>=6)return;
    gs.resources.food-=20;gs.resources.materials-=15;
    const avail=RECRUIT_NAMES.filter(n=>!gs.usedNames.has(n));if(!avail.length)return;
    const name=avail[Math.floor(Math.random()*avail.length)];
    const weapon=RECRUIT_WEAPONS[Math.floor(Math.random()*RECRUIT_WEAPONS.length)];
    gs.usedNames.add(name);
    const ns=mkSoldier(name,weapon,270,100,Math.floor(Math.random()*3));ns.ammo=0;
    gs.soldiers.push(ns);setUi({...gs,soldiers:gs.soldiers.map(s=>({...s}))});
  },[]);

  const buildBarricade=useCallback(()=>{
    const gs=gsRef.current;if(gs.resources.materials<15||gs.barricades.length>=2)return;
    gs.resources.materials-=15;
    const x=WX+160+rng(0,3)*70; // place at varying x positions in mid-field
    gs.barricades.push(mkBarricade(x));
    setUi({...gs});
  },[]);

  const healSoldier=useCallback(idx=>{
    const gs=gsRef.current;if(gs.resources.medicine<5)return;
    const s=gs.soldiers[idx];if(!s||s.state==='dead')return;
    gs.resources.medicine-=5;s.hp=Math.min(s.maxHp,s.hp+40);setUi({...gs,soldiers:gs.soldiers.map(s=>({...s}))});
  },[]);

  const moveSquad=useCallback(dir=>{
    const gs=gsRef.current;if(!gs||gs.phase!=='siege')return;
    const cur=gs.squadTarget??270;
    gs.squadTarget=dir==='retreat'?Math.max(WX+40,cur-80):Math.min(CW-80,cur+80);
    const movables=gs.selectedSoldierId
      ? gs.soldiers.filter(s=>s.id===gs.selectedSoldierId&&s.state!=='dead'&&!s.onExpedition&&!s.onRoof&&s.state!=='reload')
      : gs.soldiers.filter(s=>s.state!=='dead'&&!s.onExpedition&&!s.onRoof&&s.state!=='reload');
    movables.forEach((s,i)=>{
      s.destX=Math.max(WX+35,Math.min(CW-70,gs.squadTarget+(i-1)*22));
      s.state='walk';
    });
  },[]);

  // Poll mission state to trigger re-render of UI buttons (RETURN appears when finished)
  useEffect(()=>{
    if(scr!=='mission')return;
    const id=setInterval(()=>{
      const m=missionRef.current;
      if(m&&m.state!=='active')setMissionTick(t=>t+1);
    },200);
    return()=>clearInterval(id);
  },[scr]);

  // ── GAME LOOP ─────────────────────────────────────────────────
  useEffect(()=>{
    const canvas=cvs.current;if(!canvas)return;
    const ctx=canvas.getContext('2d');

    const onClick=e=>{
      const r=canvas.getBoundingClientRect();
      const mx=(e.clientX-r.left)*(CW/r.width),my=(e.clientY-r.top)*(CH/r.height);
      if(mx>850&&mx<892&&my>4&&my<34){toggleMute();return;}
      const gs=gsRef.current;
      if(!gs||gs.phase!=='siege'||my<=38)return;

      // 1) Click on an alive ground soldier → select it
      const clickedSol=gs.soldiers.find(s=>{
        if(s.state==='dead'||s.onExpedition||s.onRoof)return false;
        const sly=laneY(s.lane);
        return Math.abs(s.x-mx)<22 && my>sly-58 && my<sly+10;
      });
      if(clickedSol){
        gs.selectedSoldierId = (gs.selectedSoldierId===clickedSol.id) ? null : clickedSol.id;
        return;
      }

      // 2) Click on the battlefield → move
      if(mx>WX+40){
        const clickedLane=clickToLane(my);
        const targetX=Math.max(WX+40,Math.min(CW-80,mx));
        if(gs.selectedSoldierId!==null){
          // Move only the selected soldier
          const s=gs.soldiers.find(s=>s.id===gs.selectedSoldierId);
          if(s&&s.state!=='dead'&&!s.onExpedition&&!s.onRoof&&s.state!=='reload'){
            s.lane=clickedLane;
            s.destX=targetX;
            s.state='walk';
          }
          // Keep the marker pointing at the moved soldier's destination
          gs.squadTarget=targetX; gs.squadLane=clickedLane;
        }else{
          // No selection → move whole squad to that lane (legacy behavior)
          gs.squadTarget=targetX;
          gs.squadLane=clickedLane;
          gs.soldiers.forEach((s,i)=>{
            if(s.state==='dead'||s.onExpedition||s.onRoof||s.state==='reload')return;
            s.lane=clickedLane;
            s.destX=Math.max(WX+35,Math.min(CW-70,targetX+(i-1)*22));
            s.state='walk';
          });
        }
      }
    };

    // ── KEYBOARD for mission ─────────────────────────
    const onKeyDown=e=>{
      if(missionRef.current&&missionRef.current.state==='active'){
        if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A'){inputRef.current.left=true;e.preventDefault();}
        if(e.key==='ArrowRight'||e.key==='d'||e.key==='D'){inputRef.current.right=true;e.preventDefault();}
        if(e.key===' '||e.key==='Spacebar'){inputRef.current.shoot=true;e.preventDefault();}
      }
    };
    const onKeyUp=e=>{
      if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A')inputRef.current.left=false;
      if(e.key==='ArrowRight'||e.key==='d'||e.key==='D')inputRef.current.right=false;
      if(e.key===' '||e.key==='Spacebar')inputRef.current.shoot=false;
    };
    // Mouse hold for shooting in mission
    const onMouseDown=e=>{
      if(missionRef.current&&missionRef.current.state==='active'){
        const r=canvas.getBoundingClientRect();
        const my=(e.clientY-r.top)*(CH/r.height);
        if(my>40)inputRef.current.shoot=true;
      }
    };
    const onMouseUp=()=>{inputRef.current.shoot=false;};

    canvas.addEventListener('click',onClick);
    canvas.addEventListener('mousedown',onMouseDown);
    window.addEventListener('mouseup',onMouseUp);
    window.addEventListener('keydown',onKeyDown);
    window.addEventListener('keyup',onKeyUp);

    const mkSnap=gs=>({phase:gs.phase,day:gs.day,wave:gs.wave,baseHp:gs.baseHp,baseMaxHp:gs.baseMaxHp,resources:{...gs.resources},soldiers:gs.soldiers.map(s=>({...s})),barricades:gs.barricades.map(b=>({...b})),kills:gs.kills,score:gs.score});

    const loop=now=>{
      const dt=Math.min(now-prevT.current,50);prevT.current=now;const gs=gsRef.current;

      // ── MISSION MODE ─────────────────────────────────
      const m=missionRef.current;
      if(m){
        // Pipe inputs into mission
        m.inputLeft=inputRef.current.left;
        m.inputRight=inputRef.current.right;
        m.inputShoot=inputRef.current.shoot;
        updateMission(m,now,dt);
        processSounds(m.soundQ,_AM,mutedR);
        ctx.save();ctx.clearRect(0,0,CW,CH);
        dMissionWorld(ctx,m,now);
        dMissionHUD(ctx,m,now);
        ctx.restore();
        rafId.current=requestAnimationFrame(loop);
        return;
      }

      if(gs&&gs.phase==='siege'){
        update(gs,now,dt);processSounds(gs.soundQ,_AM,mutedR);
        if(gs.phase!=='siege'){if(_AM)_AM.stopBg();setUi(mkSnap(gs));setScr(gs.phase);}
        else{
          ctx.save();ctx.clearRect(0,0,CW,CH);
          if(gs.shakeTimer>0)ctx.translate((Math.random()-.5)*5,(Math.random()-.5)*3);
          dBg(ctx);dBase(ctx,gs.baseHp,gs.baseMaxHp);
          for(let lane=2;lane>=0;lane--){
            gs.zombies.filter(z=>z.state==='dead'&&z.lane===lane).forEach(z=>dZombie(ctx,z,now));
            gs.zombies.filter(z=>z.state!=='dead'&&z.lane===lane).forEach(z=>dZombie(ctx,z,now));
            gs.soldiers.filter(s=>(s.lane||0)===lane&&!s.onExpedition).forEach(s=>dSoldier(ctx,s,now,s.id===gs.selectedSoldierId));
            if(lane===2) gs.barricades.forEach(b=>dBarricade(ctx,b));
          }
          gs.effects.forEach(e=>dFx(ctx,e,now));
          gs.bullets.forEach(b=>dBlt(ctx,b));
          dSquadMarker(ctx,gs.squadTarget,gs.squadLane,now);
          dHUD(ctx,gs,now,mutedR.current);ctx.restore();
          if(Math.floor(now/250)!==Math.floor((now-dt)/250))setUi(mkSnap(gs));
        }
      }
      rafId.current=requestAnimationFrame(loop);
    };
    rafId.current=requestAnimationFrame(loop);
    return()=>{
      cancelAnimationFrame(rafId.current);
      canvas.removeEventListener('click',onClick);
      canvas.removeEventListener('mousedown',onMouseDown);
      window.removeEventListener('mouseup',onMouseUp);
      window.removeEventListener('keydown',onKeyDown);
      window.removeEventListener('keyup',onKeyUp);
    };
  },[toggleMute]);

  // ── STYLES ────────────────────────────────────────────────────
  const F="'Courier New',monospace";
  const wrap={background:'#030504',minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:F,color:C.txt};
  const panel={background:C.ui,border:`1px solid ${C.uib}`,padding:'26px 34px',maxWidth:'820px',width:'94%'};
  const btn=(bg='#243e12',bd)=>({background:bg,border:`1px solid ${bd??C.acc}`,color:'#e8f0e0',padding:'8px 18px',cursor:'pointer',fontFamily:F,fontSize:'12px',fontWeight:'bold',letterSpacing:'.05em',marginRight:'6px',marginTop:'4px'});
  const ctrlBtn={background:'#162210',border:`1px solid ${C.uib}`,color:C.acc,padding:'7px 14px',cursor:'pointer',fontFamily:F,fontSize:'12px',fontWeight:'bold'};
  const mbtn={background:'#1a2a12',border:`1px solid ${C.uib}`,color:C.txt,padding:'5px 12px',cursor:'pointer',fontFamily:F,fontSize:'11px'};
  const h1={color:C.acc,fontSize:'24px',fontWeight:'bold',letterSpacing:'.1em',margin:0};
  const h2={color:C.acc,fontSize:'12px',fontWeight:'bold',letterSpacing:'.05em',marginBottom:'7px',marginTop:'16px'};
  const hr={borderTop:`1px solid ${C.uib}`,borderBottom:'none',margin:'12px 0'};
  const card={background:'rgba(18,30,12,0.9)',border:`1px solid ${C.uib}`,padding:'7px 11px',minWidth:'110px'};
  const row={display:'flex',gap:'7px',flexWrap:'wrap',marginBottom:'5px'};
  const lbl={color:C.txt,fontSize:'9px',opacity:.6,display:'block',marginBottom:'2px',letterSpacing:'.04em'};
  const val={color:C.acc,fontSize:'17px',fontWeight:'bold'};

  const gs=ui||gsRef.current;
  const aliveSols=gs?.soldiers?.filter(s=>s.state!=='dead'&&!s.onExpedition)||[];
  const canRecruit=gs&&gs.resources.food>=20&&gs.resources.materials>=15&&gs.soldiers.filter(s=>s.state!=="dead").length<6;
  const canBarricade=gs&&gs.resources.materials>=15&&(gs.barricades?.length||0)<2;

  const resetExp=()=>{setExpResult(null);setExpPhase(null);setExpEvents([]);setExpVisible(0);expSolRef.current=null;expDstRef.current=null;setExpSoldierIdx(null);setExpDestIdx(null);};

  const ExpeditionScreen=(
    <div style={wrap}>
      <div style={panel}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div><div style={h1}>🗺 EXPEDITION</div><div style={{color:C.txt,opacity:.5,fontSize:'10px',marginTop:'3px'}}>DAY {gs?.day} — Dispatch a soldier before wave {gs?.wave}</div></div>
          <div style={{color:C.dng,fontWeight:'bold',fontSize:'20px'}}>WAVE #{gs?.wave}</div>
        </div>
        <hr style={hr}/>

        {/* ── SELECTION ── */}
        {expPhase===null&&(
          <>
            <div style={h2}>CHOOSE SOLDIER</div>
            <div style={row}>{gs?.soldiers?.map((s,i)=>{if(s.state==='dead')return null;return(
              <div key={s.id} onClick={()=>pickSoldier(i)} style={{...card,cursor:'pointer',borderColor:expSoldierIdx===i?C.acc:C.uib,opacity:expSoldierIdx===i?1:0.7}}>
                <div style={{color:C.acc,fontWeight:'bold',fontSize:'11px'}}>{s.name}</div>
                <div style={{fontSize:'9px',color:C.txt}}>{WPN[s.weapon]?.name}</div>
                <div style={{fontSize:'9px',color:s.hp>60?C.acc:s.hp>30?C.wrn:C.dng}}>{s.hp}HP</div>
              </div>
            );})}</div>
            <div style={h2}>CHOOSE DESTINATION</div>
            <div style={row}>{EXPEDITION_DESTS.map((d,i)=>(
              <div key={i} onClick={()=>pickDest(i)} style={{...card,cursor:'pointer',flex:1,borderColor:expDestIdx===i?d.riskColor:C.uib,opacity:expDestIdx===i?1:0.72}}>
                <div style={{fontSize:'17px',marginBottom:'2px'}}>{d.icon}</div>
                <div style={{color:C.acc,fontWeight:'bold',fontSize:'10px'}}>{d.name}</div>
                <div style={{color:d.riskColor,fontSize:'8px',fontWeight:'bold',marginTop:'1px'}}>RISK: {d.risk}</div>
                <div style={{color:C.txt,fontSize:'8px',marginTop:'2px',lineHeight:'1.4'}}>{d.desc}</div>
                <div style={{color:'#88ddff',fontSize:'8px',marginTop:'2px'}}>{d.rewards}</div>
              </div>
            ))}</div>
            <div style={{marginTop:'10px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
              <button style={btn('#1a3a18')} disabled={expSoldierIdx===null||expDestIdx===null} onClick={playMission}>🎮 PLAY LIVE</button>
              <button style={btn('#2a3018','#558844')} disabled={expSoldierIdx===null||expDestIdx===null} onClick={sendExpedition}>🗺 AUTO-DISPATCH</button>
            </div>
            <div style={{fontSize:'9px',color:C.txt,opacity:.5,marginTop:'8px',lineHeight:'1.5'}}>
              <b style={{color:C.acc}}>PLAY LIVE</b>: control your soldier in a side-scrolling mission. Higher reward potential.<br/>
              <b style={{color:C.txt}}>AUTO-DISPATCH</b>: fast text-based resolution, fixed odds.
            </div>
          </>
        )}

        {/* ── RUNNING: animated event log ── */}
        {(expPhase==='running'||expPhase==='done')&&(
          <div style={{background:'rgba(4,12,4,0.9)',border:`1px solid ${C.uib}`,padding:'14px 16px',minHeight:'180px'}}>
            <div style={{fontSize:'10px',color:C.txt,opacity:.5,marginBottom:'10px',letterSpacing:'.05em'}}>
              {expResult?.destName?.toUpperCase()} — MISSION LOG
            </div>
            {expEvents.slice(0,expVisible).map((ev,i)=>(
              <div key={i} style={{display:'flex',gap:'10px',alignItems:'flex-start',marginBottom:'8px',opacity:i<expVisible-1?0.7:1,transition:'opacity 0.3s'}}>
                <span style={{fontSize:'14px',flexShrink:0}}>{ev.icon}</span>
                <span style={{fontSize:'12px',color:ev.col,lineHeight:'1.5'}}>{ev.text}</span>
              </div>
            ))}
            {expPhase==='running'&&(
              <div style={{display:'flex',gap:'4px',marginTop:'8px'}}>
                {[0,1,2].map(i=>(
                  <div key={i} style={{width:'6px',height:'6px',borderRadius:'50%',background:C.uib,animation:`none`,opacity:0.3+i*0.3}}/>
                ))}
                <span style={{fontSize:'10px',color:C.txt,opacity:.5,marginLeft:'6px'}}>transmitting...</span>
              </div>
            )}
          </div>
        )}

        {/* ── DONE: final result summary ── */}
        {expPhase==='done'&&expResult&&(
          <div style={{background:expResult.outcome==='success'?'rgba(10,40,10,0.9)':expResult.outcome==='injured'?'rgba(50,35,8,0.9)':'rgba(50,8,8,0.9)',border:`1px solid ${expResult.outcome==='success'?C.acc:expResult.outcome==='injured'?C.wrn:C.dng}`,padding:'10px 14px',marginTop:'10px'}}>
            <div style={{fontWeight:'bold',fontSize:'13px',color:expResult.outcome==='success'?C.acc:expResult.outcome==='injured'?C.wrn:C.dng}}>
              {expResult.outcome==='success'?'✦ MISSION SUCCESS':expResult.outcome==='injured'?'⚠ RETURNED INJURED':'✖ SOLDIER LOST'}
            </div>
            {Object.keys(expResult.reward||{}).length>0&&(
              <div style={{fontSize:'11px',color:C.acc,marginTop:'5px'}}>
                Recovered: {Object.entries(expResult.reward).map(([k,v])=>`${k} +${v}`).join('  ·  ')}
              </div>
            )}
            {expResult.recruit&&(
              <div style={{fontSize:'11px',color:'#88ddff',marginTop:'4px'}}>
                👤 <b>{expResult.recruit.name}</b> rescued — reporting for duty ({expResult.recruit.weapon})
              </div>
            )}
          </div>
        )}

        <hr style={hr}/>
        <button style={btn()} onClick={()=>{resetExp();setScr('management');}}>← BACK TO COMMAND</button>
        {expPhase!=='running'&&<button style={btn('#1a1a3e','#4444aa')} onClick={startWave}>⚔ DEPLOY</button>}
      </div>
    </div>
  );

  return(
    <div style={{background:'#030504',minHeight:'100vh',fontFamily:F,color:C.txt}}>
      <div style={{display:(scr==='siege'||scr==='mission')?'flex':'none',flexDirection:'column',alignItems:'center',padding:'10px 0'}}>
        <canvas ref={cvs} width={CW} height={CH} style={{border:`1px solid ${C.uib}`,maxWidth:'100%',cursor:scr==='mission'?'crosshair':'crosshair',display:'block',outline:'none'}} tabIndex={0}/>
        {scr==='siege'&&(
          <div style={{display:'flex',gap:'7px',marginTop:'7px',flexWrap:'wrap',justifyContent:'center',alignItems:'center',width:'100%',maxWidth:CW}}>
            <button style={ctrlBtn} onClick={()=>moveSquad('retreat')}>◀ RETREAT</button>
            {ui?.soldiers?.filter(s=>!s.onExpedition).map(s=>(
              <div key={s.id} style={{background:'rgba(18,30,12,0.92)',border:`1px solid ${s.state==='dead'?C.dng:C.uib}`,padding:'4px 10px',opacity:s.state==='dead'?.32:1}}>
                <span style={{color:s.state==='dead'?C.dng:s.ammo===0?C.dng:C.acc,fontWeight:'bold',fontSize:'10px'}}>{s.name}</span>
                <span style={{color:'#666',fontSize:'9px',margin:'0 3px'}}>{'FMB'[s.lane||0]}</span>
                <span style={{color:C.txt,fontSize:'9px'}}>{s.state==='dead'?'KIA':s.state.toUpperCase()}</span>
                <span style={{color:s.ammo===0?C.dng:C.txt,fontSize:'9px',marginLeft:'4px'}}>{s.state!=='dead'?`${s.ammo}/${s.maxAmmo}`:'─'}</span>
              </div>
            ))}
            <button style={ctrlBtn} onClick={()=>moveSquad('advance')}>ADVANCE ▶</button>
            <button style={mbtn} onClick={toggleMute}>{muted?'🔇':'🔊'}</button>
          </div>
        )}
        {scr==='mission'&&(
          <div style={{display:'flex',gap:'8px',marginTop:'8px',flexWrap:'wrap',justifyContent:'center',alignItems:'center',width:'100%',maxWidth:CW}}>
            {missionRef.current&&missionRef.current.state==='active'?(
              <>
                <span style={{color:'#888',fontSize:'10px'}}>← / A : LEFT</span>
                <span style={{color:'#888',fontSize:'10px'}}>→ / D : RIGHT</span>
                <span style={{color:'#888',fontSize:'10px'}}>SPACE / CLICK : FIRE</span>
                <button style={mbtn} onClick={toggleMute}>{muted?'🔇':'🔊'}</button>
              </>
            ):(
              <button style={btn('#1a3a18')} onClick={finalizeMission}>✦ RETURN TO BASE ✦</button>
            )}
          </div>
        )}
      </div>

      {scr==='menu'&&(
        <div style={wrap}>
          <div style={{...panel,textAlign:'center',maxWidth:'480px'}}>
            <div style={{fontSize:'48px',marginBottom:'6px'}}>🧟</div>
            <div style={h1}>DEAD PERIMETER</div>
            <div style={{color:C.txt,opacity:.5,margin:'5px 0 14px',fontSize:'10px',letterSpacing:'.14em'}}>ZOMBIE SIEGE SURVIVAL</div>
            <hr style={hr}/>
            <p style={{color:C.txt,fontSize:'12px',lineHeight:'1.9',marginBottom:'18px'}}>
              Defend <span style={{color:C.acc}}>Fort Omega</span> across 3 depth lanes.<br/>
              <span style={{color:C.wrn}}>Click front/mid/back to position your squad.</span><br/>
              Ammo is scarce. Build barricades. Send expeditions.<br/>
              <span style={{color:'#444'}}>🔊 Sound included.</span>
            </p>
            <button style={btn()} onClick={newGame}>⚔  BEGIN OPERATION</button>
          </div>
        </div>
      )}

      {scr==='management'&&(
        <div style={wrap}>
          <div style={panel}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div><div style={h1}>COMMAND CENTER</div><div style={{color:C.txt,opacity:.5,fontSize:'10px',marginTop:'3px'}}>DAY {gs?.day||1} — Wave {gs?.wave} incoming</div></div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'5px'}}>
                <div style={{color:C.dng,fontWeight:'bold',fontSize:'20px'}}>WAVE #{gs?.wave||1}</div>
                <button style={mbtn} onClick={toggleMute}>{muted?'🔇 MUTED':'🔊 SOUND'}</button>
              </div>
            </div>
            <hr style={hr}/>
            <div style={h2}>📦 RESOURCES</div>
            <div style={row}>
              {[['🥫','FOOD',gs?.resources?.food],['🔫','AMMO',gs?.resources?.ammo],['🎯','SNIPER',gs?.resources?.sniperAmmo??0],['💊','MED',gs?.resources?.medicine],['🔧','MAT',gs?.resources?.materials]].map(([ic,lb,v])=>(
                <div key={lb} style={{...card,borderColor:lb==='AMMO'&&v<30?C.wrn:C.uib}}>
                  <span style={lbl}>{ic} {lb}</span>
                  <div style={{...val,color:lb==='AMMO'&&v<20?C.dng:lb==='AMMO'&&v<50?C.wrn:C.acc}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={h2}>👥 SOLDIERS ({gs?.soldiers?.filter(s=>s.state!=='dead').length}/6 active{gs?.soldiers?.filter(s=>s.state==='dead').length>0?` · ${gs?.soldiers?.filter(s=>s.state==='dead').length} KIA`:''})</div>
              <div style={{display:'flex',gap:'5px'}}>
                <button style={{...btn('#1a3028','#226644'),fontSize:'10px',padding:'4px 10px'}} disabled={!canRecruit} onClick={recruit}>+RECRUIT (🥫20 🔧15)</button>
                <button style={{...btn('#2a1e08','#885522'),fontSize:'10px',padding:'4px 10px'}} disabled={!canBarricade} onClick={buildBarricade}>🪵 BARRICADE (🔧15)</button>
              </div>
            </div>
            <div style={row}>
              {gs?.soldiers?.map((s,i)=>(
                <div key={s.id} style={{...card,opacity:s.state==='dead'?.34:1,borderColor:s.state==='dead'?C.dng:C.uib,minWidth:'130px'}}>
                  <div style={{color:s.state==='dead'?C.dng:C.acc,fontWeight:'bold',fontSize:'11px'}}>
                    {s.name} {s.state==='dead'&&'†'} {s.civilian&&s.state!=='dead'&&<span style={{color:'#88ddff',fontSize:'9px',marginLeft:'2px'}}>· civ</span>}
                  </div>
                  <div style={{fontSize:'9px',color:C.txt}}>{WPN[s.weapon]?.name} · Lane {'FMB'[s.lane||0]}</div>
                  <div style={{display:'flex',alignItems:'center',gap:'4px',marginTop:'4px'}}>
                    <div style={{flex:1,height:'3px',background:'#1a1a1a'}}><div style={{height:'3px',width:`${(s.hp/s.maxHp)*100}%`,background:s.hp>60?C.acc:s.hp>30?C.wrn:C.dng}}/></div>
                    <span style={{...lbl,minWidth:'28px'}}>{s.state==='dead'?'KIA':`${s.hp}HP`}</span>
                  </div>
                  {s.state!=='dead'&&s.hp<s.maxHp&&(
                    <button style={{...btn('#162814','#336622'),fontSize:'8px',padding:'2px 6px',marginTop:'3px',marginRight:0}} onClick={()=>healSoldier(i)} disabled={gs.resources.medicine<5}>💊 HEAL (5)</button>
                  )}
                </div>
              ))}
            </div>
            {(gs?.barricades?.length||0)>0&&(
              <>
                <div style={h2}>🪵 BARRICADES ({gs.barricades.length}/4)</div>
                <div style={row}>
                  {gs?.barricades?.map(b=>(
                    <div key={b.id} style={{...card,minWidth:'90px'}}>
                      <div style={{color:C.wrn,fontSize:'9px'}}>ALL LANES @ x{Math.round(b.x)}</div>
                      <div style={{height:'3px',background:'#1a1a1a',marginTop:'3px'}}><div style={{height:'3px',width:`${(b.hp/b.maxHp)*100}%`,background:b.hp>70?C.wrn:C.dng}}/></div>
                      <div style={{...lbl,marginTop:'2px'}}>{b.hp}/{b.maxHp} HP</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={h2}>🏰 BASE {gs?.baseHp}/{gs?.baseMaxHp}</div>
            <div style={{height:'6px',background:'#1a1a1a',marginBottom:'14px'}}><div style={{height:'6px',width:`${(gs?.baseHp||0)/(gs?.baseMaxHp||200)*100}%`,background:(gs?.baseHp/gs?.baseMaxHp)>0.6?C.acc:(gs?.baseHp/gs?.baseMaxHp)>0.3?C.wrn:C.dng}}/></div>
            <hr style={hr}/>
            <button style={btn('#1a1a3e','#4444aa')} onClick={()=>{resetExp();setScr('expedition');}}>🗺 EXPEDITION</button>
            <button style={btn()} onClick={startWave} disabled={aliveSols.length===0}>⚔ DEPLOY</button>
            {aliveSols.length===0&&<span style={{color:C.dng,fontSize:'11px',marginLeft:'8px'}}>No soldiers available</span>}
            {gs?.resources?.ammo<30&&<div style={{color:C.wrn,fontSize:'10px',marginTop:'6px'}}>⚠ Low ammo — soldiers may run dry mid-wave</div>}
          </div>
        </div>
      )}

      {scr==='expedition'&&ExpeditionScreen}

      {scr==='gameover'&&(
        <div style={wrap}>
          <div style={{...panel,textAlign:'center',maxWidth:'520px'}}>
            <div style={{fontSize:'48px',marginBottom:'6px'}}>💀</div>
            <div style={{...h1,color:C.dng,fontSize:'22px'}}>FORT OMEGA FALLEN</div>
            <hr style={hr}/>
            <div style={row}>{[['Days',gs?.day],['Waves Cleared',(gs?.wave||1)-1],['Kills',gs?.kills],['Score',gs?.score]].map(([l,v])=>(
              <div key={l} style={{...card,flex:1,textAlign:'center'}}><span style={lbl}>{l}</span><div style={{...val,fontSize:'20px'}}>{v}</div></div>
            ))}</div>
            <hr style={hr}/>
            <button style={btn('#5a1a1a','#883030')} onClick={newGame}>↺ TRY AGAIN</button>
          </div>
        </div>
      )}
    </div>
  );
}
