'use client';

import { useMemo, useState } from 'react';
import type { AnnouncementRow, AnnouncementCategory, AnnouncementAudience } from '@/lib/types';
import { relativeDay, type BadgeTone } from '@/lib/format';
import { NOW } from '@/lib/engagement';
import { MOCK_USER } from '@/lib/session';
import { useApp } from './Providers';
import { Avatar, Badge } from './ui';

const CAT_META: Record<AnnouncementCategory, { tone: BadgeTone; label: string }> = {
  general: { tone: 'neutral', label: 'General' },
  event: { tone: 'info', label: 'Event' },
  finance: { tone: 'warning', label: 'Finance' },
  urgent: { tone: 'danger', label: 'Urgent' },
};

const Pin = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

const sortFeed = (a: AnnouncementRow, b: AnnouncementRow): number =>
  Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

export function AnnouncementsScreen({ announcements }: { announcements: AnnouncementRow[] }) {
  const { role } = useApp();
  const [posts, setPosts] = useState<AnnouncementRow[]>(announcements);

  const visible = useMemo(
    () => posts.filter((p) => (role === 'exec' ? true : p.audience === 'all')).sort(sortFeed),
    [posts, role],
  );

  const onPost = (a: AnnouncementRow) => setPosts((prev) => [a, ...prev]);

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {role === 'exec' && <Compose onPost={onPost} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visible.map((a) => <Card key={a.id} a={a} />)}
      </div>
    </div>
  );
}

function Card({ a }: { a: AnnouncementRow }) {
  const cm = CAT_META[a.category];
  return (
    <div className="pkp-card" style={{ padding: 18, borderLeft: a.pinned ? '3px solid var(--pkp-primary)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
        <Badge tone={cm.tone}>{cm.label}</Badge>
        {a.audience === 'officers' && <Badge tone="neutral">Officers only</Badge>}
        {a.pinned && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, color: 'var(--pkp-primary)' }}>
            {Pin} Pinned
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-400)' }}>{relativeDay(a.createdAt, NOW)}</span>
      </div>
      <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 600, color: 'var(--ink-900)', lineHeight: 1.25 }}>{a.title}</h3>
      <p style={{ fontSize: 13.5, color: 'var(--ink-600)', lineHeight: 1.6, margin: '8px 0 14px' }}>{a.body}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingTop: 12, borderTop: '1px solid var(--cream-200)' }}>
        <Avatar name={a.author} size={28} />
        <div style={{ fontSize: 12.5 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{a.author}</span>
          <span style={{ color: 'var(--ink-500)' }}> · {a.authorRole}</span>
        </div>
      </div>
    </div>
  );
}

function Compose({ onPost }: { onPost: (a: AnnouncementRow) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience>('all');
  const [category, setCategory] = useState<AnnouncementCategory>('general');

  const author = MOCK_USER.exec;
  const canPost = title.trim().length > 0 && body.trim().length > 0;

  const submit = () => {
    if (!canPost) return;
    onPost({
      id: `ann-new-${Date.now()}`,
      title: title.trim(),
      body: body.trim(),
      author: author.name,
      authorRole: author.title,
      createdAt: NOW.toISOString(),
      audience,
      pinned: false,
      category,
    });
    setTitle('');
    setBody('');
    setAudience('all');
    setCategory('general');
  };

  const field: React.CSSProperties = {
    width: '100%', border: '1px solid var(--cream-400)', borderRadius: 'var(--radius-md)',
    background: 'var(--white)', padding: '10px 12px', fontSize: 13.5, color: 'var(--ink-800)',
    fontFamily: 'var(--font-sans)', outline: 'none',
  };

  return (
    <div className="pkp-card" style={{ padding: 18 }}>
      <div className="pkp-col-head" style={{ marginBottom: 12 }}>New announcement</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input style={field} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea style={{ ...field, minHeight: 76, resize: 'vertical' }} placeholder="Write an update for the chapter…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select style={{ ...field, width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}>
            {(Object.keys(CAT_META) as AnnouncementCategory[]).map((c) => <option key={c} value={c}>{CAT_META[c].label}</option>)}
          </select>
          <div className="pkp-seg">
            <button className={audience === 'all' ? 'on' : ''} onClick={() => setAudience('all')}>All</button>
            <button className={audience === 'officers' ? 'on' : ''} onClick={() => setAudience('officers')}>Officers</button>
          </div>
          <button className="pkp-btn-primary" disabled={!canPost} onClick={submit}
            style={{ marginLeft: 'auto', height: 38, padding: '0 20px', fontSize: 13.5, opacity: canPost ? 1 : 0.5, cursor: canPost ? 'pointer' : 'not-allowed' }}>
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
