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


(()=>{
const S=id=>document.getElementById(id), sy=["👑","💎","⚔️","🏺","🦅","A","K","Q","J","📖"], wt=[5,7,9,10,10,12,12,12,12,11];
const pay={"👑":[0,0,20,100,500],"💎":[0,0,15,75,300],"⚔️":[0,0,10,50,200],"🏺":[0,0,8,35,150],"🦅":[0,0,8,30,120],"A":[0,0,6,25,100],"K":[0,0,5,20,80],"Q":[0,0,4,15,60],"J":[0,0,3,12,50]}, ln=[[0,0,0,0,0],[1,1,1,1,1],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0]];
let bal=1000,bet=10,g=[],busy=false,free=0,ex=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pick=()=>{let r=Math.random()*wt.reduce((a,b)=>a+b,0);for(let i=0;i<sy.length;i++){r-=wt[i];if(r<=0)return sy[i]}return"J"};
const cellHeight=()=>matchMedia('(max-width:760px)').matches?80:112;
function makeSymbol(v){const d=document.createElement('div');d.className='symbol';d.textContent=v;return d}
function draw(w=new Set()){const root=S('slotReels');if(!root)return;root.innerHTML='';for(let c=0;c<5;c++){const reel=document.createElement('div'),strip=document.createElement('div');reel.className='reel';strip.className='reel-strip';const vals=[...Array.from({length:3},pick),...(g[c]||[pick(),pick(),pick()]),...Array.from({length:3},pick)];vals.forEach((v,i)=>{const d=makeSymbol(v);if(i>=3&&i<6&&w.has(c+'-'+(i-3)))d.classList.add('win');strip.appendChild(d)});strip.style.transform=`translateY(${-3*cellHeight()}px)`;reel.appendChild(strip);root.appendChild(reel)}}
function ui(t){S('slotBalance').textContent=bal;S('slotBet').textContent=bet;S('slotFreeSpins').textContent=free;S('slotExpandSymbol').textContent=ex||'—';S('slotFreePanel').classList.toggle('hidden',free<=0);S('slotBetMirror').textContent=bet;S('slotWinMirror').textContent=S('slotWin').textContent||0;if(t)S('slotMessage').textContent=t}
function evalWin(){let total=0,cells=new Set;for(const l of ln){let row=l.map((r,c)=>g[c][r]),tar=row[0]=='📖'?(row.find(x=>x!='📖')||'📖'):row[0],n=0;for(const x of row){if(x==tar||x=='📖')n++;else break}if(tar!='📖'&&n>=3){total+=(pay[tar]?.[n-1]||0)*bet;for(let c=0;c<n;c++)cells.add(c+'-'+l[c])}}return{total:Math.floor(total),cells}}
async function animateReels(finalGrid){const root=S('slotReels');root.innerHTML='';const h=cellHeight(),reels=[];for(let c=0;c<5;c++){const reel=document.createElement('div'),strip=document.createElement('div');reel.className='reel spinning';strip.className='reel-strip';const lead=Array.from({length:18+c*3},pick),vals=[...lead,...finalGrid[c]];vals.forEach(v=>strip.appendChild(makeSymbol(v)));reel.appendChild(strip);root.appendChild(reel);reels.push({reel,strip,lead:lead.length});strip.style.transform='translateY(0px)'}await sleep(40);await Promise.all(reels.map(({reel,strip,lead},c)=>new Promise(resolve=>{const ms=1050+c*230;strip.style.transition=`transform ${ms}ms cubic-bezier(.12,.72,.18,1)`;requestAnimationFrame(()=>strip.style.transform=`translateY(${-lead*h}px)`);setTimeout(()=>{reel.classList.remove('spinning');resolve()},ms+60)})))}
async function spin(){if(busy)return;const fs=free>0;if(!fs&&bal<bet){ui('Nicht genug virtuelle Goldmünzen.');return}busy=true;['slotSpin','slotBetDown','slotBetUp'].forEach(id=>S(id).disabled=true);if(fs)free--;else bal-=bet;S('slotWin').textContent=0;ui('Die Walzen drehen …');g=Array.from({length:5},()=>Array.from({length:3},pick));await animateReels(g);let books=g.flat().filter(x=>x=='📖').length;if(books>=3&&!fs){free=8;ex=sy[Math.floor(Math.random()*9)]}if(fs&&ex)for(let c=0;c<5;c++)if(g[c].includes(ex))g[c]=[ex,ex,ex];const w=evalWin();bal+=w.total;draw(w.cells);S('slotWin').textContent=w.total;ui(books>=3&&!fs?'📖 8 Freispiele! Expandierend: '+ex:w.total?'🏆 Gewinn: '+w.total+' Goldmünzen!':'Kein Gewinn.');if(free==0)ex=null;busy=false;['slotSpin','slotBetDown','slotBetUp'].forEach(id=>S(id).disabled=false);if(free>0){await sleep(700);spin()}}
document.addEventListener('DOMContentLoaded',()=>{g=Array.from({length:5},()=>Array.from({length:3},pick));draw();ui();S('slotModeBtn')?.addEventListener('click',()=>{document.querySelectorAll('.view').forEach(x=>x.classList.add('hidden'));S('slot').classList.remove('hidden');document.querySelectorAll('.mode,.slot-mode-btn').forEach(x=>x.classList.remove('active'));S('slotModeBtn').classList.add('active');updateChrome()});S('slotSpin')?.addEventListener('click',spin);S('slotBetDown')?.addEventListener('click',()=>{if(!busy){bet=Math.max(1,bet-1);ui()}});S('slotBetUp')?.addEventListener('click',()=>{if(!busy){bet=Math.min(10,bet+1);ui()}})})
})();


