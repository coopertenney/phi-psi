'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase, isSupabaseConfigured } from '@/lib/supabase/browser';
import { MemberAvatar } from './MemberAvatar';

// The signed-in member's own avatar, click-to-change. This is the "spot" where a
// person adds/updates their profile picture: it uploads to the public `avatars`
// bucket under their uid folder (RLS-gated), then records the URL via the
// set_my_avatar RPC. In mock/demo mode (no auth) it just previews locally.
export function AvatarUpload({ name, src, size = 38 }: { name: string; src?: string | null; size?: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith('image/')) return setErr('Please choose an image file.');
    if (file.size > 5 * 1024 * 1024) return setErr('Image must be under 5 MB.');

    // Demo mode: no backend — just show it locally so the flow is visible.
    if (!isSupabaseConfigured) { setPreview(URL.createObjectURL(file)); return; }

    setBusy(true);
    try {
      const sb = getBrowserSupabase();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('You need to be signed in.');
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const up = await sb.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) throw up.error;
      const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const { error } = await sb.rpc('set_my_avatar', { p_url: url });
      if (error) throw error;
      setPreview(url);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? src ?? null;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <button
        type="button" onClick={() => inputRef.current?.click()} disabled={busy}
        title="Change profile photo" aria-label="Change profile photo"
        style={{ padding: 0, border: 'none', background: 'none', cursor: busy ? 'default' : 'pointer', borderRadius: '50%', display: 'block', width: size, height: size, position: 'relative' }}
      >
        <MemberAvatar name={name} src={shown} size={size} />
        {/* camera badge cue that this avatar is editable */}
        <span style={{
          position: 'absolute', right: -2, bottom: -2, width: 16, height: 16, borderRadius: '50%',
          background: 'var(--pkp-primary)', border: '2px solid var(--white)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1,
        }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
      {err && (
        <div style={{ position: 'absolute', top: size + 6, right: 0, whiteSpace: 'nowrap', fontSize: 11, color: 'var(--danger-600)', background: 'var(--white)', border: '1px solid var(--cream-400)', borderRadius: 6, padding: '3px 7px', boxShadow: 'var(--shadow-sm)', zIndex: 20 }}>
          {err}
        </div>
      )}
    </div>
  );
}
