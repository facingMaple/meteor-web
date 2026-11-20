(() => {
  if (!['linfengya.cn', 'www.linfengya.cn'].includes(location.hostname) || !location.pathname.startsWith('/lx')) return;
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) return;
  crypto.getRandomValues(bytes);
  const session = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  const started = performance.now();
  let visibleStart = document.hidden ? null : performance.now(), active = 0, interacted = false, errors = 0;
  const snapshot = () => Math.floor(active + (visibleStart === null ? 0 : (performance.now() - visibleStart) / 1000));
  const send = (event, details = {}) => {
    const body = JSON.stringify({session, event, details});
    if ((event === 'activity') && navigator.sendBeacon && navigator.sendBeacon('/api/analytics', new Blob([body], {type:'application/json'}))) return;
    fetch('/api/analytics', {method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true}).catch(() => {});
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