/* ===== BOOK OF DICE V3 – virtual coins only ===== */
(()=>{
const S=id=>document.getElementById(id);
const symbols=["A","SCARAB","BOOK","Q","K","10","J","PHARAOH","PYRAMID","ANUBIS"];
const weights=[13,7,8,13,13,12,12,6,8,8];
const pays={
 A:[0,0,5,18,70], K:[0,0,5,16,60], Q:[0,0,4,14,50], J:[0,0,4,12,45], "10":[0,0,3,10,40],
 SCARAB:[0,0,9,35,140], PHARAOH:[0,0,12,50,220], PYRAMID:[0,0,8,30,120], ANUBIS:[0,0,10,40,170]
};
const lines=[
 [1,1,1,1,1], /* Linie 1: MITTE */
 [0,0,0,0,0], /* Linie 2: OBEN */
 [2,2,2,2,2], /* Linie 3: UNTEN */
 [0,1,2,1,0],[2,1,0,1,2],
 [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0]
];
const lineColors=["#efb320","#20b34b","#d73b2e","#315bd7","#a84ae8","#f39a25","#14a779","#35aee8","#e24a96","#a743e8"];
let balance=1000, bet=1, grid=[], busy=false, free=0, expand=null, auto=false;
const activeLines=()=>10;
const pick=()=>{let r=Math.random()*weights.reduce((a,b)=>a+b,0);for(let i=0;i<symbols.length;i++){r-=weights[i];if(r<=0)return symbols[i]}return "J"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function symbolMarkup(v){
 const map={
  SCARAB:'<span class="sym-scarab"><i></i><b></b></span>',
  BOOK:'<span class="sym-book"><i>♦</i></span>',
  PHARAOH:'<span class="sym-pharaoh">♛</span>',
  PYRAMID:'<span class="sym-pyramid">▲</span>',
  ANUBIS:'<span class="sym-anubis">♞</span>'
 };
 return map[v]||`<span class="sym-letter sym-${v}">${v}</span>`;
}
function makeSymbol(v){const d=document.createElement("div");d.className="symbol bod-symbol";d.dataset.sym=v;d.innerHTML=symbolMarkup(v);return d}
function cellHeight(){const r=document.querySelector("#slotReels .reel");return r?Math.max(80,r.clientHeight/3):150}

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
  for(let i=0;i<10;i++){const b=document.createElement("b");b.textContent=i+1;b.style.setProperty("--lc",lineColors[i]);b.classList.toggle("active",i<activeLines());el.appendChild(b)}
 }
}
function drawPaylines(indices=[]){
 const svg=S("slotPaylines"); if(!svg)return; svg.innerHTML="";
 indices.forEach(idx=>{
  const pts=lines[idx].map((row,col)=>`${100+col*200},${100+row*200}`).join(" ");
  const p=document.createElementNS("http://www.w3.org/2000/svg","polyline");
  p.setAttribute("points",pts);p.setAttribute("fill","none");p.setAttribute("stroke",lineColors[idx]);p.setAttribute("stroke-width","12");p.setAttribute("stroke-linejoin","round");p.setAttribute("stroke-linecap","round");p.classList.add("payline-flash");svg.appendChild(p);
 });
}
function ui(msg){
 S("slotBalance").textContent=balance;S("slotBet").textContent=bet;S("slotWin").textContent=S("slotWin").textContent||0;
 S("slotActiveLines").textContent="10";S("slotFreeSpins").textContent=free;S("slotExpandSymbol").textContent=expand||"—";
 S("slotFreePanel").classList.toggle("hidden",free<=0);renderLineBadges();if(msg)S("slotMessage").textContent=msg;
}
function evaluate(){
 let total=0,cells=new Set(),wonLines=[];
 for(let li=0;li<activeLines();li++){
  const line=lines[li], row=line.map((r,c)=>grid[c][r]);
  let target=row[0]==="BOOK"?(row.find(x=>x!=="BOOK")||"BOOK"):row[0],count=0;
  for(const x of row){if(x===target||x==="BOOK")count++;else break}
  if(target!=="BOOK"&&count>=3){
   total+=(pays[target]?.[count-1]||0)*bet;
   for(let c=0;c<count;c++)cells.add(c+"-"+line[c]);wonLines.push(li);
  }
 }
 return {total:Math.floor(total),cells,wonLines};
}
async function animateReels(finalGrid){
 const root=S("slotReels");
 if(!root)return;
 root.innerHTML="";
 const h=cellHeight(), jobs=[];

 for(let c=0;c<5;c++){
   const reel=document.createElement("div");
   const strip=document.createElement("div");
   reel.className="reel spinning";
   strip.className="reel-strip";

   /* Endsymbole stehen GANZ OBEN. Darunter liegen Zufallssymbole.
      Wir starten tief im Streifen und fahren nach UNTEN auf translateY(0).
      Dadurch kommen die endgültigen Symbole sichtbar VON OBEN in das Fenster. */
   const trail=Array.from({length:18+c*3},pick);
   const vals=[...finalGrid[c],...trail];
   vals.forEach(v=>strip.appendChild(makeSymbol(v)));

   reel.appendChild(strip);
   root.appendChild(reel);

   const startRows=trail.length;
   strip.style.transition="none";
   strip.style.transform=`translateY(${-startRows*h}px)`;
   jobs.push({reel,strip});
 }

 await sleep(80);

 await Promise.all(jobs.map(({reel,strip},c)=>new Promise(resolve=>{
   const ms=1450+c*260; /* bewusst langsamer und nacheinander */
   strip.style.transition=`transform ${ms}ms cubic-bezier(.16,.70,.18,1)`;
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
     strip.style.transform="translateY(0px)";
   }));
   setTimeout(()=>{
     reel.classList.remove("spinning");
     resolve();
   },ms+80);
 })));

 /* Entscheidend: Animations-DOM komplett wegwerfen.
    Danach wird ausschließlich das echte 5x3-Endergebnis gezeichnet. */
 draw();
}
async function spin(){
 if(busy)return;const fs=free>0;if(!fs&&balance<bet){ui("Nicht genug virtuelle Goldmünzen.");return}
 busy=true;["slotSpin","slotBetDown","slotBetUp","slotMaxBet"].forEach(id=>{if(S(id))S(id).disabled=true});
 if(fs)free--;else balance-=bet;S("slotWin").textContent="0";drawPaylines([]);ui("Die Walzen drehen …");
 grid=Array.from({length:5},()=>Array.from({length:3},pick));
 await animateReels(grid);
 draw(); /* Animation vollständig entfernen und echtes 5x3-Endergebnis neu aufbauen */
 const books=grid.flat().filter(x=>x==="BOOK").length;
 if(books>=3&&!fs){free=8;expand=symbols.filter(x=>x!=="BOOK")[Math.floor(Math.random()*9)]}
 if(fs&&expand)for(let c=0;c<5;c++)if(grid[c].includes(expand))grid[c]=[expand,expand,expand];
 draw();
 const w=evaluate();balance+=w.total;draw(w.cells);drawPaylines(w.wonLines);S("slotWin").textContent=w.total;
 ui(books>=3&&!fs?`8 Freispiele! Expandierendes Symbol: ${expand}`:w.total?`GEWINN: ${w.total} Goldmünzen · Linie ${w.wonLines.map(x=>x+1).join(", ")}`:"Kein Gewinn.");
 busy=false;["slotSpin","slotBetDown","slotBetUp","slotMaxBet"].forEach(id=>{if(S(id))S(id).disabled=false});
 if(free>0){await sleep(1100);spin()}else if(auto){await sleep(1000);spin()}
}
document.addEventListener("DOMContentLoaded",()=>{
 grid=Array.from({length:5},()=>Array.from({length:3},pick));draw();ui();
 S("slotModeBtn")?.addEventListener("click",()=>{document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));S("slot").classList.remove("hidden");document.querySelectorAll(".mode,.slot-mode-btn").forEach(x=>x.classList.remove("active"));S("slotModeBtn").classList.add("active");updateChrome()});
 S("slotSpin")?.addEventListener("click",spin);
 S("slotBetDown")?.addEventListener("click",()=>{if(!busy){bet=Math.max(1,bet-1);ui()}});
 S("slotBetUp")?.addEventListener("click",()=>{if(!busy){bet=Math.min(10,bet+1);ui()}});
 S("slotMaxBet")?.addEventListener("click",()=>{if(!busy){bet=10;ui()}});
 S("slotAuto")?.addEventListener("click",()=>{auto=!auto;S("slotAuto").classList.toggle("active",auto);S("slotAuto").textContent=auto?"AUTO STOP":"AUTO SPIN";if(auto&&!busy)spin()});
 S("slotPaytable")?.addEventListener("click",()=>S("slotPaytablePanel").classList.toggle("hidden"));
});
})();
