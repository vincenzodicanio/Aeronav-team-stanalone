# AeroTeam PWA - Localizzazione e Mappa Team

PWA standalone leggera focalizzata esclusivamente su:
- Rilevamento posizione GPS ad alta precisione (`watchPosition`), quota (ft), velocità al suolo (kt) e prua (HDG).
- Visualizzazione su mappa scura ad alto contrasto con icone aeromobile orientate dinamicamente.
- Stanza **Team** tramite codice condiviso, calcolo distanza relativa in Miglia Nautiche (NM) e **Screen Wake Lock**.
- Modalità **SIM: ON/OFF** integrata per simulare un gregario in volo e testare l'interfaccia a terra.

## Come avviarla
1. Estrai lo ZIP in una cartella.
2. Servila tramite un server HTTPS o locale (es. `npx serve .` oppure `python3 -m http.server 8080` su `localhost` — necessario per abilitare GPS e Service Worker).
3. Per sincronizzare dispositivi remoti via internet, sostituisci `BroadcastChannel` in `app.js` con un canale WebSocket (es. Supabase Realtime o Firebase).
