import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AppState, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { TASK } from './task';
import TeamMap from './TeamMap';
import {
  NICK_RE, api, cleanCode, createGroup, fmtCode, joinGroup, leaveGroup, loadRoster, loadState,
  normServer, parseInvite, resetRoster, saveRoster, saveState,
} from './team';

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;

function Btn({ label, onPress, kind, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, kind === 'go' && s.btnGo, kind === 'stop' && s.btnStop, (pressed || disabled) && { opacity: 0.55 }]}
    >
      <Text style={s.btnTxt}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [st, setSt] = useState({});
  const [server, setServer] = useState('');
  const [nick, setNick] = useState('');
  const [groupName, setGroupName] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sharing, setSharing] = useState(false);
  const [roster, setRoster] = useState({});
  const [tab, setTab] = useState('lista');
  const [, setTick] = useState(0);
  const stRef = useRef({});

  const refreshSharing = useCallback(async () => {
    try { setSharing(await Location.hasStartedLocationUpdatesAsync(TASK)); } catch (e) { setSharing(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await loadState();
      setSt(saved); stRef.current = saved;
      setServer(saved.server || ''); setNick(saved.nick || '');
      await refreshSharing();
    })();
    const sub = AppState.addEventListener('change', (a) => { if (a === 'active') refreshSharing(); });
    const iv = setInterval(async () => {
      const r = await loadRoster();
      setRoster(r);
      setTick((n) => n + 1);
      if (r.lost && stRef.current.code) {
        const saved = await loadState();
        setSt(saved); stRef.current = saved;
        setSharing(false);
        setMsg("Il gruppo non esiste piu' o sei stato rimosso. Crea un nuovo gruppo o rientra con il codice.");
        await saveRoster({ lost: false });
      }
    }, 2000);
    return () => { sub.remove(); clearInterval(iv); };
  }, [refreshSharing]);

  const fail = (e) => {
    setMsg(e && e.status ? e.message : "Server non raggiungibile: controlla l'indirizzo e la connessione dati.");
  };

  function readCommon() {
    const srv = normServer(server);
    if (!srv) { setMsg("Imposta l'indirizzo del server (deve iniziare con https://)."); return null; }
    const n = nick.trim().replace(/\s+/g, ' ');
    if (!NICK_RE.test(n)) { setMsg('Nickname non valido: 2-16 caratteri tra lettere, numeri, spazio . _ -'); return null; }
    return { srv, n };
  }

  async function afterEnter(g) {
    await resetRoster();
    await saveState(g);
    setSt(g); stRef.current = g; setRoster({});
    setMsg('');
    await startSharing(g);
  }

  async function onCreate() {
    const c = readCommon(); if (!c) return;
    setBusy(true); setMsg('');
    try { await afterEnter(await createGroup(c.srv, c.n, groupName.trim())); } catch (e) { fail(e); }
    setBusy(false);
  }

  async function onJoin() {
    const c = readCommon(); if (!c) return;
    const inv = parseInvite(codeInput);
    if (inv.code.length < 4) { setMsg('Inserisci il codice del gruppo o il link di invito.'); return; }
    const srv = inv.server && inv.server !== c.srv ? inv.server : c.srv;
    if (srv !== c.srv) setServer(srv);
    setBusy(true); setMsg('');
    try { await afterEnter(await joinGroup(srv, inv.code, c.n)); } catch (e) { fail(e); }
    setBusy(false);
  }

  async function onTest() {
    const srv = normServer(server);
    if (!srv) { setMsg('Indirizzo non valido: deve iniziare con https://'); return; }
    setBusy(true); setMsg('');
    try {
      const d = await api(srv, 'GET', '/health');
      setMsg(d.status === 'ok' ? 'Server raggiungibile.' : 'Il server ha risposto in modo inatteso.');
    } catch (e) { setMsg('Server non raggiungibile: controlla indirizzo, tunnel/reverse proxy e connessione.'); }
    setBusy(false);
  }

  async function startSharing(g) {
    const cur = g || stRef.current;
    if (!cur.code) return;
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') { setMsg('Serve il permesso di posizione.'); return; }
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        Alert.alert(
          'Permesso "Sempre"',
          'Per condividere a schermo spento imposta il permesso Posizione su "Consenti sempre" nelle impostazioni dell\'app.',
          [{ text: 'Annulla' }, { text: 'Impostazioni', onPress: () => Linking.openSettings() }],
        );
        return;
      }
      if (!(await Location.hasStartedLocationUpdatesAsync(TASK))) {
        await Location.startLocationUpdatesAsync(TASK, {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 5000,        // ogni 5 s, come Aeronav
          distanceInterval: 0,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Aeronav Team',
            notificationBody: 'Condivisione posizione attiva',
            notificationColor: '#22c55e',
          },
        });
      }
      setMsg('');
    } catch (e) { setMsg('Impossibile avviare la condivisione: ' + e.message); }
    refreshSharing();
  }

  async function stopSharing() {
    try { if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK); } catch (e) { /* ignora */ }
    refreshSharing();
  }

  async function onLeave() {
    setBusy(true);
    await stopSharing();
    await leaveGroup(stRef.current);
    const g = { server: stRef.current.server, nick: stRef.current.nick };
    await saveState(g); await resetRoster();
    setSt(g); stRef.current = g; setRoster({}); setCodeInput(''); setTab('lista');
    setBusy(false);
  }

  async function onInvite() {
    const text = 'Unisciti al gruppo "' + st.groupName + '" su AERONAV HAHO.\nCodice: ' + fmtCode(st.code) + '\nServer: ' + st.server;
    try { await Share.share({ message: text }); } catch (e) { /* annullato */ }
  }

  function openBattery() {
    Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings());
  }

  const inGroup = !!st.code;
  const members = (roster.members || []).slice().sort((a, b) => (b.you ? 1 : 0) - (a.you ? 1 : 0));
  const sentAgo = roster.sentAt ? Math.max(0, Math.round((Date.now() - roster.sentAt) / 1000)) : null;

  if (inGroup && tab === 'mappa') {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <View style={s.mapBar}>
          <View style={{ flex: 1 }}>
            <Text style={s.mapTitle}>{st.groupName || 'Gruppo'} · {fmtCode(st.code)}</Text>
            <Text style={[s.sub, { color: sharing ? '#22c55e' : '#ef4444' }]}>
              {sharing ? 'condivisione attiva' : 'condivisione ferma'}{sentAgo != null && sharing ? ' · ' + sentAgo + ' s' : ''}
            </Text>
          </View>
          <Pressable style={s.mapBtn} onPress={() => setTab('lista')}><Text style={s.btnTxt}>LISTA</Text></Pressable>
        </View>
        <TeamMap members={roster.members || []} version={roster.sentAt || 0} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>AERONAV TEAM</Text>

        {!inGroup && (
          <View>
            <Text style={s.label}>SERVER (lo stesso di Aeronav)</Text>
            <TextInput style={s.input} value={server} onChangeText={setServer} placeholder="https://aeronav.tuodominio.it"
              placeholderTextColor="#64748b" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Btn label="TEST CONNESSIONE" onPress={onTest} disabled={busy} />

            <Text style={s.label}>NICKNAME</Text>
            <TextInput style={s.input} value={nick} onChangeText={setNick} placeholder="Marco" placeholderTextColor="#64748b" maxLength={16} />

            <Text style={s.label}>ENTRA IN UN GRUPPO (codice o link)</Text>
            <TextInput style={s.input} value={codeInput} onChangeText={setCodeInput} placeholder="TG99-73E2"
              placeholderTextColor="#64748b" autoCapitalize="characters" autoCorrect={false} />
            <Btn label="ENTRA E CONDIVIDI" kind="go" onPress={onJoin} disabled={busy} />

            <Text style={s.label}>OPPURE CREA UN GRUPPO</Text>
            <TextInput style={s.input} value={groupName} onChangeText={setGroupName} placeholder="Nome gruppo (es. DZ Sabato)" placeholderTextColor="#64748b" />
            <Btn label="CREA GRUPPO" onPress={onCreate} disabled={busy} />
          </View>
        )}

        {inGroup && (
          <View>
            <Text style={s.group}>{st.groupName || 'Gruppo'}</Text>
            <Text style={s.code}>{fmtCode(st.code)}</Text>
            <Text style={s.sub}>{st.nick} · {st.server}</Text>

            <View style={[s.status, { borderColor: sharing ? '#22c55e' : '#ef4444' }]}>
              <Text style={[s.statusTxt, { color: sharing ? '#22c55e' : '#ef4444' }]}>
                {sharing ? 'CONDIVISIONE ATTIVA' : 'CONDIVISIONE FERMA'}
              </Text>
              <Text style={s.sub}>
                {sharing
                  ? (roster.online === false ? 'Rete assente, riprovo… ' : '') + (sentAgo != null ? 'ultimo invio ' + sentAgo + ' s fa' : 'in attesa del GPS…')
                  : 'Le altre posizioni non si aggiornano'}
              </Text>
            </View>

            {sharing
              ? <Btn label="FERMA CONDIVISIONE" kind="stop" onPress={stopSharing} />
              : <Btn label="AVVIA CONDIVISIONE" kind="go" onPress={() => startSharing()} />}
            <Btn label="MAPPA" onPress={() => setTab('mappa')} />
            <Btn label="INVITA" onPress={onInvite} />

            <Text style={s.label}>MEMBRI ({members.length})</Text>
            {members.length === 0 && <Text style={s.sub}>Nessun dato ancora.</Text>}
            {members.map((m) => (
              <View key={m.id} style={s.member}>
                <Text style={s.mNick}>{m.nick}{m.you ? ' (tu)' : ''}</Text>
                <Text style={s.mInfo}>
                  {m.lat == null ? 'senza posizione'
                    : [Number.isFinite(m.alt) ? Math.round(m.alt * M_TO_FT) + ' ft' : null,
                      Number.isFinite(m.gs) ? Math.round(m.gs * MS_TO_KT) + ' kt' : null,
                      m.age != null ? m.age + ' s fa' : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))}

            <Btn label="BATTERIA: NON OTTIMIZZARE" onPress={openBattery} />
            <Btn label="ESCI DAL GRUPPO" onPress={onLeave} disabled={busy} />
          </View>
        )}

        {!!msg && <Text style={s.msg}>{msg}</Text>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#090e17' },
  pad: { padding: 18, paddingTop: 54, paddingBottom: 40 },
  title: { color: '#f59e0b', fontSize: 20, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
  label: { color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 18, marginBottom: 6 },
  input: { backgroundColor: '#111827', color: '#e2e8f0', borderColor: '#1e293b', borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 8 },
  btn: { backgroundColor: '#1e293b', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  btnGo: { backgroundColor: '#15803d' },
  btnStop: { backgroundColor: '#b91c1c' },
  btnTxt: { color: '#f8fafc', fontWeight: '800', letterSpacing: 1 },
  group: { color: '#e2e8f0', fontSize: 18, fontWeight: '700' },
  code: { color: '#22c55e', fontSize: 34, fontWeight: '800', letterSpacing: 3, marginVertical: 4 },
  sub: { color: '#94a3b8', fontSize: 12 },
  status: { borderWidth: 1, borderRadius: 8, padding: 12, marginVertical: 12 },
  statusTxt: { fontWeight: '800', letterSpacing: 1, marginBottom: 2 },
  member: { backgroundColor: '#111827', borderRadius: 8, padding: 10, marginBottom: 6 },
  mNick: { color: '#e2e8f0', fontWeight: '700', fontSize: 15 },
  mInfo: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  msg: { color: '#f59e0b', marginTop: 16, fontSize: 13 },
  mapBar: { flexDirection: 'row', alignItems: 'center', paddingTop: 48, paddingBottom: 8, paddingHorizontal: 14, backgroundColor: '#090e17' },
  mapTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 15 },
  mapBtn: { backgroundColor: '#1e293b', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
});
