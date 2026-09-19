function syncLobbyModeLabel(){const el=document.getElementById("lobbyModeLabel");if(!el)return;const max=(game&&game.max_players)||selectedMode||2;el.textContent=Number(max)===10?"BIS ZU 10 SPIELER":"1 VS 1";}
const C=window.DICE_DUEL_CONFIG||{};
const db=C.SUPABASE_URL&&C.SUPABASE_ANON_KEY?supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY):null;

let game=null,my=0,channel=null,busy=false,selectedMode=2;
const $=x=>document.getElementById(x);
const show=x=>{document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$(x).classList.remove("hidden")};

function toast(x){const t=$("toast");t.textContent=x;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2400)}
function code(){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s="";for(let i=0;i<6;i++)s+=a[Math.floor(Math.random()*a.length)];return s}
function clean(x){return(x||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6)}
function requireDb(){if(!db){toast("Bitte zuerst config.js mit Supabase verbinden.");return false}return true}
function playersOf(g){
  let p;
  if(Array.isArray(g.players)&&g.players.length)p=g.players;
  else{
    p=[{slot:1,name:g.host_name,active:true,order:1}];
    if(g.guest_name)p.push({slot:2,name:g.guest_name,active:true,order:2});
  }
  return p.map((x,i)=>({...x,order:Number.isInteger(x.order)?x.order:i+1}));
}
function orderedPlayers(g){return playersOf(g).slice().sort((a,b)=>a.order-b.order)}
function activePlayers(g){return orderedPlayers(g).filter(p=>p.active!==false)}
function nextActive(g,slot){
  const ps=activePlayers(g);
  if(!ps.length)return slot;
  const i=ps.findIndex(p=>p.slot===slot);
  return ps[(i+1+ps.length)%ps.length].slot;
}
function modeName(g){return (g.max_players||2)===10?"BIS ZU 10 SPIELER":"1 VS 1"}

function updateChrome(){
  const name = game ? ((my===1?game.host_name:playersOf(game).find(p=>p.slot===my)?.name)||"Spieler") : "Spieler";
  if($("profileName")) $("profileName").textContent=name;
  if($("sideRoomCode")) $("sideRoomCode").textContent=game?.room_code||"—";
  if($("sideMode")) $("sideMode").textContent=game?modeName(game):(selectedMode===10?"Bis 10":"1 vs 1");
  if($("sideStake")){
    const amount=game?.stake_amount??0;
    $("sideStake").innerHTML=`<span class="stake-number">${amount}</span><span class="mini-coins" aria-hidden="true"><i></i><i></i><i></i></span>`;
  }
  if($("sideStatus")) $("sideStatus").textContent=game?(game.status==="waiting"?"Lobby":game.status==="playing"?"Spiel":"Beendet"):"Start";
  if($("sidePlayers")) $("sidePlayers").textContent=game?`${playersOf(game).length} / ${game.max_players||2}`:"—";
  if($("lobbyModeLabel") && game){
    $("lobbyModeLabel").textContent=(game.max_players||2)===10?"♟ Bis zu 10 Spieler":"⚔ 1 VS 1";
  }
  if($("playerCountTitle") && game){
    $("playerCountTitle").textContent=`SPIELER (${playersOf(game).length}/${game.max_players||2})`;
  }
  if($("gameModeLabel") && game) $("gameModeLabel").textContent=modeName(game);
}


async function movePlayer(slot,direction){
  if(my!==1||!game||game.status!=="waiting")return;
  const ps=orderedPlayers(game);
  const i=ps.findIndex(p=>p.slot===slot);
  const j=i+direction;
  if(i<0||j<0||j>=ps.length)return;

  [ps[i],ps[j]]=[ps[j],ps[i]];
  ps.forEach((p,k)=>p.order=k+1);

  const r=await db.from("games").update({
    players:ps,
    updated_at:new Date().toISOString()
  }).eq("id",game.id).eq("status","waiting").select().single();

  if(r.error||!r.data)return toast("Reihenfolge konnte nicht geändert werden.");
  game=r.data;
  render();
}



async function shuffleOrder(allowPlayingBeforeFirstRoll=false){
  if(my!==1||!game)return;

  const noRolls=!(game.history||[]).length;
  const allowed=
    game.status==="waiting" ||
    (allowPlayingBeforeFirstRoll && game.status==="playing" && noRolls);

  if(!allowed){
    return toast("Reihenfolge kann jetzt nicht mehr gemischt werden.");
  }

  let ps=orderedPlayers(game);
  if(ps.length<2){
    return toast("Mindestens 2 Spieler werden benötigt.");
  }

  for(let i=ps.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [ps[i],ps[j]]=[ps[j],ps[i]];
  }

  ps.forEach((p,i)=>p.order=i+1);

  const update={
    players:ps,
    updated_at:new Date().toISOString()
  };

  if(game.status==="playing" && noRolls){
    update.turn=ps[0].slot;
  }

  const r=await db.from("games")
    .update(update)
    .eq("id",game.id)
    .select()
    .single();

  if(r.error||!r.data){
    return toast("Reihenfolge konnte nicht gemischt werden.");
  }

  game=r.data;
  toast("Reihenfolge wurde gemischt! 🔀");
  render();
}

$("configHint").textContent=db?"":"⚙️ Supabase ist noch nicht konfiguriert.";

document.querySelectorAll(".mode").forEach(btn=>{
  btn.onclick=()=>{
    selectedMode=Number(btn.dataset.mode); syncLobbyModeLabel();
    document.querySelectorAll(".mode").forEach(x=>x.classList.toggle("active",x===btn));
    $("slotModeBtn")?.classList.remove("active");
    if($("slot") && !$("slot").classList.contains("hidden")) show("home");
    updateChrome();
  };
});

$("create").onclick=async()=>{
  if(!requireDb())return;
  const name=$("createName").value.trim()||"Spieler 1";
  const start=Math.floor(Number($("start").value));
  if(!Number.isSafeInteger(start)||start<2)return toast("Startzahl muss mindestens 2 sein.");

  for(let i=0;i<8;i++){
    const c=code();
    const players=[{slot:1,name,active:true,order:1}];
    const r=await db.from("games").insert({
      room_code:c,host_name:name,guest_name:null,start_number:start,current_number:start,
      turn:1,status:"waiting",history:[],winner:null,loser:null,max_players:selectedMode,players
    }).select().single();

    if(!r.error){
      game=r.data;my=1;subscribe();render();return;
    }

    console.error("Raum erstellen Fehler:", r.error);

    if(r.error?.message?.includes("stake_amount")){
      toast("Supabase-Update fehlt: stake_amount ist noch nicht eingerichtet.");
      return;
    }
  }
  toast("Raum konnte nicht erstellt werden. Prüfe Supabase SQL.");
};

