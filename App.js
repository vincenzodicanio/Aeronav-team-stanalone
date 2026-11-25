import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AppState, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { TASK } from './task';
import TeamMap from './TeamMap';
import {
  NICK_RE, api, createGroup, fmtCode, inviteLinks, joinGroup, leaveGroup, loadRoster, loadState,
  normServer, parseInvite, resetRoster, saveRoster, saveState,
} from './team';

// Stesso codice, due app: master (crea il gruppo e invita) e client (entra dal link d'invito).
const IS_CLIENT = process.env.EXPO_PUBLIC_APP_VARIANT === 'client';

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
  const [pasted, setPasted] = useState('');
  const [invite, setInvite] = useState(null); // client: { code, server } ricevuto dal link
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sharing, setSharing] = useState(false);
  const [roster, setRoster] = useState({});
  const [tab, setTab] = useState('lista');
  const [, setTick] = useState(0);
  const stRef = useRef({});
  const urlRef = useRef(() => {});

  const refreshSharing = useCallback(async () => {
    try { setSharing(await Location.hasStartedLocationUpdatesAsync(TASK)); } catch (e) { setSharing(false); }
  }, []);

  urlRef.current = handleUrl;

  useEffect(() => {
    (async () => {
      const saved = await loadState();
      setSt(saved); stRef.current = saved;
      setServer(saved.server || ''); setNick(saved.nick || '');
      await refreshSharing();
      if (IS_CLIENT) {
        try { const u = await Linking.getInitialURL(); if (u) urlRef.current(u); } catch (e) { /* ignora */ }
      }
    })();
    const sub = AppState.addEventListener('change', (a) => { if (a === 'active') refreshSharing(); });
    const linkSub = IS_CLIENT ? Linking.addEventListener('url', ({ url }) => urlRef.current(url)) : null;
    const iv = setInterval(async () => {
      const r = await loadRoster();
      setRoster(r);
      setTick((n) => n + 1);
      if (r.lost && stRef.current.code) {
        const saved = await loadState();
        setSt(saved); stRef.current = saved;
        setSharing(false);
        setMsg(IS_CLIENT
          ? "Il gruppo non esiste piu' o sei stato rimosso. Apri un nuovo link di invito."
          : "Il gruppo non esiste piu' o sei stato rimosso. Crea un nuovo gruppo.");
        await saveRoster({ lost: false });
      }
    }, 2000);
    return () => { sub.remove(); if (linkSub) linkSub.remove(); clearInterval(iv); };
  }, [refreshSharing]);

  const fail = (e) => {
    if (e && e.status) { setMsg(e.message); return; }
    setMsg(IS_CLIENT
      ? 'Impossibile contattare il gruppo: controlla la connessione dati.'
      : "Server non raggiungibile: controlla l'indirizzo e la connessione dati.");
  };

  function checkNick() {
    const n = nick.trim().replace(/\s+/g, ' ');
    if (!NICK_RE.test(n)) { setMsg('Nickname non valido: 2-16 caratteri tra lettere, numeri, spazio . _ -'); return null; }
    return n;
  }

  async function afterEnter(g) {
    await resetRoster();
    await saveState(g);
    setSt(g); stRef.current = g; setRoster({});
    setMsg('');
    await startSharing(g);
  }

  // ----- master: crea il gruppo -----
  async function onCreate() {
    const srv = normServer(server);
    if (!srv) { setMsg("Imposta l'indirizzo del server (deve iniziare con https://)."); return; }
    const n = checkNick(); if (!n) return;
    setBusy(true); setMsg('');
    try { await afterEnter(await createGroup(srv, n, groupName.trim())); } catch (e) { fail(e); }
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

  async function onInvite() {
    const l = inviteLinks(st.server, st.code);
    const text = 'Unisciti al gruppo "' + (st.groupName || '') + '" su Aeronav Team.\n'
      + "Apri il link da questo telefono, con l'app Aeronav Team Client installata:\n" + l.web
      + '\n\nSe non si apre:\n' + l.app;
    try { await Share.share({ message: text }); } catch (e) { /* annullato */ }
  }

  // ----- client: entra dal link d'invito -----
  function handleUrl(url) {
    const inv = parseInvite(url);
    if (inv.code.length < 4 || !inv.server) return;
    const cur = stRef.current;
    if (cur.code) {
      if (cur.code === inv.code && cur.server === inv.server) return; // gia' in questo gruppo
      Alert.alert('Nuovo invito', 'Sei gia\' in un gruppo. Vuoi lasciarlo ed entrare in quello nuovo?', [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Lascia ed entra', onPress: async () => { await onLeave(); setInvite(inv); } },
      ]);
    } else {
      setInvite(inv); setMsg('');
    }
  }

  function onUseLink() {
    const inv = parseInvite(pasted);
    if (inv.code.length >= 4 && inv.server) { setInvite(inv); setMsg(''); } else { setMsg('Link di invito non valido.'); }
  }

  async function onJoinInvite() {
    if (!invite) return;
    const n = checkNick(); if (!n) return;
    setBusy(true); setMsg('');
    try {
      const g = await joinGroup(invite.server, invite.code, n);
      setInvite(null);
      await afterEnter(g);
    } catch (e) { fail(e); }
    setBusy(false);
  }

  // ----- condivisione posizione -----
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
    setSt(g); stRef.current = g; setRoster({}); setPasted(''); setTab('lista');
    setBusy(false);
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
        <Text style={s.title}>{IS_CLIENT ? 'AERONAV TEAM' : 'AERONAV TEAM · MASTER'}</Text>

        {!inGroup && !IS_CLIENT && (
          <View>
            <Text style={s.label}>SERVER AERONAV</Text>
            <TextInput style={s.input} value={server} onChangeText={setServer} placeholder="https://aeronav.tuodominio.it"
              placeholderTextColor="#64748b" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Btn label="TEST CONNESSIONE" onPress={onTest} disabled={busy} />

            <Text style={s.label}>IL TUO NICKNAME</Text>
            <TextInput style={s.input} value={nick} onChangeText={setNick} placeholder="Marco" placeholderTextColor="#64748b" maxLength={16} />

            <Text style={s.label}>NOME DEL GRUPPO</Text>
            <TextInput style={s.input} value={groupName} onChangeText={setGroupName} placeholder="es. DZ Sabato" placeholderTextColor="#64748b" />
            <Btn label="CREA GRUPPO" kind="go" onPress={onCreate} disabled={busy} />
          </View>
        )}

        {!inGroup && IS_CLIENT && !invite && (
          <View>
            <Text style={s.sub}>Per entrare in un gruppo apri il link di invito che hai ricevuto dal responsabile.</Text>
            <Text style={s.label}>OPPURE INCOLLA L'INVITO</Text>
            <TextInput style={s.input} value={pasted} onChangeText={setPasted} placeholder="Link di invito" placeholderTextColor="#64748b"
              autoCapitalize="none" autoCorrect={false} />
            <Btn label="USA INVITO" onPress={onUseLink} disabled={busy} />
          </View>
        )}

        {!inGroup && IS_CLIENT && !!invite && (
          <View>
            <Text style={s.label}>INVITO AL GRUPPO</Text>
            <Text style={s.code}>{fmtCode(invite.code)}</Text>
            <Text style={s.label}>IL TUO NICKNAME</Text>
            <TextInput style={s.input} value={nick} onChangeText={setNick} placeholder="Marco" placeholderTextColor="#64748b" maxLength={16} />
            <Btn label="ENTRA E CONDIVIDI" kind="go" onPress={onJoinInvite} disabled={busy} />
            <Btn label="ANNULLA" onPress={() => { setInvite(null); setMsg(''); }} disabled={busy} />
          </View>
        )}

        {inGroup && (
          <View>
            <Text style={s.group}>{st.groupName || 'Gruppo'}</Text>
            <Text style={s.code}>{fmtCode(st.code)}</Text>
            <Text style={s.sub}>{IS_CLIENT ? st.nick : st.nick + ' · ' + st.server}</Text>

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

            {!IS_CLIENT && <Btn label="INVIA INVITO AL CLIENT" kind="go" onPress={onInvite} />}
            {sharing
              ? <Btn label="FERMA CONDIVISIONE" kind="stop" onPress={stopSharing} />
              : <Btn label="AVVIA CONDIVISIONE" kind="go" onPress={() => startSharing()} />}
            <Btn label="MAPPA" onPress={() => setTab('mappa')} />

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
