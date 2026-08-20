/* 假 Firebase：喺載入 index.html 之前注入，等 fbInit 唔會去 CDN 攞 SDK。
   一個記憶體 RTDB + 一個夠用嘅 auth，專登用嚟試匿名登入／綁定／新手引導嗰幾條路。 */
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

  let listeners = [], current = null, nextAnon = 1;
  const fire = () => listeners.forEach(f=>{ try{ f(current); }catch(e){} });
  const mkUser = (uid, email, anon) => ({ uid, email: email||null, isAnonymous: !!anon,
    linkWithPopup: async prov => {
      if(window.__STUB.linkFails) { const e = new Error('in use'); e.code='auth/credential-already-in-use';
        e.credential = {provider:'google', email:window.__STUB.googleEmail}; throw e; }
      current = mkUser(uid, window.__STUB.googleEmail || 'g@example.com', false); fire(); return { user: current };
    },
    linkWithCredential: async cred => {
      if(window.__STUB.linkFails){ const e=new Error('in use'); e.code='auth/email-already-in-use'; throw e; }
      current = mkUser(uid, cred.email, false); fire(); return { user: current };
    },
  });

  const auth = () => ({
    get currentUser(){ return current; },
    onAuthStateChanged(f){ listeners.push(f); Promise.resolve().then(()=>f(current)); },
    async signInAnonymously(){
      if(window.__STUB.anonFails){ const e=new Error('nope'); e.code='auth/operation-not-allowed'; throw e; }
      current = mkUser('anon'+(nextAnon++), null, true); fire(); return { user: current };
    },
    async signOut(){ current = null; fire(); },
    async signInWithCredential(c){ current = mkUser('existing-google', c.email||'g@example.com', false); fire(); return {user:current}; },
    async signInWithPopup(){ current = mkUser('existing-google', 'g@example.com', false); fire(); return {user:current}; },
    async signInWithEmailAndPassword(email){ current = mkUser('existing-mail', email, false); fire(); return {user:current}; },
    async createUserWithEmailAndPassword(email){ current = mkUser('new-mail', email, false); fire(); return {user:current}; },
  });
  auth.GoogleAuthProvider = function(){ this.providerId='google.com'; };
  auth.EmailAuthProvider = { credential:(email,pw)=>({email,pw}) };

  window.__STUB = { DB, get, anonFails:false, linkFails:false, googleEmail:'me@example.com' };
  window.firebase = {
    apps: [], app: ()=>({}), initializeApp: ()=>({}),
    auth, database: ()=>({ ref }),
  };
})();
