// Task in background: parte dal servizio in primo piano di expo-location,
// quindi continua anche con lo schermo spento.
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { loadState, saveState, saveRoster, syncOnce } from './team';

export const TASK = 'aeronav-team-location';
const FIX_MAX_AGE_MS = 15000; // come team-client.js: un fix piu' vecchio non viene inviato

let busy = false;

TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error || !data || busy) return;
  const locs = data.locations || [];
  if (!locs.length) return;
  busy = true;
  try {
    const st = await loadState();
    if (!st.code || !st.uid || !st.token || !st.server) return;

    const loc = locs[locs.length - 1];
    const c = loc.coords || {};
    const body = {};
    if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude) && Date.now() - loc.timestamp <= FIX_MAX_AGE_MS) {
      body.lat = c.latitude;
      body.lon = c.longitude;
      if (Number.isFinite(c.altitude)) body.alt = c.altitude;
      if (Number.isFinite(c.speed) && c.speed >= 0) body.gs = c.speed;        // m/s, come Aeronav
      if (Number.isFinite(c.heading) && c.heading >= 0) body.hdg = c.heading;
      if (Number.isFinite(c.accuracy)) body.acc = c.accuracy;
    }

    try {
      const d = await syncOnce(st, body);
      await saveRoster({ online: true, members: d.members || [], sentAt: Date.now(), error: null });
    } catch (e) {
      if (e.status === 401 || e.status === 404) {
        // gruppo scaduto o membro rimosso dal server
        await saveState({ server: st.server, nick: st.nick });
        await saveRoster({ lost: true, online: true, members: [] });
        try { await Location.stopLocationUpdatesAsync(TASK); } catch (e2) { /* ignora */ }
      } else {
        await saveRoster({ online: false, error: e.message }); // rete assente: riprova al giro dopo
      }
    }
  } finally { busy = false; }
});
