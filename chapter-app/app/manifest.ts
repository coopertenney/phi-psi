import type { MetadataRoute } from 'next';

// Next serves this at /manifest.webmanifest and injects the <link rel="manifest">
// automatically. `display: standalone` is what makes the app installable to the
// home screen — and, on iOS 16.4+, is a prerequisite for Web Push working at all
// (push is blocked in the Safari tab; only the installed PWA can receive it).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Phi Kappa Psi · Cal Beta',
    short_name: 'Phi Psi',
    description: 'Chapter management dashboard',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAF9F5', // cream-50
    theme_color: '#9E1B32', // cardinal-500
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // The crest sits at ~50% of the canvas, well inside the maskable safe zone,
      // so the same square doubles as the maskable (adaptive) icon on Android.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
