/* 假 Firebase：喺載入 index.html 之前注入，等 fbInit 唔會去 CDN 攞 SDK。
   一個記憶體 RTDB + 一個夠用嘅 auth，專登用嚟試匿名登入／綁定／新手引導嗰幾條路。

   ⚠ 呢度**特登扮到 session 係非同步還原**（同真 Firebase 一樣）：
     firebase.auth() 之後即刻讀 currentUser 一定係 null，
     要等第一次 onAuthStateChanged 響咗先知有冇舊 session。
     之前個 stub 係同步返答案，所以隱瞞咗一個真 bug ——
     每次冷啟動都會開多個新匿名帳戶。呢個模型就係為咗釘實佢。

   測試想扮「上次登入過」就喺 addInitScript 度設 window.__PERSISTED：
     { uid:'anon1', anon:true }              上次係匿名
     { uid:'g1', email:'me@x.com' }          上次綁咗 Google／電郵 */
(function(){
  const DB = {};
  const get = p => p.split('/').filter(Boolean).reduce((o,k)=>(o==null?undefined:o[k]), DB);
  const set = (p,v) => {
    const ks = p.split('/').filter(Boolean);
    let o = DB;
    ks.slice(0,-1).forEach(k=>{ if(typeof o[k]!=='object'||o[k]===null) o[k]={}; o=o[k]; });
    if(v===null) delete o[ks[ks.length-1]]; else o[ks[ks.length-1]] = JSON.parse(JSON.stringify(v));
  };
  const snap = v => ({ val:()=>v===undefined?null:v, exists:()=>v!==undefined && v!==null });

  function ref(path){
    return {
      path,
      child: c => ref(path+'/'+c),
      get: async () => snap(get(path)),
      set: async v => set(path, v),
      update: async v => { const cur = get(path) || {}; set(path, Object.assign({}, cur, v)); },
      remove: async () => set(path, null),
      transaction: (fn, cb) => { const nv = fn(get(path)); set(path, nv); if(cb) cb(null, true, snap(nv)); },
      on(){}, off(){},
    };
  }

  let listeners = [], current = null, restored = false, nextAnon = 1, anonMade = 0;
  const fire = () => listeners.slice().forEach(f=>{ try{ f(current); }catch(e){} });
  const mkUser = (uid, email, anon) => ({ uid, email: email||null, isAnonymous: !!anon,
    linkWithPopup: async () => {
      if(window.__STUB.linkFails){ const e = new Error('in use'); e.code='auth/credential-already-in-use';
        e.credential = {provider:'google', email:window.__STUB.googleEmail}; throw e; }
      current = mkUser(uid, window.__STUB.googleEmail || 'g@example.com', false); fire(); return { user: current };
    },
    linkWithCredential: async cred => {
      if(window.__STUB.linkFails){ const e=new Error('in use'); e.code='auth/email-already-in-use'; throw e; }
      current = mkUser(uid, cred.email, false); fire(); return { user: current };
    },
  });

  /* 非同步還原 session。兩個位一定要似足真 Firebase，唔係就試唔出個 race：
     1. 條時間線由 **firebase.auth() 第一次被叫** 嗰刻先開始計，
        唔係由呢個 stub 載入嗰刻 —— 如果由載入計，等 fbInit 行到嗰陣
        20ms 早就過咗，currentUser 已經有值，個 bug 就會被隱瞞。
     2. 如果中途已經有人明確登入過（例如 signInAnonymously），
        還原就唔可以夾硬蓋返落去 —— 真 Firebase 唔會用舊 session
        推翻一個新嘅登入。 */
  let restoreStarted = false, explicitSignIn = false;
  function startRestore(){
    if(restoreStarted) return;
    restoreStarted = true;
    setTimeout(()=>{
      const p = window.__PERSISTED;
      if(p && !explicitSignIn) current = mkUser(p.uid, p.email, p.anon !== false && !p.email);
      restored = true;
      fire();
    }, 20);
  }

  const AUTH = {
    get currentUser(){ return current; },
    async setPersistence(){ /* no-op */ },
    onAuthStateChanged(f){
      listeners.push(f);
      if(restored) Promise.resolve().then(()=>f(current));
      return () => { const i = listeners.indexOf(f); if(i>=0) listeners.splice(i,1); };
    },
    async signInAnonymously(){
      if(window.__STUB.anonFails){ const e=new Error('nope'); e.code='auth/operation-not-allowed'; throw e; }
      explicitSignIn = true; anonMade++;
      current = mkUser('anon'+(nextAnon++), null, true); fire(); return { user: current };
    },
    async signOut(){ current = null; fire(); },
    async signInWithCredential(c){ explicitSignIn = true; current = mkUser('existing-google', c.email||'g@example.com', false); fire(); return {user:current}; },
    async signInWithPopup(){ explicitSignIn = true; current = mkUser('existing-google', 'g@example.com', false); fire(); return {user:current}; },
    async signInWithEmailAndPassword(email){ explicitSignIn = true; current = mkUser('existing-mail', email, false); fire(); return {user:current}; },
    async createUserWithEmailAndPassword(email){ explicitSignIn = true; current = mkUser('new-mail', email, false); fire(); return {user:current}; },
  };
  const auth = () => { startRestore(); return AUTH; };
  auth.GoogleAuthProvider = function(){ this.providerId='google.com'; };
  auth.EmailAuthProvider = { credential:(email,pw)=>({email,pw}) };
  auth.Auth = { Persistence: { LOCAL:'local', SESSION:'session', NONE:'none' } };

  window.__STUB = { DB, get, anonFails:false, linkFails:false, googleEmail:'me@example.com',
                    anonMade:()=>anonMade };
  window.firebase = {
    apps: [], app: ()=>({}), initializeApp: ()=>({}),
    auth, database: ()=>({ ref }),
  };
})();
