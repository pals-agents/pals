// Browser client for the PALS server API.
export const state = {ready: false, health: null, authed: false, wallet: null};

async function req(method, url, body) {
  const r = await fetch(url, {method, credentials: 'same-origin', headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), {status: r.status});
  return j;
}
const b64 = bytes => btoa(String.fromCharCode(...bytes));

export async function init() {
  try {
    state.health = await req('GET', '/api/health');
    state.ready = true;
    try { const me = await req('GET', '/api/me'); state.authed = true; state.wallet = me.wallet; } catch {}
  } catch { state.ready = false; }
  return state;
}

// Sign-in with a wallet provider that supports signMessage (Phantom, Solflare, Backpack...)
export async function signIn(wallet, provider) {
  if (!provider || !provider.signMessage) throw new Error('this wallet cannot sign messages');
  const {message} = await req('POST', '/api/auth/nonce', {wallet});
  const res = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
  const sig = res && res.signature ? res.signature : res;
  await req('POST', '/api/auth/verify', {wallet, signature: b64(new Uint8Array(sig))});
  state.authed = true; state.wallet = wallet;
}
export async function logout() { try { await req('POST', '/api/auth/logout'); } catch {} state.authed = false; state.wallet = null; }

export const getPal = key => req('GET', `/api/pals/${key}`);
export const addMemory = (key, text, type = 'fact') => req('POST', `/api/pals/${key}/memories`, {text, type});
export const deleteMemory = (key, id) => req('DELETE', `/api/pals/${key}/memories/${id}`);
export const clearMemories = key => req('DELETE', `/api/pals/${key}/memories`);
export const clearHistory = key => req('DELETE', `/api/pals/${key}/history`);
export const listSkills = key => req('GET', `/api/pals/${key}/skills`);
export const getSkill = (key, id) => req('GET', `/api/pals/${key}/skills/${id}`);
export const uploadSkill = (key, filename, text) => req('POST', `/api/pals/${key}/skills`, {filename, text});
export const approveSkill = (key, id) => req('POST', `/api/pals/${key}/skills/${id}/approve`);
export const deleteSkill = (key, id) => req('DELETE', `/api/pals/${key}/skills/${id}`);
export const deleteTool = (key, id) => req('DELETE', `/api/pals/${key}/tools/${id}`);
export const mint = key => req('POST', `/api/pals/${key}/mint`);
export const mintPrepare = key => req('POST', `/api/pals/${key}/mint/prepare`);
export const burnStatus = key => req('GET', `/api/pals/${key}/mint/burn`);
export const mintConfirm = (key, signature) => req('POST', `/api/pals/${key}/mint/confirm`, {signature});
export const econ = () => req('GET', '/api/econ');

// Streams a chat turn. Calls onDelta(text) and onTool(name); resolves with the 'done' payload.
export async function chat(key, text, mode, {onDelta, onTool} = {}) {
  const r = await fetch(`/api/pals/${key}/chat`, {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json'}, body: JSON.stringify({text, mode})});
  if (!r.ok || !(r.headers.get('content-type') || '').includes('text/event-stream')) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.error || r.statusText), {status: r.status});
  }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', done = null;
  for (;;) {
    const {value, done: end} = await reader.read();
    if (end) break;
    buf += dec.decode(value, {stream: true});
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = (block.match(/^event: (.*)$/m) || [])[1];
      const data = JSON.parse((block.match(/^data: (.*)$/m) || [])[1] || 'null');
      if (ev === 'delta') onDelta && onDelta(data.text);
      else if (ev === 'tool') onTool && onTool(data.name);
      else if (ev === 'done') done = data;
      else if (ev === 'error') throw new Error(data.error || 'server error');
    }
  }
  if (!done) throw new Error('connection closed');
  return done;
}