$("join").onclick=async()=>{
  if(!requireDb())return;
  let name=$("joinName").value.trim()||"Spieler";
  const c=clean($("code").value);
  if(c.length!==6)return toast("Bitte 6-stelligen Code eingeben.");

  const r=await db.from("games").select("*").eq("room_code",c).maybeSingle();
  if(r.error||!r.data)return toast("Raum nicht gefunden.");
  if(r.data.status!=="waiting")return toast("Dieses Spiel wurde bereits gestartet.");

  let ps=playersOf(r.data);
  const max=r.data.max_players||2;
  if(ps.length>=max)return toast("Dieser Raum ist voll.");

  if(ps.some(p=>p.name.toLowerCase()===name.toLowerCase()))name=name+" "+(ps.length+1);
  const slot=ps.length+1;
  ps.push({slot,name,active:true,order:ps.length+1});

  const u=await db.from("games").update({
    guest_name:slot===2?name:r.data.guest_name,
    players:ps,
    updated_at:new Date().toISOString()
  }).eq("id",r.data.id).eq("status","waiting").select().single();

  if(u.error||!u.data)return toast("Beitritt fehlgeschlagen.");
  game=u.data;my=slot;subscribe();render();
};

$("saveStake").onclick=async()=>{
  if(my!==1||!game||game.status!=="waiting")return;
  const amount=Math.max(0,Math.floor(Number($("stakeAmount").value)||0));

  const r=await db.from("games").update({
    stake_amount:amount,
    updated_at:new Date().toISOString()
  }).eq("id",game.id).eq("status","waiting").select().single();

  if(r.error||!r.data){
    console.error("Betrag speichern Fehler:",r.error);
    if(r.error?.message?.includes("stake_amount")){
      return toast("Bitte zuerst das V4 Supabase-SQL ausführen.");
    }
    return toast("Betrag konnte nicht gespeichert werden.");
  }
  game=r.data;
  toast("Betrag gespeichert.");
  render();
};

$("shufflePlayers").onclick=()=>shuffleOrder(false);

if($("shuffleBeforeRoll")) $("shuffleBeforeRoll").onclick=()=>shuffleOrder(true);

$("startGame").onclick=async()=>{
  if(my!==1)return;
  const ps=playersOf(game);
  if(ps.length<2)return toast("Mindestens 2 Spieler werden benötigt.");
  const first=orderedPlayers(game)[0];
  const r=await db.from("games").update({
    status:"playing",turn:first.slot,current_number:game.start_number,
    updated_at:new Date().toISOString()
  }).eq("id",game.id).eq("status","waiting").select().single();
  if(r.error)return toast("Spiel konnte nicht gestartet werden.");
  game=r.data;render();
};

$("code").oninput=e=>e.target.value=clean(e.target.value);
$("copyCode").onclick=()=>navigator.clipboard.writeText(game.room_code).then(()=>toast("Code kopiert!"));
$("copyLink").onclick=()=>navigator.clipboard.writeText(location.origin+location.pathname+"?room="+game.room_code).then(()=>toast("Einladungslink kopiert!"));
$("leave").onclick=()=>{if(confirm("Spiel verlassen?")){if(channel)db.removeChannel(channel);game=null;show("home")}};
$("homeBtn").onclick=()=>{if(channel)db.removeChannel(channel);game=null;show("home")};

function subscribe(){
  if(channel)db.removeChannel(channel);
  channel=db.channel("game-"+game.id)
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"games",filter:"id=eq."+game.id},payload=>{
      game=payload.new;render();if(game.status==="finished")setTimeout(result,450);
    })
    .subscribe();
}

function renderLobby(){
  const ps=orderedPlayers(game);
  $("lobbyCode").textContent=game.room_code;
  $("wait").textContent=`${ps.length}/${game.max_players||2} Spieler im Raum`;

  $("stakeAmount").value=game.stake_amount??0;
  $("stakeAmount").disabled=my!==1;
  $("saveStake").classList.toggle("hidden",my!==1);
  $("stakeHint").textContent=my===1
    ?"Du kannst den Betrag bis zum Spielstart ändern."
    :`Gespielter Betrag: ${game.stake_amount??0}`;

  $("lobbyPlayers").innerHTML="";
  ps.forEach((p,index)=>{
    const d=document.createElement("div");
    d.className="lobby-player lobby-player-row";

    const info=document.createElement("div");
    info.className="lobby-player-info";
    info.innerHTML=`<span class="order-number">${p.order}</span><strong></strong><small>P${p.slot}</small>`;
    info.querySelector("strong").textContent=p.name;
    d.appendChild(info);

    if(my===1){
      const controls=document.createElement("div");
      controls.className="order-controls";

      const up=document.createElement("button");
      up.type="button";
      up.className="order-btn";
      up.textContent="↑";
      up.title="Nach oben";
      up.disabled=index===0;
      up.onclick=()=>movePlayer(p.slot,-1);

      const down=document.createElement("button");
      down.type="button";
      down.className="order-btn";
      down.textContent="↓";
      down.title="Nach unten";
      down.disabled=index===ps.length-1;
      down.onclick=()=>movePlayer(p.slot,1);

      controls.append(up,down);
      d.appendChild(controls);
    }

    $("lobbyPlayers").appendChild(d);
  });

  $("shufflePlayers").classList.toggle("hidden",my!==1||ps.length<2);
  $("startGame").classList.toggle("hidden",my!==1||ps.length<2);
  updateChrome();
  syncLobbyModeLabel(); show("lobby");
}

function renderPlayers(){
  const wrap=$("players");
  wrap.innerHTML="";
  orderedPlayers(game).forEach(p=>{
    const d=document.createElement("div");
    d.className="player";
    if(game.status==="playing"&&game.turn===p.slot&&p.active!==false)d.classList.add("active");
    if(p.active===false)d.classList.add("eliminated");
    d.innerHTML=`<small>PLATZ ${p.order} · P${p.slot}</small><strong></strong><span></span>`;
    d.querySelector("strong").textContent=p.name;
    d.querySelector("span").textContent=p.active===false?"💀 RAUS":(game.turn===p.slot&&game.status==="playing"?"AM ZUG":"READY");
    wrap.appendChild(d);
  });
}

