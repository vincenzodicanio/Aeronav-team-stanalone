# Aeronav Team (APK standalone)

App Android che condivide la posizione nel Team Live di Aeronav HAHO, anche a schermo spento
(servizio in primo piano di expo-location, invio ogni 5 s). Usa lo stesso server e gli stessi endpoint
di `team-client.js`: nel navigatore di Aeronav il telefono compare come un normale membro del gruppo.

## Come si usa
1. Apri l'app, scrivi l'indirizzo del server (quello salvato in Aeronav) e il nickname.
2. Entra con il codice/link del gruppo oppure crea un gruppo nuovo (poi in Aeronav entra con lo stesso codice).
3. Concedi la posizione su "Consenti sempre" e premi di non ottimizzare la batteria.
4. Pulsante MAPPA: mappa (stradale/satellite) con tutti i membri; "CENTRA" riquadra il gruppo. Serve la rete dati per i tasselli.
5. Usa un solo dispositivo per nickname: se Aeronav (PWA) e l'app sono entrambe nel gruppo compaiono come due membri.

## Build dell'APK
- **GitHub Actions** (nessun account Expo): carica il progetto su GitHub -> Actions -> "Build APK" -> Run workflow;
  l'APK e' negli Artifacts (`aeronav-team-apk`).
- **EAS**: `npx eas-cli build -p android --profile apk`.
- Se Expo segnala versioni non allineate: `npx expo install --fix`.
