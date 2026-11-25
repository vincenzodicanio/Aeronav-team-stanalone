// Protocollo Team Live: identico a team-client.js di Aeronav (stesso server, stessi endpoint).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CLIENT_SCHEME, INVITE_PAGE } from './config';

const KEY = 'aeronav.team.app.v1';      // { server, nick, code, uid, token, groupName }
const RKEY = 'aeronav.team.roster.v1';  // { online, members, sentAt, error, lost }

export const NICK_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ_ .\-]{2,16}$/;

export function cleanCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
export function fmtCode(c) { c = String(c || ''); return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c; }
export function normServer(v) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(s) ? s : null;
}

function qparam(t, names) {
  for (const n of names) {
    const m = t.match(new RegExp('[?&]' + n + '=([^&#\\s]+)', 'i'));
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
  }
  return null;
}

// Accetta il link d'invito (https://.../join.html?c=CODICE&s=SERVER oppure aeronavteam://join?c=..&s=..,
// e anche il vecchio formato di Aeronav ?join=..&srv=..) oppure il solo codice.
export function parseInvite(text) {
  const t = String(text || '').trim();
  const c = qparam(t, ['c', 'code', 'join']);
  if (c != null) return { code: cleanCode(c), server: normServer(qparam(t, ['s', 'srv', 'server'])) };
  return { code: cleanCode(t), server: null };
}

export function inviteLinks(server, code) {
  const q = 'c=' + encodeURIComponent(code) + '&s=' + encodeURIComponent(server);
  return { web: INVITE_PAGE + '?' + q, app: CLIENT_SCHEME + '://join?' + q };
}

export async function loadState() {
  try { return JSON.parse(await AsyncStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
export async function saveState(st) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignora */ }
}
export async function loadRoster() {
  try { return JSON.parse(await AsyncStorage.getItem(RKEY)) || {}; } catch (e) { return {}; }
}
export async function saveRoster(patch) {
  const prev = await loadRoster();
  try { await AsyncStorage.setItem(RKEY, JSON.stringify(Object.assign({}, prev, patch))); } catch (e) { /* ignora */ }
}
export async function resetRoster() {
  try { await AsyncStorage.removeItem(RKEY); } catch (e) { /* ignora */ }
}

export async function api(server, method, path, body, token, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 8000);
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(server + path, {
      method, headers, signal: ctl.signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data.error || 'HTTP ' + r.status);
      e.status = r.status;
      throw e;
    }
    return data;
  } finally { clearTimeout(timer); }
}

function adopt(server, d) {
  return { server, nick: d.nickname, code: d.group_code, uid: d.user_id, token: d.token, groupName: d.group_name };
}

export async function createGroup(server, nickname, groupName) {
  return adopt(server, await api(server, 'POST', '/groups', { nickname, name: groupName || '' }));
}
export async function joinGroup(server, code, nickname) {
  return adopt(server, await api(server, 'POST', '/groups/' + cleanCode(code) + '/join', { nickname }));
}
export async function leaveGroup(st) {
  try { await api(st.server, 'DELETE', '/groups/' + st.code + '/members/' + st.uid, undefined, st.token, 5000); } catch (e) { /* offline */ }
}
export async function syncOnce(st, body) {
  return api(st.server, 'POST', '/groups/' + st.code + '/members/' + st.uid + '/sync', body, st.token, 4500);
}
