// Registrazione Service Worker per funzionamento PWA Offline
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW error:', err));
  });
}

// Stato dell'applicazione
const state = {
  pilotId: 'PILOT-' + Math.random().toString(36).substring(2, 7).toUpperCase(),
  callsign: localStorage.getItem('aeroteam_callsign') || '',
  teamCode: localStorage.getItem('aeroteam_code') || '',
  connected: false,
  autoCenter: true,
  simEnabled: false,
  myPos: {
    lat: 45.4642, // Default Milano se GPS non ancora agganciato
    lon: 9.1900,
    altFt: 0,
    speedKt: 0,
    heading: 0,
    hasFix: false
  },
  members: {} // { pilotId: { callsign, lat, lon, altFt, speedKt, heading, lastSeen } }
};

// Riferimenti DOM
const elCallsign = document.getElementById('callsign-input');
const elTeamCode = document.getElementById('team-code-input');
const btnJoin = document.getElementById('btn-join-team');
const btnCenter = document.getElementById('btn-center');
const btnSim = document.getElementById('btn-sim');
const elMembersList = document.getElementById('members-list');
const elTeamCount = document.getElementById('team-count');
const gpsDot = document.getElementById('gps-status-dot');
const gpsText = document.getElementById('gps-status-text');

elCallsign.value = state.callsign;
elTeamCode.value = state.teamCode;

// 1. Inizializzazione Mappa Leaflet (CartoDB Dark Matter per alta leggibilità in cabina)
const map = L.map('map', {
  zoomControl: false,
  attributionControl: false
}).setView([state.myPos.lat, state.myPos.lon], 11);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 18,
  subdomains: 'abcd'
}).addTo(map);

map.on('dragstart', () => {
  state.autoCenter = false;
});

// Generatore icona aeromobile orientata per heading
function createAircraftIcon(callsign, heading, isSelf = false, altFt = null) {
  const color = isSelf ? '#22c55e' : '#f59e0b';
  const labelClass = isSelf ? 'aircraft-label' : 'aircraft-label mate';
  const altStr = altFt !== null ? ` · ${altFt}ft` : '';

  const html = `
    <div class="aircraft-marker">
      <svg width="32" height="32" viewBox="0 0 24 24" style="transform: rotate(${heading}deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">
        <path fill="${color}" d="M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z"/>
      </svg>
      <div class="${labelClass}">${callsign || 'ME'}${altStr}</div>
    </div>
  `;

  return L.divIcon({
    html,
    className: '',
    iconSize: [60, 50],
    iconAnchor: [30, 16]
  });
}

// Marker personale e layer per i compagni
let selfMarker = L.marker([state.myPos.lat, state.myPos.lon], {
  icon: createAircraftIcon(state.callsign || 'IO', 0, true),
  zIndexOffset: 1000
}).addTo(map);

const teamMarkers = {};

// 2. Screen Wake Lock API (evita spegnimento schermo in volo)
async function enableWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
    } catch (e) {
      console.warn('WakeLock non attivo:', e);
    }
  }
}

// 3. Geolocalizzazione GPS ad alta precisione
function startGPS() {
  if (!('geolocation' in navigator)) {
    gpsDot.className = 'radar-dot error';
    gpsText.textContent = 'GPS non supportato';
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, altitude, speed, heading } = pos.coords;
      state.myPos = {
        lat: latitude,
        lon: longitude,
        altFt: altitude !== null ? Math.round(altitude * 3.28084) : null,
        speedKt: speed !== null ? Math.round(speed * 1.94384) : 0,
        heading: heading !== null && !isNaN(heading) ? Math.round(heading) : state.myPos.heading,
        hasFix: true
      };

      gpsDot.className = 'radar-dot active';
      gpsText.textContent = `GPS OK (±${Math.round(pos.coords.accuracy)}m)`;

      updateSelfUI();
      broadcastPosition();
    },
    (err) => {
      gpsDot.className = 'radar-dot error';
      gpsText.textContent = 'Segnale GPS assente';
      console.warn('Errore GPS:', err.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 8000
    }
  );
}

function updateSelfUI() {
  const { lat, lon, altFt, speedKt, heading } = state.myPos;
  document.getElementById('val-speed').textContent = speedKt;
  document.getElementById('val-alt').textContent = altFt !== null ? altFt : '---';
  document.getElementById('val-hdg').textContent = String(heading).padStart(3, '0') + '°';
  document.getElementById('val-coords').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  selfMarker.setLatLng([lat, lon]);
  selfMarker.setIcon(createAircraftIcon(state.callsign || 'IO', heading, true, altFt));

  if (state.autoCenter) {
    map.setView([lat, lon], map.getZoom(), { animate: true });
  }
}

// 4. Canale di sincronizzazione Team (BroadcastChannel locale + predisposizione WebSocket/Backend)
let channel = null;

function connectTeam() {
  const code = elTeamCode.value.trim().toUpperCase();
  const callsign = elCallsign.value.trim().toUpperCase() || 'PILOTA';

  if (!code) {
    alert('Inserisci un Codice Team (es. VOLO1)');
    return;
  }

  state.teamCode = code;
  state.callsign = callsign;
  localStorage.setItem('aeroteam_code', code);
  localStorage.setItem('aeroteam_callsign', callsign);

  if (channel) channel.close();

  // BroadcastChannel sincronizza istantaneamente tra tab/finestre sullo stesso dispositivo.
  // Per sincronizzare dispositivi remoti diversi, collegare qui un WebSocket / Supabase / Firebase.
  channel = new BroadcastChannel(`aeroteam_${code}`);
  channel.onmessage = (event) => {
    const data = event.data;
    if (data && data.pilotId !== state.pilotId) {
      receiveMemberTelemetry(data);
    }
  };

  state.connected = true;
  btnJoin.textContent = 'ESCI';
  btnJoin.classList.add('connected');
  elCallsign.disabled = true;
  elTeamCode.disabled = true;

  enableWakeLock();
  updateSelfUI();
  broadcastPosition();
}

