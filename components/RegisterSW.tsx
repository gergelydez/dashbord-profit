'use client';
/**
 * components/RegisterSW.tsx
 * Registers the service worker so the browser recognizes the app as an
 * installable PWA (required for Android to use the manifest icon at full
 * size on the home screen instead of a generic shortcut icon).
 */
import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return null;
}
