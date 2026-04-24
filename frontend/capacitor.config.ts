import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.portfoliotracker.app',
  appName: 'Portfolio Tracker',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  ios: {
    scheme: 'Portfolio Tracker',
    contentInset: 'automatic'
  }
};

export default config;