function disconnectTeam() {
  if (channel) {
    channel.close();
    channel = null;
  }
  state.connected = false;
  state.members = {};
  Object.values(teamMarkers).forEach(m => map.removeLayer(m));
  for (const key in teamMarkers) delete teamMarkers[key];

  btnJoin.textContent = 'ENTRA';
  btnJoin.classList.remove('connected');
  elCallsign.disabled = false;
  elTeamCode.disabled = false;
  renderMembersList();
}

btnJoin.addEventListener('click', () => {
  if (state.connected) {
    disconnectTeam();
  } else {
    connectTeam();
  }
});

function broadcastPosition() {
  if (!state.connected || !channel) return;
  channel.postMessage({
    pilotId: state.pilotId,
    callsign: state.callsign,
    lat: state.myPos.lat,
    lon: state.myPos.lon,
    altFt: state.myPos.altFt,
    speedKt: state.myPos.speedKt,
    heading: state.myPos.heading,
    timestamp: Date.now()
  });
}

function receiveMemberTelemetry(data) {
  state.members[data.pilotId] = {
    ...data,
    lastSeen: Date.now()
  };

  if (!teamMarkers[data.pilotId]) {
    teamMarkers[data.pilotId] = L.marker([data.lat, data.lon], {
      icon: createAircraftIcon(data.callsign, data.heading, false, data.altFt)
    }).addTo(map);
  } else {
    teamMarkers[data.pilotId].setLatLng([data.lat, data.lon]);
    teamMarkers[data.pilotId].setIcon(createAircraftIcon(data.callsign, data.heading, false, data.altFt));
  }

  renderMembersList();
}

// Calcolo distanza in Miglia Nautiche (NM) tra due coordinate
function calcDistanceNM(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Raggio terrestre in NM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
}

function renderMembersList() {
  const ids = Object.keys(state.members);
  elTeamCount.textContent = ids.length;

  if (ids.length === 0) {
    elMembersList.innerHTML = `<li class="empty-msg">${
      state.connected ? 'In attesa di altri membri nel team...' : 'Inserisci un Codice Team per condividere la posizione.'
    }</li>`;
    return;
  }

  elMembersList.innerHTML = '';
  ids.forEach(id => {
    const m = state.members[id];
    const dist = calcDistanceNM(state.myPos.lat, state.myPos.lon, m.lat, m.lon);
    const ageSec = Math.round((Date.now() - m.lastSeen) / 1000);

    const li = document.createElement('li');
    li.className = 'member-item';
    li.innerHTML = `
      <div>
        <div class="member-callsign">${m.callsign}</div>
        <div class="member-meta">${m.altFt ?? '---'} ft · ${m.speedKt} kt · ${ageSec}s fa</div>
      </div>
      <div style="text-align:right">
        <strong style="color:#f59e0b">${dist} NM</strong>
      </div>
    `;
    li.onclick = () => {
      state.autoCenter = false;
      map.setView([m.lat, m.lon], 13, { animate: true });
    };
    elMembersList.appendChild(li);
  });
}

// Centra mappa su posizione personale
btnCenter.addEventListener('click', () => {
  state.autoCenter = true;
  map.setView([state.myPos.lat, state.myPos.lon], 12, { animate: true });
});

// 5. Simulatore traffico Team (per testare l'interfaccia a terra senza altri piloti)
let simInterval = null;
let simAngle = 0;

btnSim.addEventListener('click', () => {
  state.simEnabled = !state.simEnabled;
  btnSim.textContent = state.simEnabled ? 'SIM: ON' : 'SIM: OFF';
  btnSim.classList.toggle('on', state.simEnabled);

  if (state.simEnabled) {
    simInterval = setInterval(() => {
      simAngle = (simAngle + 3) % 360;
      const rad = simAngle * Math.PI / 180;
      const offsetLat = Math.cos(rad) * 0.03;
      const offsetLon = Math.sin(rad) * 0.04;

      receiveMemberTelemetry({
        pilotId: 'SIM-WINGMAN-1',
        callsign: 'I-WING1',
        lat: state.myPos.lat + offsetLat,
        lon: state.myPos.lon + offsetLon,
        altFt: 2500,
        speedKt: 95,
        heading: (simAngle + 90) % 360
      });
    }, 1500);
  } else {
    clearInterval(simInterval);
    delete state.members['SIM-WINGMAN-1'];
    if (teamMarkers['SIM-WINGMAN-1']) {
      map.removeLayer(teamMarkers['SIM-WINGMAN-1']);
      delete teamMarkers['SIM-WINGMAN-1'];
    }
    renderMembersList();
  }
});

// Aggiornamento periodico età pacchetti e invio heartbeat
setInterval(() => {
  if (state.connected) broadcastPosition();
  if (Object.keys(state.members).length > 0) renderMembersList();
}, 2000);

// Avvio GPS
startGPS();
