(() => {
  if (!['linfengya.cn', 'www.linfengya.cn'].includes(location.hostname) || !location.pathname.startsWith('/lx')) return;
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.subtle) return;
  crypto.getRandomValues(bytes);
  const session = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  const started = performance.now();
  let visibleStart = document.hidden ? null : performance.now(), active = 0, interacted = false, errors = 0;
  const snapshot = () => Math.floor(active + (visibleStart === null ? 0 : (performance.now() - visibleStart) / 1000));
  const encoder = new TextEncoder();
  const additionalData = encoder.encode('yx-analytics-wire-v1');
  const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  let keyPromise;

  function encryptionKey() {
    if (!keyPromise) {
      keyPromise = (async () => {
        const response = await fetch('/api/analytics/key', {cache:'no-store'});
        if (!response.ok) throw new Error('Analytics key unavailable');
        const {v, spki} = await response.json();
        if (v !== 1 || typeof spki !== 'string') throw new Error('Unsupported analytics key');
        const publicKey = await crypto.subtle.importKey('spki', Uint8Array.from(atob(spki), c => c.charCodeAt(0)),
          {name:'RSA-OAEP', hash:'SHA-256'}, false, ['encrypt']);
        const raw = crypto.getRandomValues(new Uint8Array(32));
        const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
        const wrapped = await crypto.subtle.encrypt({name:'RSA-OAEP'}, publicKey, raw);
        return {key, wrapped:base64(wrapped)};
      })().catch(error => {
        keyPromise = undefined;
        throw error;
      });
    }
    return keyPromise;
  }

  const send = (event, details = {}) => {
    encryptionKey().then(async ({key, wrapped}) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const json = encoder.encode(JSON.stringify({session, event, details}));
      const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData}, key, json);
      const body = JSON.stringify({v:1, key:wrapped, iv:base64(iv), data:base64(ciphertext)});
      if (event === 'activity' && navigator.sendBeacon?.('/api/analytics', new Blob([body], {type:'application/json'}))) return;
      await fetch('/api/analytics', {method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true});
    }).catch(() => {});
  };
  let source = '';
  try { source = document.referrer ? new URL(document.referrer).hostname : ''; } catch {}
  const params = new URLSearchParams(location.search);
  const channel = (params.get('utm_source') || '').replace(/[^\w.-]/g, '').slice(0, 100);
  send('page_view', {source, channel});
  let webgl = 'unknown';
  try { const canvas = document.createElement('canvas'); webgl = canvas.getContext('webgl2') || canvas.getContext('webgl') ? 'available' : 'unavailable'; } catch { webgl = 'unavailable'; }
  window.gameAnalytics = {send, elapsed: () => Math.round(performance.now() - started), webgl};
  for (const type of ['pointerdown','keydown','touchstart']) document.addEventListener(type, e => { if (!interacted && e.isTrusted) { interacted = true; send('interaction'); } }, {capture:true, passive:true});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && visibleStart !== null) { active += (performance.now() - visibleStart) / 1000; visibleStart = null; send('activity', {active_seconds:snapshot()}); }
    else if (!document.hidden && visibleStart === null) visibleStart = performance.now();
  });
  window.addEventListener('pagehide', () => send('activity', {active_seconds:snapshot()}));
  setInterval(() => { if (!document.hidden) send('activity', {active_seconds:snapshot()}); }, 60000);
  window.addEventListener('error', e => { if (errors++ < 5) send('error', {kind:e.target !== window ? 'resource' : 'javascript'}); }, true);
  window.addEventListener('unhandledrejection', () => { if (errors++ < 5) send('error', {kind:'promise'}); });
})();
