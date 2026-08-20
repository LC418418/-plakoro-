/* 迴歸測試：抗性遺物唔可以令已經倒下嘅寶可夢復活
   （原本個 bug：takeTurn 扣血 clamp 咗喺 0，抗性再喺 0 度補返血，
     結果血 5 中 115 傷都仲有 5 血，永遠打唔死）
   用法：node tools/test-resist.mjs */
import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await p.goto('file:///home/user/-plakoro-/index.html');
await p.waitForFunction(()=>window.__plk&&window.__plk.ready);
console.log(await p.evaluate(()=>{
  const out=[];
  const scenarios=[
    ['血 5・中 115 傷・冇抗體', 5, null],
    ['血 5・中 115 傷・空抗體 5', 5, {空:5}],
    ['血 120・中 115 傷・空抗體 5', 120, {空:5}],
    ['血 3・中 4 傷・空抗體 5', 3, {空:5}],
  ];
  for(const [name, hp, resist] of scenarios){
    const run=newRun([{dex:26,setIdx:0,deckIdx:bestFour(26),loadout:defaultLoadout()},
                      {dex:6,setIdx:0,deckIdx:bestFour(6),loadout:defaultLoadout()},
                      {dex:9,setIdx:0,deckIdx:bestFour(9),loadout:defaultLoadout()}]);
    run.act=ACTS;
    const g=battleStart(run, buildEnemy(run,'e4'));
    if(resist) g.rs.resist=resist;
    const meMon=g.sides[0].party[g.sides[0].active];
    const foe =g.sides[1].party[g.sides[1].active];
    meMon.hp=hp;
    // 敵人用一招零成本、空屬性、指定傷害嘅招
    const dmg = name.includes('中 4') ? 4 : 115;
    foe.deck=[{name:'測試招', type:'空', dmg, cost:[], faces:[{f:'',ops:[]}]}];
    foe.lastMove=null; foe.pendingLock=null;
    g.turn=1;
    const L=partyTurn(g, 0, null, newSeed());
    // 要睇返「被打嗰隻」，唔係睇 active（佢死咗會自動換人）
    out.push(`${name}\n   最後傷害 ${L.final}　血 ${hp} → ${meMon.hp}　倒下=${meMon.hp<=0}　L.faint=${(L.faint||[]).length}`);
  }
  return out.join('\n');
}));
console.log('errors:', errs.join('|')||'(none)');
await b.close();
