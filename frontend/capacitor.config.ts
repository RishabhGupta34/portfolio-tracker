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
  },
  plugins: {
    CapacitorHttp: {
      // Disable the automatic fetch/XHR interceptor — it races on GCD cleanup
      // and crashes with OS_dispatch_mach_msg _setContext: on startup.
      // We call CapacitorHttp.get() explicitly in code only when needed.
      enabled: false
    }
  }
};

export default config;
