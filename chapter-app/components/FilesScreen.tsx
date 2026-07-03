'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DriveItem, FileKind } from '@/lib/types';
import { relativeDay } from '@/lib/format';
import { NOW } from '@/lib/engagement';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { useApp } from './Providers';
import { Badge } from './ui';
import { icons } from './icons';
import { Modal, Field } from './form';
import { CHAPTER_ID } from '@/lib/chapter';

const BUCKET = 'chapter-files';

// ── Per-kind color + label, used for the file/folder glyph. ──
const KIND: Record<FileKind, { color: string; label: string }> = {
  folder: { color: 'var(--pkp-accent, #b7942e)', label: 'Folder' },
  pdf:    { color: '#d64545', label: 'PDF' },
  doc:    { color: '#2f6fd0', label: 'Doc' },
  sheet:  { color: '#1f9d57', label: 'Sheet' },
  slides: { color: '#e08a1e', label: 'Slides' },
  image:  { color: '#8b5cf6', label: 'Image' },
  file:   { color: 'var(--ink-400, #9aa0a6)', label: 'File' },
  link:   { color: '#2f6fd0', label: 'Link' },
};

const KB = 1024, MB = 1024 * 1024;
const fmtSize = (b: number | null): string =>
  b == null ? '—' : b < KB ? `${b} B` : b < MB ? `${Math.round(b / KB)} KB` : `${(b / MB).toFixed(1)} MB`;

// Infer a file kind from an uploaded filename's extension.
function kindFromName(name: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'rtf', 'txt', 'pages'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return 'image';
  return 'file';
}