function render(){
  if(!game)return;
  if(game.status==="waiting"){renderLobby();return;}

  const ps=playersOf(game),active=activePlayers(game);
  $("gameCode").textContent=game.room_code;
  $("number").textContent=game.current_number;
  $("modeText").textContent=`${modeName(game)} · ${active.length} AKTIV`;
  $("stakeText").textContent=`BETRAG: ${game.stake_amount??0}`;
  renderPlayers();

  const turnPlayer=ps.find(p=>p.slot===game.turn);
  $("turnText").textContent=game.status==="playing"
    ?(game.turn===my?"DU BIST DRAN":`${turnPlayer?.name||"Spieler"} IST DRAN`)
    :"";

  const me=ps.find(p=>p.slot===my);
  $("roll").disabled=game.status!=="playing"||game.turn!==my||busy||!me||me.active===false;
  if($("shuffleBeforeRoll")) $("shuffleBeforeRoll").classList.toggle("hidden",!(my===1&&game.status==="playing"&&!(game.history||[]).length));

  const h=$("history");
  h.innerHTML="";
  (game.history||[]).slice().reverse().forEach(x=>{
    const d=document.createElement("div");
    d.innerHTML=`<strong>P${x.player} · ${x.name||"Spieler"}</strong> · ${x.from} → <b>${x.roll}</b>`;
    if(x.roll===1)d.innerHTML+=' <span class="history-out">💀 RAUS</span>';
    h.appendChild(d);
  });
  if(!(game.history||[]).length)h.innerHTML='<div style="color:#8d94a8">Noch keine Würfe.</div>';

  updateChrome();
  show("game");
}

$("roll").onclick=async()=>{
  if(!game||busy||game.turn!==my||game.status!=="playing")return;

  const ps=playersOf(game);
  const me=ps.find(p=>p.slot===my);
  if(!me||me.active===false)return;

  busy=true;
  $("roll").classList.add("rolling");
  await new Promise(r=>setTimeout(r,550));

  const old=game.current_number;
  const roll=Math.floor(Math.random()*old)+1;
  const history=[...(game.history||[]),{player:my,name:me.name,from:old,roll}];
  const update={current_number:roll,history,players:ps,updated_at:new Date().toISOString()};

  if(roll===1){
    me.active=false;
    const left=ps.filter(p=>p.active!==false);
    update.players=ps;
    update.loser=my;

    // Mehrspieler-Modus: Nach einer 1 beginnt der nächste Spieler
    // wieder mit der ursprünglichen Startzahl.
    if((game.max_players||2)===10){
      update.current_number=game.start_number;
    }

    if(left.length===1){
      update.status="finished";
      update.winner=left[0].slot;
      update.turn=left[0].slot;
    }else{
      update.turn=nextActive({...game,players:ps},my);
    }
  }else{
    update.turn=nextActive(game,my);
  }

  const r=await db.from("games").update(update)
    .eq("id",game.id).eq("turn",my).eq("status","playing")
    .select().single();

  busy=false;
  $("roll").classList.remove("rolling");

  if(r.error||!r.data){ console.error("Supabase roll error:", r.error); return toast(r.error?.message || "Wurf konnte nicht gespeichert werden."); }

  game=r.data;
  $("rollResult").textContent=roll===1?"💀 1":roll;
  $("rollResult").animate(
    [{transform:"scale(.5)",opacity:0},{transform:"scale(1.15)",opacity:1},{transform:"scale(1)",opacity:1}],
    {duration:450}
  );

  render();
  if(game.status==="finished")setTimeout(result,550);
};

function result(){
  if(!game||game.status!=="finished")return;
  const ps=playersOf(game);
  const won=game.winner===my;
  const winner=ps.find(p=>p.slot===game.winner);

  $("emoji").textContent=won?"🏆":"💀";
  $("resultTitle").textContent=won?"DU GEWINNST!":"SPIEL BEENDET";
  $("resultText").textContent=winner?`${winner.name} gewinnt das Spiel!`:"Das Spiel ist beendet.";

  const allPlayers=orderedPlayers(game);
  const names=allPlayers.map(p=>p.name).join(" · ");
  const amount=game.stake_amount??0;
  $("resultSummary").innerHTML=`
    <div class="summary-row"><span>Gespielt um</span><strong>${amount}</strong></div>
    <div class="summary-row summary-players"><span>Beteiligt</span><strong></strong></div>
  `;
  $("resultSummary").querySelector(".summary-players strong").textContent=names;

  $("resultCard").className="card center result "+(won?"win":"lose");
  updateChrome();
  show("result");
}

$("rematch").onclick=async()=>{
  if(my!==1)return toast("Nur Spieler 1 kann das Rematch starten.");

  const ps=playersOf(game).map(p=>({...p,active:true}));
  const r=await db.from("games").update({
    current_number:game.start_number,
    turn:orderedPlayers(game)[0]?.slot||1,
    status:ps.length>=2?"playing":"waiting",
    winner:null,
    loser:null,
    history:[],
    players:ps,
    updated_at:new Date().toISOString()
  }).eq("id",game.id).select().single();

  if(r.error)return toast("Rematch fehlgeschlagen.");
  game=r.data;render();
};

const q=new URLSearchParams(location.search).get("room");
if(q){$("code").value=clean(q);$("joinName").focus()}

updateChrome();





