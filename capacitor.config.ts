import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tripjam.app',
  appName: 'TripJam',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