// A rounded glyph: solid tint for folders, a document outline for files.
function Glyph({ kind, size = 20 }: { kind: FileKind; size?: number }) {
  const c = KIND[kind].color;
  if (kind === 'folder') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={c} aria-hidden>
        <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z" />
      </svg>
    );
  }
  if (kind === 'link') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function FilesScreen({ items: seeded, live, ownerName }: {
  items: DriveItem[]; live: boolean; ownerName: string;
}) {
  const router = useRouter();
  const { role } = useApp();
  const canManage = role === 'exec';
  const [items, setItems] = useState<DriveItem[]>(seeded);
  useEffect(() => setItems(seeded), [seeded]); // follow server refreshes
  const [folderId, setFolderId] = useState<string | null>(null); // null = root
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newLinkOpen, setNewLinkOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Members never see officers-only items.
  const visible = useMemo(
    () => items.filter((i) => (role === 'exec' ? true : i.audience === 'all')),
    [items, role],
  );

  // Breadcrumb chain: walk parentId up from the current folder.
  const trail = useMemo(() => {
    const chain: DriveItem[] = [];
    let cur = folderId ? byId.get(folderId) ?? null : null;
    while (cur) { chain.unshift(cur); cur = cur.parentId ? byId.get(cur.parentId) ?? null : null; }
    return chain;
  }, [folderId, byId]);

  // What's inside the current folder (folders first, then files; alpha).
  const contents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inFolder = visible.filter((i) => (needle ? true : i.parentId === folderId));
    const scope = needle
      ? visible.filter((i) => i.name.toLowerCase().includes(needle))
      : inFolder;
    const folders = scope.filter((i) => i.kind === 'folder').sort((a, b) => a.name.localeCompare(b.name));
    const files = scope.filter((i) => i.kind !== 'folder').sort((a, b) => a.name.localeCompare(b.name));
    return { folders, files };
  }, [visible, folderId, q]);

  const addFolder = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNewFolderOpen(false);
    if (!live) {
      setItems((prev) => [...prev, {
        id: `f-new-${Date.now()}`, name: trimmed, kind: 'folder', parentId: folderId,
        audience: 'all', ownerName, updatedAt: NOW.toISOString(), sizeBytes: null,
      }]);
      return;
    }
    setBusy(true);
    const { error } = await getBrowserSupabase().from('files').insert({
      chapter_id: CHAPTER_ID, parent_id: folderId, kind: 'folder',
      name: trimmed, audience: 'all', owner_name: ownerName,
    });
    setBusy(false);
    if (error) return void alert(error.message);
    router.refresh();
  };

  // Add an external link (Google Drive/Docs/Sheets, any URL) as an item. Stored
  // as kind 'link' with a url and no storage bytes; opens in a new tab.
  const addLink = async (name: string, rawUrl: string) => {
    const trimmed = name.trim();
    let url = rawUrl.trim();
    if (!trimmed || !url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`; // tolerate a pasted "docs.google.com/…"
    setNewLinkOpen(false);
    if (!live) {
      setItems((prev) => [...prev, {
        id: `l-new-${Date.now()}`, name: trimmed, kind: 'link', parentId: folderId,
        audience: 'all', ownerName, updatedAt: NOW.toISOString(), sizeBytes: null, url,
      }]);
      return;
    }
    setBusy(true);
    const { error } = await getBrowserSupabase().from('files').insert({
      chapter_id: CHAPTER_ID, parent_id: folderId, kind: 'link',
      name: trimmed, audience: 'all', owner_name: ownerName, url,
    });
    setBusy(false);
    if (error) return void alert(error.message);
    router.refresh();
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (uploadRef.current) uploadRef.current.value = '';
    if (!live) {
      const now = NOW.toISOString();
      setItems((prev) => [...prev, ...Array.from(files).map((f, i) => ({
        id: `d-up-${Date.now()}-${i}`, name: f.name, kind: kindFromName(f.name),
        parentId: folderId, audience: 'all' as const, ownerName, updatedAt: now, sizeBytes: f.size,
      }))]);
      return;
    }
    setBusy(true);
    const sb = getBrowserSupabase();
    try {
      for (const f of Array.from(files)) {
        const path = `${CHAPTER_ID}/${crypto.randomUUID()}`;
        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
        if (upErr) throw upErr;
        const { error: insErr } = await sb.from('files').insert({
          chapter_id: CHAPTER_ID, parent_id: folderId, kind: kindFromName(f.name),
          name: f.name, audience: 'all', owner_name: ownerName, storage_path: path, size_bytes: f.size,
        });
        if (insErr) throw insErr;
      }
      router.refresh();
    } catch (err: any) {
      alert(err?.message ?? 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  // Open an item in a new tab. Links go straight to their URL; uploaded files
  // in the private bucket need a short-lived signed URL first.
  const openFile = async (item: DriveItem) => {
    if (item.kind === 'link') {
      if (item.url) window.open(item.url, '_blank', 'noopener');
      return;
    }
    if (!live || !item.storagePath) return;
    const { data, error } = await getBrowserSupabase().storage.from(BUCKET).createSignedUrl(item.storagePath, 60);
    if (error || !data) return void alert(error?.message ?? 'Could not open file.');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const removeItem = async (item: DriveItem) => {
    if (!confirm(`Delete “${item.name}”${item.kind === 'folder' ? ' and everything in it' : ''}? This cannot be undone.`)) return;
    if (!live) { setItems((prev) => prev.filter((i) => i.id !== item.id && i.parentId !== item.id)); return; }
    setBusy(true);
    const sb = getBrowserSupabase();
    try {
      // Row delete cascades child rows in the DB. (Storage bytes of a deleted
      // folder's contents are left as orphans — cleaned up in a later pass.)
      if (item.storagePath) await sb.storage.from(BUCKET).remove([item.storagePath]);
      const { error } = await sb.from('files').delete().eq('id', item.id);
      if (error) throw error;
      router.refresh();
    } catch (err: any) {
      alert(err?.message ?? 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const empty = contents.folders.length === 0 && contents.files.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar: breadcrumb + search + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 14, minWidth: 0 }}>
          <Crumb label="Files" onClick={() => { setFolderId(null); setQ(''); }} active={folderId === null && !q} />
          {trail.map((f) => (
            <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
              <span style={{ color: 'var(--ink-300)', display: 'inline-flex' }}>{icons.chevron}</span>
              <Crumb label={f.name} onClick={() => { setFolderId(f.id); setQ(''); }} active={f.id === folderId} />
            </span>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="pkp-search" style={{ width: 220 }}>
            <span style={{ display: 'inline-flex' }}>{icons.search}</span>
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files…"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, color: 'var(--ink-800)', width: '100%', fontFamily: 'var(--font-sans)' }}
            />
          </div>
          {canManage && (
            <>
              <button className="pkp-btn-ghost" onClick={() => setNewFolderOpen(true)}
                style={ghostBtn}>
                <span style={{ display: 'inline-flex' }}>{icons.plus}</span> New folder
              </button>
              <button className="pkp-btn-ghost" onClick={() => setNewLinkOpen(true)}
                style={ghostBtn}>
                <LinkIcon /> Add link
              </button>
              <button className="pkp-btn-primary" onClick={() => uploadRef.current?.click()}
                style={{ height: 38, padding: '0 16px', fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <UploadIcon /> Upload
              </button>
              <input ref={uploadRef} type="file" multiple hidden onChange={(e) => onUpload(e.target.files)} />
            </>
          )}
        </div>
      </div>

      {empty && (
        <div className="pkp-card" style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--ink-500)' }}>
          <div style={{ opacity: 0.5, marginBottom: 8, display: 'flex', justifyContent: 'center' }}><Glyph kind="folder" size={40} /></div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-700)' }}>{q ? 'No matching files' : 'This folder is empty'}</div>
          {canManage && !q && <div style={{ fontSize: 12.5, marginTop: 4 }}>Use “Upload” or “New folder” to add something.</div>}
        </div>
      )}

      {/* Folders as a grid of cards */}
      {contents.folders.length > 0 && (
        <div>
          <div className="pkp-col-head" style={{ marginBottom: 10 }}>Folders</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {contents.folders.map((f) => (
              <div key={f.id} role="button" tabIndex={0} onClick={() => { setFolderId(f.id); setQ(''); }} className="pkp-card"
                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 14, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--cream-300)', background: 'var(--white)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cream-100)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--white)')}>
                <Glyph kind="folder" size={24} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{childCount(items, f.id)} items · {relativeDay(f.updatedAt, NOW)}</div>
                </div>
                {f.audience === 'officers' && <Badge tone="neutral">Officers</Badge>}
                {canManage && <RowDelete disabled={busy} onClick={(e) => { e.stopPropagation(); removeItem(f); }} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files as a table */}
      {contents.files.length > 0 && (
        <div>
          <div className="pkp-col-head" style={{ marginBottom: 10 }}>Files</div>
          <div className="pkp-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-500)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  <th style={th}>Name</th>
                  <th style={th}>Owner</th>
                  <th style={th}>Modified</th>
                  <th style={{ ...th, textAlign: 'right' }}>Size</th>
                  <th style={{ ...th, width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {contents.files.map((f) => {
                  const openable = f.kind === 'link' ? !!f.url : (live && !!f.storagePath);
                  return (
                    <tr key={f.id} style={{ borderTop: '1px solid var(--cream-200)', cursor: openable ? 'pointer' : 'default' }}
                      onClick={openable ? () => openFile(f) : undefined}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cream-100)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Glyph kind={f.kind} />
                          <span style={{ fontWeight: 500, color: 'var(--ink-900)' }}>{f.name}</span>
                          {f.audience === 'officers' && <Badge tone="neutral">Officers</Badge>}
                        </div>
                      </td>
                      <td style={{ ...td, color: 'var(--ink-600)' }}>{f.ownerName}</td>
                      <td style={{ ...td, color: 'var(--ink-600)' }}>{relativeDay(f.updatedAt, NOW)}</td>
                      <td style={{ ...td, textAlign: 'right', color: 'var(--ink-500)' }} className="pkp-mono">{fmtSize(f.sizeBytes)}</td>
                      <td style={{ ...td, width: 40, textAlign: 'right' }}>
                        {canManage && <RowDelete disabled={busy} onClick={(e) => { e.stopPropagation(); removeItem(f); }} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {newFolderOpen && <NewFolder onClose={() => setNewFolderOpen(false)} onCreate={addFolder} />}
      {newLinkOpen && <NewLink onClose={() => setNewLinkOpen(false)} onCreate={addLink} />}
    </div>
  );
}

function Crumb({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <button onClick={onClick}
      style={{
        border: 'none', background: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 6,
        fontSize: 14, fontWeight: active ? 700 : 500, fontFamily: 'var(--font-serif)',
        color: active ? 'var(--ink-900)' : 'var(--ink-500)', maxWidth: 220,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
      {label}
    </button>
  );
}

function NewFolder({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Modal
      title="New folder"
      onClose={onClose}
      footer={
        <>
          <button className="pkp-btn-ghost" onClick={onClose} style={ghostBtn}>Cancel</button>
          <button className="pkp-btn-primary" disabled={!name.trim()} onClick={() => onCreate(name)}
            style={{ height: 38, padding: '0 18px', fontSize: 13.5, opacity: name.trim() ? 1 : 0.5, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>
            Create
          </button>
        </>
      }
    >
      <Field label="Folder name" autoFocus value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onCreate(name); }} placeholder="e.g. Committee Reports" />
    </Modal>
  );
}

function NewLink({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, url: string) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const ok = name.trim() !== '' && url.trim() !== '';
  const submit = () => { if (ok) onCreate(name, url); };
  return (
    <Modal
      title="Add link"
      sub="Link to a Google Drive folder, a Doc/Sheet, or any web page."
      onClose={onClose}
      footer={
        <>
          <button className="pkp-btn-ghost" onClick={onClose} style={ghostBtn}>Cancel</button>
          <button className="pkp-btn-primary" disabled={!ok} onClick={submit}
            style={{ height: 38, padding: '0 18px', fontSize: 13.5, opacity: ok ? 1 : 0.5, cursor: ok ? 'pointer' : 'not-allowed' }}>
            Add link
          </button>
        </>
      }
    >
      <Field label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Chapter Roster (Google Sheet)" />
      <Field label="URL" value={url} onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="https://docs.google.com/…" />
    </Modal>
  );
}

// Small trash button used on folder cards + file rows (exec only).
function RowDelete({ onClick, disabled }: { onClick: (e: React.MouseEvent) => void; disabled?: boolean }) {
  return (
    <button aria-label="Delete" disabled={disabled} onClick={onClick}
      style={{ border: 'none', background: 'transparent', cursor: disabled ? 'default' : 'pointer', color: 'var(--ink-400)', padding: 4, display: 'inline-flex', borderRadius: 6 }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger-600, #dc2626)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-400)')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </svg>
    </button>
  );
}

const UploadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
  </svg>
);

const LinkIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const childCount = (items: DriveItem[], folderId: string): number =>
  items.filter((i) => i.parentId === folderId).length;

const ghostBtn: React.CSSProperties = {
  height: 38, padding: '0 14px', fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6,
  border: '1px solid var(--cream-400)', background: 'var(--white)', borderRadius: 'var(--radius-md)',
  color: 'var(--ink-700)', cursor: 'pointer',
};
const th: React.CSSProperties = { padding: '11px 16px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '11px 16px', verticalAlign: 'middle' };
