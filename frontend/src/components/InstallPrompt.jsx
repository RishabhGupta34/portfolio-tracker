import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from './ui/Button';

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Check if running on iOS
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    
    // Check if running on Android Chrome
    const isAndroid = /Android/.test(navigator.userAgent);

    // Show prompt for Android Chrome
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show prompt after 3 seconds
      setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
    };

    // Show iOS install instructions immediately
    if (isIOS) {
      setShowPrompt(true);
    } else if (isAndroid) {
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Android Chrome install
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response: ${outcome}`);
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Don't show again for this session
    sessionStorage.setItem('installPromptDismissed', 'true');
  };

  // Don't show if already installed or dismissed
  if (isInstalled || !showPrompt || sessionStorage.getItem('installPromptDismissed')) {
    return null;
  }

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50">
      <div className="bg-background border border-border rounded-lg shadow-lg p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="font-semibold text-sm mb-1">Install Portfolio Tracker</h3>
            {isIOS ? (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>1. Tap the <strong>Share</strong> button <span className="text-lg">⎋</span></p>
                <p>2. Scroll down and tap <strong>"Add to Home Screen"</strong></p>
                <p>3. Tap <strong>"Add"</strong> to install</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Install this app on your device for a better experience and offline access.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isIOS && (
              <Button
                onClick={handleInstallClick}
                size="sm"
                className="text-xs"
              >
                <Download className="w-3 h-3 mr-1" />
                Install
              </Button>
            )}
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


