'use client';

import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '@/lib/supabase/browser';

// Notification opt-in for the signed-in member. Registers the service worker,
// requests permission, and subscribes this device to Web Push — then lets them
// fire a test notification to confirm it lands.
//
// iOS is the constrained platform and drives most of this UI: push works only
// on iOS 16.4+ AND only once the app is installed to the home screen (never in
// the Safari tab). We detect that and tell the user to install first instead of
// calling requestPermission(), which no-ops in a tab. The whole
// register → requestPermission → subscribe chain runs inside the click handler,
// because iOS rejects a permission prompt that isn't tied to a user gesture.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// applicationServerKey must be a Uint8Array; the VAPID public key is base64url.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = 'idle' | 'working';

export function PushNotifications() {
  const [supported, setSupported] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ua = window.navigator.userAgent;
    const iOS = /iphone|ipad|ipod/i.test(ua)
      || (/Macintosh/.test(ua) && 'ontouchend' in document); // iPadOS masquerades as Mac
    setIsIOS(iOS);
    setStandalone(
      window.matchMedia('(display-mode: standalone)').matches
        || (window.navigator as { standalone?: boolean }).standalone === true,
    );
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    // Reflect whether this device already holds a subscription.
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.pushManager.getSubscription().then((s) => setEnabled(Boolean(s)));
    });
  }, []);

  // Hidden entirely in mock mode or if the server has no VAPID key configured —
  // there's nothing to subscribe against.
  if (!isSupabaseConfigured || !VAPID_PUBLIC_KEY) return null;

  async function enable() {
    setErr(null);
    setMsg(null);
    setStatus('working');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setStatus('idle');
        setErr(perm === 'denied'
          ? 'Notifications are blocked. Enable them for this site in your browser settings.'
          : 'Permission was not granted.');
        return;
      }

      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save subscription.');

      setEnabled(true);
      setMsg('Notifications enabled on this device.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not enable notifications.');
    } finally {
      setStatus('idle');
    }
  }

  async function disable() {
    setErr(null);
    setMsg(null);
    setStatus('working');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEnabled(false);
      setMsg('Notifications turned off for this device.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not turn off notifications.');
    } finally {
      setStatus('idle');
    }
  }

  async function sendTest() {
    setErr(null);
    setMsg(null);
    setStatus('working');
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send test notification.');
      setMsg(`Test sent to ${data.sent} device${data.sent === 1 ? '' : 's'} — check your notifications.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send test notification.');
    } finally {
      setStatus('idle');
    }
  }

  const busy = status === 'working';
  const note = (color: string, text: string) => (
    <p style={{ color, fontSize: 12.5, margin: '10px 0 0' }}>{text}</p>
  );

  return (
    <div className="pkp-card" style={{ padding: 22 }}>
      <h3 className="pkp-h3" style={{ marginBottom: 6 }}>Notifications</h3>
      <p style={{ color: 'var(--ink-500)', fontSize: 13, margin: '0 0 4px', maxWidth: 460 }}>
        Get a push notification on this device for chapter announcements, dues reminders, and new socials.
      </p>

      {/* iOS in a Safari tab: push is impossible until installed to the home screen. */}
      {!supported && isIOS && !standalone && (
        note('var(--ink-600)',
          'On iPhone/iPad, tap the Share button in Safari, choose “Add to Home Screen,” then open the app from your home screen and come back here to enable notifications.')
      )}

      {!supported && !(isIOS && !standalone) && (
        note('var(--ink-600)', 'This browser doesn’t support push notifications.')
      )}

      {supported && permission === 'denied' && (
        note('var(--danger-600, #dc2626)',
          'Notifications are blocked for this site. Enable them in your browser settings, then reload.')
      )}

      {supported && permission !== 'denied' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {!enabled ? (
            <button type="button" onClick={enable} disabled={busy} className="pkp-btn-primary"
              style={{ height: 38, padding: '0 16px', fontSize: 13.5, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Enabling…' : 'Enable notifications'}
            </button>
          ) : (
            <>
              <button type="button" onClick={sendTest} disabled={busy} className="pkp-btn-primary"
                style={{ height: 38, padding: '0 16px', fontSize: 13.5, opacity: busy ? 0.7 : 1 }}>
                {busy ? 'Sending…' : 'Send a test notification'}
              </button>
              <button type="button" onClick={disable} disabled={busy} className="pkp-btn-ghost"
                style={{ height: 38, padding: '0 16px', fontSize: 13.5, opacity: busy ? 0.7 : 1 }}>
                Turn off
              </button>
            </>
          )}
        </div>
      )}

      {err && note('var(--danger-600, #dc2626)', err)}
      {msg && note('var(--success-600, #16a34a)', msg)}
    </div>
  );
}
