// Un solo progetto, due app: APP_VARIANT=master oppure APP_VARIANT=client.
const variant = process.env.APP_VARIANT === 'client' ? 'client' : 'master';
const isClient = variant === 'client';

module.exports = () => ({
  name: isClient ? 'Aeronav Team Client' : 'Aeronav Team Master',
  slug: 'aeronav-team-' + variant,
  version: '1.0.0',
  orientation: 'portrait',
  backgroundColor: '#090e17',
  scheme: isClient ? 'aeronavteam' : undefined, // il client si apre dai link aeronavteam://join?...
  android: {
    package: 'it.aeronav.team.' + variant,
    versionCode: 1,
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
      'WAKE_LOCK',
    ],
  },
  plugins: [
    [
      'expo-location',
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        locationAlwaysAndWhenInUsePermission: 'Aeronav Team condivide la tua posizione con il gruppo anche a schermo spento.',
      },
    ],
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
  ],
  extra: { variant },
});