/* ===== BOOK OF DICE V3 – virtual coins only ===== */
(()=>{
const S=id=>document.getElementById(id);
const symbols=["VALORIAN","DERION","FACE209","FACE193","FACE96","WARRIOR","PRIEST","MAGE","ARCHER","ASSASSIN","BOOK"];
const weights=[4,5,6,7,8,11,12,13,14,15,8];
const pays={
 VALORIAN:[0,0,40,400,2000], DERION:[0,0,35,200,1000],
 FACE209:[0,0,30,100,750], FACE193:[0,0,25,90,500], FACE96:[0,0,20,80,400],
 WARRIOR:[0,0,10,50,200], PRIEST:[0,0,8,40,175], MAGE:[0,0,7,35,150],
 ARCHER:[0,0,6,30,125], ASSASSIN:[0,0,5,25,100]
};
const scatterPays={3:18,4:180,5:1800};
const lines=[
 [1,1,1,1,1], /* Linie 1: MITTE */
 [0,0,0,0,0], /* Linie 2: OBEN */
 [2,2,2,2,2], /* Linie 3: UNTEN */
 [0,1,2,1,0],[2,1,0,1,2],
 [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0]
];
const lineColors=["#efb320","#20b34b","#d73b2e","#315bd7","#a84ae8","#f39a25","#14a779","#35aee8","#e24a96","#a743e8"];
let balance=100000, lineBet=10, lineCount=1, grid=[], busy=false, free=0, expand=null, expandSymbols=[], auto=false, freeSession=false, freeSessionTotal=0, freeSessionStart=0, featureRunning=false, freeSpinNumber=0; /* Werte in Silber; 100 Silber = 1 Gold */
const activeLines=()=>lineCount;
const totalStake=()=>activeLines()*lineBet; /* Minimum: 1 Linie × 10 Silber = 10 Silber */
const moneyParts=v=>({gold:Math.floor(v/100),silver:Math.abs(v%100)});
const moneyHTML=v=>{
 const m=moneyParts(v);
 if(m.gold===0) return `<span class="money-unit silver-only" title="${m.silver} Silber"><span class="coin coin-silver" aria-hidden="true"></span><b>${m.silver}</b></span>`;
 if(m.silver===0) return `<span class="money-unit gold-only" title="${m.gold} Gold"><span class="coin coin-gold" aria-hidden="true"></span><b>${m.gold}</b></span>`;
 return `<span class="money-unit" title="${m.gold} Gold und ${m.silver} Silber"><span class="coin coin-gold" aria-hidden="true"></span><b>${m.gold}</b><span class="money-divider" aria-hidden="true"></span><span class="coin coin-silver" aria-hidden="true"></span><b>${String(m.silver).padStart(2,"0")}</b></span>`;
};
const moneyText=v=>{const m=moneyParts(v);return m.gold&&m.silver?`${m.gold} Gold + ${m.silver} Silber`:m.gold?`${m.gold} Gold`:`${m.silver} Silber`};
const pick=()=>{let r=Math.random()*weights.reduce((a,b)=>a+b,0);for(let i=0;i<symbols.length;i++){r-=weights[i];if(r<=0)return symbols[i]}return "ASSASSIN"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function symbolMarkup(v){
 const images={
  VALORIAN:"assets/valorian.png",DERION:"assets/derion.png",FACE209:"assets/face_209.png",
  FACE193:"assets/face_193.png",FACE96:"assets/face_96.png",WARRIOR:"assets/warrior.png",
  PRIEST:"assets/priest.png",MAGE:"assets/mage.png",ARCHER:"assets/archer.png",ASSASSIN:"assets/assassin.png",
  BOOK:"assets/book.png"
 };
 return images[v]?`<img class="custom-slot-symbol" src="${images[v]}" alt="${v}" draggable="false">`:`<span>${v}</span>`;
}

function makeSymbol(v){const d=document.createElement("div");d.className="symbol bod-symbol";d.dataset.sym=v;d.innerHTML=symbolMarkup(v);return d}
function cellHeight(){const r=document.querySelector("#slotReels .reel");return r?Math.max(80,r.clientHeight/3):150}

/* Return exactly the three cells that are currently visible. During a spin
   they live inside the V25 strip; during a feature they are direct children
   of the reel. Keeping this lookup in one place prevents later code from
   rebuilding the reels merely to add a win class. */
function visibleReelCells(reel){
 if(!reel)return [];
 const classicTrack=reel.querySelector(":scope > .classic-reel-track");
 if(classicTrack)return [...classicTrack.children].slice(0,3);
 const strip=reel.querySelector(":scope > .v25-symbol-strip");
 return strip ? [...strip.children].slice(0,3) : [...reel.children].slice(0,3);
}

function showWinCells(winCells=new Set()){
 const root=S("slotReels"); if(!root)return;
 [...root.children].forEach((reel,c)=>{
   visibleReelCells(reel).forEach((cell,r)=>{
     const symbol=cell.matches(".bod-symbol") ? cell : cell.querySelector(".bod-symbol");
     symbol?.classList.toggle("win",winCells.has(c+"-"+r));
   });
 });
}

function draw(winCells=new Set()){
 const root=S("slotReels"); if(!root)return;
 root.innerHTML="";
 for(let c=0;c<5;c++){
   const reel=document.createElement("div");
   reel.className="reel reel-static";
   const vals=(grid[c]&&grid[c].length===3)?grid[c]:[pick(),pick(),pick()];
   vals.forEach((v,r)=>{
     const d=makeSymbol(v);
     if(winCells.has(c+"-"+r)) d.classList.add("win");
     reel.appendChild(d);
   });
   root.appendChild(reel);
 }
}
function renderLineBadges(){
 for(const side of ["slotLinesLeft","slotLinesRight"]){
  const el=S(side); if(!el)return; el.innerHTML="";
  const isLeft=side==="slotLinesLeft";
  for(let i=0;i<10;i++){
   const badge=document.createElement("b");
   badge.textContent=i+1;
   badge.style.setProperty("--lc",lineColors[i]);
   badge.style.setProperty("--row", isLeft ? lines[i][0] : lines[i][4]);
   badge.classList.toggle("active",i<activeLines());
   badge.classList.toggle("inactive",i>=activeLines());
   el.appendChild(badge);
  }
 }
}
function drawPaylines(indices=[], preview=false){
 const svg=S("slotPaylines"); if(!svg)return; svg.innerHTML="";
 const winning=new Set(indices);
 const count=preview ? activeLines() : 0;
 const toDraw = winning.size ? [...winning] : Array.from({length:count},(_,i)=>i);
 for(const idx of toDraw){
  const pts=lines[idx].map((row,col)=>`${100+col*200},${100+row*200}`).join(" ");
  const isWin=winning.has(idx);
  const band=document.createElementNS("http://www.w3.org/2000/svg","polyline");
  band.setAttribute("points",pts);band.setAttribute("fill","none");band.setAttribute("stroke",lineColors[idx]);
  band.setAttribute("stroke-width",isWin?"20":"16");band.setAttribute("stroke-opacity",isWin?"0.28":"0.085");
  band.setAttribute("stroke-linejoin","round");band.setAttribute("stroke-linecap","round");band.classList.add("payline-band");svg.appendChild(band);
  const p=document.createElementNS("http://www.w3.org/2000/svg","polyline");
  p.setAttribute("points",pts);p.setAttribute("fill","none");p.setAttribute("stroke",lineColors[idx]);
  p.setAttribute("stroke-width",isWin?"8":"3");p.setAttribute("stroke-opacity",isWin?"1":"0.38");
  p.setAttribute("stroke-linejoin","round");p.setAttribute("stroke-linecap","round");p.classList.add(isWin?"payline-flash":"payline-active");svg.appendChild(p);
 }
}
function previewLines(){ if(!busy && !freeSession) drawPaylines([],true); }
function ui(msg){
 S("slotBalance").innerHTML=moneyHTML(balance);
 S("slotBet").innerHTML=moneyHTML(lineBet);
 S("slotTotalBet").innerHTML=moneyHTML(totalStake());
 S("slotActiveLines").textContent=lineCount;
 S("slotFreeSpins").textContent=free;
 renderFeatureStack();
 const featureVisible=free>0&&!featureRunning;
 S("slotFreePanel").classList.toggle("hidden",!featureVisible);
 S("slotStatusHud")?.classList.toggle("feature-active",featureVisible);
 renderLineBadges();if(msg)S("slotMessage").textContent=msg;
}
function evaluate(){
 let total=0,cells=new Set(),wonLines=[];
 for(let li=0;li<activeLines();li++){
  const line=lines[li], row=line.map((r,c)=>grid[c][r]);
  let target=row[0]==="BOOK"?(row.find(x=>x!=="BOOK")||"BOOK"):row[0],count=0;
  for(const x of row){if(x===target||x==="BOOK")count++;else break}
  if(target!=="BOOK"&&count>=3){
   total+=(pays[target]?.[count-1]||0)*lineBet;
   for(let c=0;c<count;c++)cells.add(c+"-"+line[c]);
   wonLines.push(li);
  }
 }
 /* BOOK ist zusätzlich Scatter: 3/4/5 Bücher zahlen unabhängig von Gewinnlinien. */
 const bookCells=[];
 for(let c=0;c<5;c++)for(let r=0;r<3;r++)if(grid[c][r]==="BOOK")bookCells.push(`${c}-${r}`);
 const scatterCount=Math.min(5,bookCells.length);
 if(scatterCount>=3){
   total+=(scatterPays[scatterCount]||scatterPays[5])*lineBet;
   bookCells.forEach(k=>cells.add(k));
 }
 return {total:Math.floor(total),cells,wonLines,scatterCount};
}
async function animateReels(finalGrid,startGrid){
 const root=S("slotReels");
 if(!root)return;

 const reels=[...root.children];
 const stopTimes=[1850,2075,2325,2600,2900];

 /* V50 – classic Book-of-Ra style reel motion.
    The three stationary result cells always remain in the DOM at exactly the
    same size. A separate, pixel-identical track moves above them and is
    removed only after that reel has landed. Thus start/stop can never resize
    or zoom the actual result. */
 const prepared=reels.map((reel,c)=>{
   const oldStrip=reel.querySelector(":scope > .v25-symbol-strip");
   if(oldStrip){
     const oldSyms=[...oldStrip.children].slice(0,3).map(cell=>
       cell.querySelector(".bod-symbol")?.dataset?.sym
     ).filter(Boolean);
     if(oldSyms.length===3)reel.replaceChildren(...oldSyms.map(makeSymbol));
   }

   const current=(startGrid?.[c]?.length===3)?startGrid[c].slice():grid[c].slice();
   reel.replaceChildren(...current.map(makeSymbol));
   reel.className="reel reel-static v27-fixed-reel classic-reel-spinning";

   const cellH=reel.getBoundingClientRect().height/3;
   /* Classic direction: the current symbols start at the lower end of the
      track and the final symbols sit at its top. Moving from -distance to 0
      makes the symbols travel DOWN, matching the original reel direction. */
   const randomSequence=[];
   /* Fewer travelling rows = lower pixel velocity and much less visual
      strobing on 60 Hz displays, while the reel still shows enough variety. */
   for(let n=0;n<12;n++)randomSequence.push(pick());
   const sequence=[...finalGrid[c],...randomSequence,...current];

   const track=document.createElement("div");
   track.className="classic-reel-track";
   sequence.forEach(sym=>{
     const cell=document.createElement("div");
     cell.className="classic-reel-cell";
     cell.style.height=`${cellH}px`;
     cell.appendChild(makeSymbol(sym));
     track.appendChild(cell);
   });
   const distance=(sequence.length-3)*cellH;
   track.style.transform=`translate3d(0,${-distance}px,0)`;
   reel.appendChild(track);

   return {reel,track,c,cellH,stop:stopTimes[c],distance};
 });

 void root.offsetWidth;
 await Promise.all(prepared.map(({reel,track,c,stop,distance})=>new Promise(resolve=>{
   /* Let the compositor move the track. A single monotonic easing curve can
      only become slower; it cannot produce the mid-spin acceleration/judder
      caused by five JavaScript requestAnimationFrame loops. */
   const motion=track.animate(
     [
       {transform:`translate3d(0,${-distance}px,0)`},
       {transform:"translate3d(0,0,0)"}
     ],
     {duration:stop,easing:"cubic-bezier(.08,.62,.18,1)",fill:"forwards"}
   );
   motion.finished.then(()=>{
     /* Do not touch the track, animation, compositor hint or reel classes at
        the finish. With fill:'forwards' the exact last animated frame remains
        visible. Any cleanup here forces a fresh raster pass and looks like a
        brief end zoom even when the numeric dimensions are unchanged. */
     resolve();
   });
 })));
}

async function animateWin(result){
 if(!result.total)return;
 const root=S("slotReels");
 const cells=[...result.cells];
 const lineList=result.wonLines||[];
 root.classList.add("has-win");
 S("slotWin").classList.add("counting-win");

 /* Zähle den Gewinn sichtbar hoch. */
 const target=result.total, start=performance.now(), dur=Math.min(1500,700+target*12);
 await new Promise(resolve=>{
   const tick=now=>{
     const p=Math.min(1,(now-start)/dur);
     S("slotWin").innerHTML=moneyHTML(Math.floor(target*(1-Math.pow(1-p,3))));
     if(p<1)requestAnimationFrame(tick);else resolve();
   };
   requestAnimationFrame(tick);
 });

 /* Wie beim Vorbild: Gewinnlinie + beteiligte Symbole pulsieren/blinken mehrmals. */
 for(let pulse=0;pulse<3;pulse++){
   cells.forEach(key=>{
     const [c,r]=key.split("-").map(Number);
     const reel=root.children[c];
     const cell=visibleReelCells(reel)[r];
     const el=cell?.matches(".bod-symbol") ? cell : cell?.querySelector(".bod-symbol");
     if(el)el.classList.add("win-celebrate");
   });
   drawPaylines(lineList);
   await sleep(430);
   cells.forEach(key=>{
     const [c,r]=key.split("-").map(Number);
     const reel=root.children[c];
     const cell=visibleReelCells(reel)[r];
     const el=cell?.matches(".bod-symbol") ? cell : cell?.querySelector(".bod-symbol");
     el?.classList.remove("win-celebrate");
   });
   S("slotPaylines").classList.add("paylines-dim");
   await sleep(180);
   S("slotPaylines").classList.remove("paylines-dim");
 }
 S("slotWin").innerHTML=moneyHTML(target);
 S("slotWin").classList.remove("counting-win");
 root.classList.remove("has-win");
}


function ensureFreeOverlay(){
 let o=S('slotFreeOverlay'); if(o)return o;
 o=document.createElement('div'); o.id='slotFreeOverlay'; o.className='nf-overlay hidden';
 o.setAttribute('role','dialog'); o.setAttribute('aria-label','Freispiele');
 o.innerHTML=`<div class="nf-stage"><div class="nf-kicker" id="freeOverlayKicker"></div><h2>FREISPIELE</h2>
 <div class="nf-book"><img class="nf-base" src="assets/free-book-open.png" alt="Geöffnetes 4Slots-Buch">
 <div class="nf-left"><b id="freeOverlayBig">10</b><span>FREISPIELE</span></div>
 <div class="nf-right"><div id="featureChosenSymbol"></div><b id="featureSymbolLabel"></b></div>
 <div class="nf-leaf" aria-hidden="true"><div class="nf-front">✦</div><div class="nf-back">✧</div></div>
 <img class="nf-cover" src="assets/book.png" alt="4Slots Buch"></div>
 <p id="freeOverlayText" aria-live="polite"></p></div>`;
 (document.querySelector('#slot .bod-cabinet')||S('slot')).appendChild(o);return o;
}
async function crossfadeFeatureChosen(el,sym,duration=260,reduced=false){
 if(!el)return;
 if(reduced||typeof el.animate!=='function'){setFeatureChosen(el,sym);return}
 const half=Math.max(90,Math.round(duration/2));
 const outgoing=el.animate([
  {opacity:1,transform:'scale(1)',filter:'blur(0)'},
  {opacity:0,transform:'scale(.96)',filter:'blur(2px)'}
 ],{duration:half,easing:'ease-in',fill:'forwards'});
 await outgoing.finished.catch(()=>{});
 setFeatureChosen(el,sym);
 outgoing.cancel();
 const incoming=el.animate([
  {opacity:0,transform:'scale(1.035)',filter:'blur(2px)'},
  {opacity:1,transform:'scale(1)',filter:'blur(0)'}
 ],{duration:half,easing:'ease-out'});
 await incoming.finished.catch(()=>{});
}
async function playFreeBook(count,sym,retrigger=false){
 featureRunning=true;
 const o=ensureFreeOverlay(),chosen=S('featureChosenSymbol');
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const bookCells=[...document.querySelectorAll('#slotReels [data-sym="BOOK"]')];
 try{
  bookCells.forEach(el=>el.classList.add('nf-trigger'));
  await sleep(reduced?200:1100);
  bookCells.forEach(el=>el.classList.remove('nf-trigger'));
  S('freeOverlayKicker').textContent=retrigger?'WEITERE FREISPIELE':'BONUS AUSGELÖST';
  S('freeOverlayBig').textContent=retrigger?'+'+count:count;
  S('freeOverlayText').textContent='DAS BUCH WÄHLT DEIN SYMBOL …';
  S('featureSymbolLabel').textContent='';setFeatureChosen(chosen,null);
  o.className='nf-overlay';
  await Promise.race([Promise.all([...o.querySelectorAll('img')].map(i=>i.decode().catch(()=>{}))),sleep(1800)]);
  await sleep(250);o.classList.add('nf-open');await sleep(reduced?100:1100);
  const candidates=symbols.filter(s=>s!=='BOOK'&&(!retrigger||!expandSymbols.includes(s)||s===sym));
  const leaf=o.querySelector('.nf-leaf');
  if(!reduced)for(let i=0;i<7;i++){
   const duration=460+i*85;
   leaf.querySelector('.nf-front').innerHTML=symbolMarkup(candidates[i%candidates.length]);
   const animation=leaf.animate([{transform:'rotateY(0deg)',opacity:1},{transform:'rotateY(-85deg)',opacity:1,offset:.5},{transform:'rotateY(-179deg)',opacity:0}],{duration,easing:'ease-in-out'});
   await sleep(duration*.48);
   await crossfadeFeatureChosen(chosen,candidates[(i+1)%candidates.length],Math.min(320,duration*.5),false);
   await animation.finished.catch(()=>{});
  }
  await crossfadeFeatureChosen(chosen,sym,520,reduced);
  S('featureSymbolLabel').textContent=featureGlyph(sym);
  S('freeOverlayText').textContent='DEIN EXPANDIERENDES SYMBOL';
  o.classList.add('nf-chosen');await sleep(2400);
  o.classList.add('nf-out');await sleep(600);
 }finally{
  o.className='nf-overlay hidden';bookCells.forEach(el=>el.classList.remove('nf-trigger'));featureRunning=false;
 }
}

function featureGlyph(sym){
 const map={VALORIAN:"VALORIAN",DERION:"DERION",FACE209:"Fee",FACE193:"Feline",FACE96:"Mensch",WARRIOR:"WARRIOR",PRIEST:"PRIEST",MAGE:"MAGE",ARCHER:"ARCHER",ASSASSIN:"ASSASSIN"};
 return map[sym]||sym||"✦";
}
function featureTileLabel(sym){
 const map={VALORIAN:"VALORIAN",DERION:"DERION",FACE209:"FEE",FACE193:"FELINE",FACE96:"MENSCH",WARRIOR:"KRIEGER",PRIEST:"PRIESTER",MAGE:"MAGIER",ARCHER:"BOGEN",ASSASSIN:"ASSASSINE"};
 return map[sym]||sym||"SYMBOL";
}
function setFeatureChosen(el,sym){
 if(!el)return;
 if(!sym){el.textContent="✦";return}
 el.innerHTML=symbolMarkup(sym);
 el.dataset.sym=sym;
}
function renderFeatureStack(){
 const box=S("slotExpandSymbols");
 if(!box)return;
 const active=freeSession?expandSymbols:[];
 const count=active.length;
 box.style.setProperty("--feature-count",Math.max(1,count));
 box.style.setProperty("--feature-cols",Math.max(1,Math.min(5,count)));
 box.classList.toggle("feature-many",count>5);
 box.innerHTML=active.map((sym,i)=>`<div class="feature-symbol-chip" data-sym="${sym}" title="${i+1}. ${featureTileLabel(sym)}">
   <span class="feature-symbol-art">${symbolMarkup(sym)}</span>
   <b>${featureTileLabel(sym)}</b>
  </div>`).join("");
}
function setGameControlsLocked(locked){
 ["slotSpin","slotBetDown","slotBetUp","slotLineDown","slotLineUp","slotMaxBet"].forEach(id=>{
   const el=S(id); if(el)el.disabled=locked;
 });
}
async function showFreeIntro(count,sym){await playFreeBook(count,sym,false);}
function v47PrepareReelsForExpansion(){
 const root=S("slotReels");
 if(!root)return;

 for(let c=0;c<5;c++){
   const reel=root.children[c];
   if(!reel)continue;

   const strip=reel.querySelector(":scope > .v25-symbol-strip");
   const classicTrack=reel.querySelector(":scope > .classic-reel-track");
   const activeTrack=classicTrack||strip;
   if(!activeTrack)continue;

   const stripCells=[...activeTrack.children].slice(0,3);
   const syms=stripCells.map(cell=>{
     const symbol=cell.matches(".bod-symbol") ? cell : cell.querySelector(".bod-symbol");
     return symbol?.dataset?.sym || null;
   }).filter(Boolean);

   if(syms.length!==3)continue;

   /* No fade/scale. Replace only at the instant the feature needs direct cells.
      CSS below makes both structures pixel-identical. */
   reel.replaceChildren(...syms.map(sym=>makeSymbol(sym)));
   reel.className="bod-reel v27-fixed-reel v47-expand-ready";
 }
}
async function showFreeOutro(total){
 v47PrepareReelsForExpansion();
 featureRunning=true;
 let o=S("classicFreeResult");
 if(!o){
   o=document.createElement("div");
   o.id="classicFreeResult";
   o.className="classic-free-result hidden";
   o.innerHTML=`<div class="classic-result-box">
     <div class="classic-result-small">FREISPIELE BEENDET</div>
     <div class="classic-result-title">GESAMTGEWINN</div>
     <div id="classicResultMoney" class="classic-result-money"></div>
     <div class="classic-result-line"></div>
     <div class="classic-result-note">GEWINN AUS ALLEN FREISPIELEN</div>
   </div>`;
   const cabinet=document.querySelector("#slot .bod-cabinet");
   (cabinet||S("slot")||document.body).appendChild(o);
 }
 S("classicResultMoney").innerHTML=moneyHTML(total);
 o.className="classic-free-result show";
 await sleep(4500);
 o.classList.add("hide-result");
 await sleep(650);
 o.className="classic-free-result hidden";
 featureRunning=false;
}
function chooseExpandSymbol(exclude=[]){
 const eligible=symbols.filter(x=>x!=="BOOK"&&!exclude.includes(x));
 if(!eligible.length)return symbols.find(x=>x!=="BOOK")||"VALORIAN";
 return eligible[Math.floor(Math.random()*eligible.length)];
}
function reelsContaining(sym){
 const result=[];
 for(let c=0;c<5;c++)if(grid[c]?.includes(sym))result.push(c);
 return result;
}
/* Flüssige Expansion: nicht mehr schlagartig draw() -> komplette Walze.
   Das getroffene Symbol pulsiert zuerst; danach werden die drei Positionen
   nacheinander weich in das expandierende Symbol überblendet. Mehrere
   Feature-Symbole werden bewusst NACHEINANDER abgearbeitet. */
async function animateExpandSymbol(sym,featureIndex=0){
 const root=S("slotReels"); if(!root)return;
 for(const c of reelsContaining(sym)){
   const reel=root.children[c]; if(!reel)continue;
   const cells=[...reel.children].slice(0,3); if(cells.length<3)continue;
   const sourceRow=grid[c].findIndex(v=>v===sym); if(sourceRow<0)continue;
   const order=sourceRow===0?[0,1,2]:sourceRow===2?[2,1,0]:[1,0,2];

   cells[sourceRow].classList.add("v27-expand-source");
   await sleep(260);
   cells[sourceRow].classList.remove("v27-expand-source");

   for(const row of order){
     if(row===sourceRow)continue;
     const cell=reel.children[row];
     if(!cell)continue;

     /* V42: echtes Crossfade.
        Das alte Symbol bleibt sichtbar, während das neue expandierende
        Symbol darüber weich eingeblendet wird. Kein schwarzer Leerzustand. */
     /* V44: direkter Symbolwechsel ohne Fade/Schwarz/Leerzustand.
        Das vorhandene Symbol bleibt bis zu diesem Frame sichtbar und wird
        dann in EINEM DOM-Schritt durch das expandierende Symbol ersetzt. */
     cell.classList.remove(
       "v27-expand-change","v27-expand-in",
       "v42-crossfade-cell","v43-crossfade-cell"
     );
     /* Replace the complete fixed cell at the same grid position. Never put
        a .bod-symbol inside another .bod-symbol; that caused the artwork to
        be offset and incorrectly sized. */
     const replacement=makeSymbol(sym);
     replacement.classList.add("v27-expand-in");
     cell.replaceWith(replacement);

     /* Deliberately slower expansion so each changed row is readable. */
     await sleep(360);
     replacement.classList.remove("v27-expand-in");
   }
   grid[c]=[sym,sym,sym];
   reel.classList.add("v27-expanded-reel");
   await sleep(420);
   reel.classList.remove("v27-expanded-reel");
 }
}

async function expandAllActiveSymbols(){
 if(!expandSymbols.length)return;
 for(let i=0;i<expandSymbols.length;i++){
   const sym=expandSymbols[i];
   ui(`FEATURE ${i+1}/${expandSymbols.length} · EXPANDIEREND: ${featureGlyph(sym)}`);
   if(reelsContaining(sym).length){
     await animateExpandSymbol(sym,i);
     await sleep(420);
   }else{
     await sleep(180);
   }
 }
}
async function showRetriggerFeature(count,newSym){await playFreeBook(count,newSym,true);}
function lockVisibleGrid(){
 const root=S("slotReels"); if(!root)return;
 for(let c=0;c<5;c++){
   const reel=root.children[c]; if(!reel)continue;
   reel.replaceChildren(...grid[c].map(sym=>makeSymbol(sym)));
   /* Gleiche DOM-/CSS-Basis wie das normale Standbild.
      Dadurch sehen Spin-Ende und nächster Spin-Anfang identisch aus. */
   reel.className="reel reel-static v27-fixed-reel";
 }
}

async function spin(){
 if(busy||featureRunning)return;
 const fs=free>0;
 if(!fs&&balance<totalStake()){ui("Nicht genug virtuelle Goldmünzen.");return}

 busy=true;
 setGameControlsLocked(true);
 drawPaylines([],false);

 if(fs){ free--; freeSpinNumber++; }
 else { balance-=totalStake(); freeSpinNumber=0; }

 S("slotWin").innerHTML=moneyHTML(0);
 ui(fs?`FREISPIEL ${freeSpinNumber} · Noch ${free} danach · Walzen drehen …`:"Die Walzen drehen …");

 /* Das sichtbare Endbild des letzten Spins ist das Startbild des nächsten Spins. */
 const startGrid=(grid && grid.length===5)
   ? grid.map(col=>col.slice())
   : Array.from({length:5},(_,c)=>{
       const reel=S("slotReels")?.children[c];
       const vals=reel?[...reel.querySelectorAll(":scope > .bod-symbol")].slice(0,3).map(x=>x.dataset.sym).filter(Boolean):[];
       while(vals.length<3) vals.push(pick());
       return vals;
     });

 grid=Array.from({length:5},()=>Array.from({length:3},pick));
 await animateReels(grid,startGrid);
 /* V46: Das exakt sichtbare Endbild des Spin-Strips bleibt stehen.
    Kein zweiter DOM-Aufbau direkt nach dem Stop = kein Zoom/Sprung. */

 /* BOOK-Anzahl VOR Expansion merken, damit ein expandierendes Symbol
    einen Scatter nicht versehentlich aus der Feature-Erkennung löscht. */
 const booksBeforeExpand=grid.flat().filter(x=>x==="BOOK").length;
 let justTriggered=false, retriggered=false, newExpand=null;

 if(booksBeforeExpand>=3&&!fs){
   free=10;
   expandSymbols=[];
   newExpand=chooseExpandSymbol(expandSymbols);
   expandSymbols.push(newExpand);
   expand=newExpand;
   freeSession=true;
   freeSessionTotal=0;
   freeSessionStart=balance;
   freeSpinNumber=0;
   justTriggered=true;
 }

 /* V27: ZUERST das unveränderte Landebild auswerten und auszahlen. */
 const baseWin=evaluate();
 balance+=baseWin.total;
 if(freeSession) freeSessionTotal+=baseWin.total;
 drawPaylines(baseWin.wonLines,false);
 S("slotWin").innerHTML=moneyHTML(0);
 if(baseWin.total){
   ui(`ERSTER LINIENGEWINN: ${moneyText(baseWin.total)}`);
   await animateWin(baseWin);
 }
 drawPaylines([],false);

 /* ERST DANACH expandieren. Der Spin endet mit einem verschachtelten Strip,
    die Expand-Funktion arbeitet absichtlich mit drei festen Direktzellen.
    Deshalb wird die sichtbare Endstellung einmal in die pixelgleiche, feste
    Struktur überführt. Ohne diesen Schritt wurde die Expansion übersprungen. */
 if(fs&&expandSymbols.length){
   v47PrepareReelsForExpansion();
   await expandAllActiveSymbols();
 }

 const w=evaluate();
 if(fs&&expandSymbols.length){
   w.total=Math.max(0,w.total-baseWin.total);
 }else{
   // baseWin wurde oben bereits gutgeschrieben.
   w.total=0;
 }

 /* Falls Expansion BOOK-Zellen optisch ersetzt hat, bleibt der vorher
    ausgelöste Scatter funktional erhalten. */
 if(booksBeforeExpand>=3 && w.scatterCount<3){
   const scatterValue=(scatterPays[Math.min(5,booksBeforeExpand)]||scatterPays[5])*lineBet;
   w.total+=scatterValue;
 }

 balance+=w.total;
 if(freeSession) freeSessionTotal+=w.total;

 /* Nur Gewinnklassen setzen. draw() würde alle Walzen neu erzeugen und war
    die Ursache für den sichtbaren Zoom-/Größensprung nach jedem Spin. */
 showWinCells(w.cells);
 drawPaylines(w.wonLines,false);
 S("slotWin").innerHTML=moneyHTML(0);

 if(fs&&booksBeforeExpand>=3){
   free+=10;
   newExpand=chooseExpandSymbol(expandSymbols);
   if(newExpand&&!expandSymbols.includes(newExpand))expandSymbols.push(newExpand);
   /* Jeder weitere Retrigger fügt ein weiteres anderes Symbol hinzu:
      2., 3., 4. Feature usw. – bestehende Symbole bleiben aktiv. */
   expand=expandSymbols[0]||newExpand;
   retriggered=true;
 }

 if(justTriggered){
   ui(w.total?`BONUS! ${moneyText(w.total)} · Das Buch startet …`:"BONUS! Das Buch startet …");
 }else if(retriggered){
   ui(`ERNEUTER BONUS! +10 FREISPIELE · Neues Symbol wird gewählt …`);
 }else{
   const ex=expandSymbols.length?` · Expandierend: ${expandSymbols.map(featureGlyph).join(" + ")}`:"";
   ui(w.total?`GEWINN: ${moneyText(w.total)}${w.wonLines.length?` · Linie ${w.wonLines.map(x=>x+1).join(", ")}`:" · Scatter"}!${ex}`:
      fs?`Noch ${free} Freispiele${ex}`:"Kein Gewinn.");
 }

 if(w.total) await animateWin(w);

 if(justTriggered){
   await showFreeIntro(10,newExpand);
   ui(`10 FREISPIELE · EXPANDIEREND: ${expandSymbols.map(featureGlyph).join(" + ")}`);
 }

 if(retriggered){
   /* Wichtig: Der aktuelle Freispiel-Spin ist komplett beendet.
      Erst dann wird das Buch erneut gezeigt und das zweite Symbol gerollt. */
   await showRetriggerFeature(10,newExpand);
   ui(`+10 FREISPIELE · EXPANDIEREND: ${expandSymbols.map(featureGlyph).join(" + ")}`);
 }

 busy=false;
 setGameControlsLocked(false);

 if(free>0){
   await sleep(900);
   return spin();
 }

 if(fs&&freeSession){
   const total=freeSessionTotal;
   freeSession=false;
   await showFreeOutro(total);
   expand=null;
   expandSymbols=[];
   freeSpinNumber=0;
   ui(`FREISPIELE BEENDET · GESAMTGEWINN: ${moneyText(total)}`);
   if(auto){await sleep(1000);return spin()}
   previewLines();
   return;
 }

 if(auto){
   await sleep(1000);
   return spin();
 }
 previewLines();
}
document.addEventListener("DOMContentLoaded",()=>{
 grid=Array.from({length:5},()=>Array.from({length:3},pick));draw();ui();previewLines();
 S("slotModeBtn")?.addEventListener("click",()=>{document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));S("slot").classList.remove("hidden");document.querySelectorAll(".mode,.slot-mode-btn").forEach(x=>x.classList.remove("active"));S("slotModeBtn").classList.add("active");updateChrome()});
 S("slotSpin")?.addEventListener("click",spin);
 S("slotBetDown")?.addEventListener("click",()=>{if(!busy){lineBet=Math.max(10,lineBet-10);ui()}});
 S("slotBetUp")?.addEventListener("click",()=>{if(!busy){lineBet=Math.min(100,lineBet+10);ui()}});
 S("slotLineDown")?.addEventListener("click",()=>{if(!busy){lineCount=Math.max(1,lineCount-1);ui();previewLines()}});
 S("slotLineUp")?.addEventListener("click",()=>{if(!busy){lineCount=Math.min(10,lineCount+1);ui();previewLines()}});
 S("slotMaxBet")?.addEventListener("click",()=>{if(!busy){lineBet=100;lineCount=10;ui();previewLines()}});
 S("slotAuto")?.addEventListener("click",()=>{auto=!auto;S("slotAuto").classList.toggle("active",auto);S("slotAuto").textContent=auto?"AUTO STOP":"AUTO SPIN";if(auto&&!busy&&!featureRunning)spin()});
 S("slotPaytable")?.addEventListener("click",()=>S("slotPaytablePanel").classList.remove("hidden"));
 S("slotPaytableClose")?.addEventListener("click",()=>S("slotPaytablePanel").classList.add("hidden"));
 S("slotPaytablePanel")?.addEventListener("click",e=>{if(e.target===S("slotPaytablePanel"))S("slotPaytablePanel").classList.add("hidden")});
});
})();
