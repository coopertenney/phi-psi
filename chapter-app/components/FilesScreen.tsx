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
import { useEscapeKey } from './useEscapeKey';
import { createPortal } from 'react-dom';
import { CHAPTER_ID } from '@/lib/chapter';
import { inspectLink, getLinkPreview, type SharingStatus, type LinkInfo } from '@/app/files/actions';
import { moveItem } from '@/app/files/actions';

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

// ── Link preview plumbing ──────────────────────────────────────────────────
// A Google Docs/Sheets/Slides/Drive-file link → its embeddable `/preview` URL
// (which renders inline in an iframe). Returns null for folders, non-Google
// hosts, and anything else we can't safely frame.
function googlePreviewUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.host.toLowerCase();
  const path = u.pathname;
  const docMatch = path.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (host.endsWith('docs.google.com') && docMatch) {
    return `https://docs.google.com/${docMatch[1]}/d/${docMatch[2]}/preview`;
  }
  const fileMatch = path.match(/^\/file\/d\/([^/]+)/);
  if (host.endsWith('drive.google.com') && fileMatch) {
    return `https://drive.google.com/file/d/${fileMatch[1]}/preview`;
  }
  if (host.endsWith('drive.google.com') && path === '/open' && u.searchParams.get('id')) {
    return `https://drive.google.com/file/d/${u.searchParams.get('id')}/preview`;
  }
  return null;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const isPdfUrl = (u: string) => /\.pdf(\?|#|$)/i.test(u);

// Fallback name when a title can't be fetched (a restricted doc, a page with no
// <title>) — so the item is never nameless. Recognizes Google types, else uses
// the last path segment or the host.
function nameFromUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const h = u.host.toLowerCase();
    if (h.endsWith('docs.google.com')) {
      if (u.pathname.includes('/document/')) return 'Google Doc';
      if (u.pathname.includes('/spreadsheets/')) return 'Google Sheet';
      if (u.pathname.includes('/presentation/')) return 'Google Slides';
      if (u.pathname.includes('/forms/')) return 'Google Form';
    }
    if (h.endsWith('drive.google.com')) return u.pathname.includes('/folders/') ? 'Drive folder' : 'Drive file';
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg ? decodeURIComponent(seg).replace(/\.[a-z0-9]{1,5}$/i, '') : h.replace(/^www\./, '');
  } catch { return ''; }
}

type Embed = { mode: 'image' | 'iframe'; src: string } | { mode: 'none' };

// Only *some* types can be safely embedded. Everything else (arbitrary sites
// that send X-Frame-Options, unshared Google folders, .docx/.xlsx blobs a
// browser just downloads) falls back to an "Open in new tab" action — we never
// hopefully-iframe a URL that would render as a silent blank frame.
function embedFor(item: DriveItem, signedUrl: string | null): Embed {
  if (item.kind === 'link' && item.url) {
    const g = googlePreviewUrl(item.url);
    if (g) return { mode: 'iframe', src: g };
    if (IMAGE_EXT.test(item.url)) return { mode: 'image', src: item.url };
    if (isPdfUrl(item.url)) return { mode: 'iframe', src: item.url };
    return { mode: 'none' };
  }
  if (signedUrl) {
    if (item.kind === 'image') return { mode: 'image', src: signedUrl };
    if (item.kind === 'pdf') return { mode: 'iframe', src: signedUrl };
  }
  return { mode: 'none' };
}

// Session cache of link-preview probes (title + thumbnail + snippet + sharing),
// keyed by URL, so we don't re-fetch on every render / folder navigation.
const previewCache = new Map<string, LinkInfo>();

// Host shown under the card title (e.g. "docs.google.com").
function hostLabel(raw: string): string {
  try { return new URL(raw).host.replace(/^www\./, ''); } catch { return raw; }
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
  const [preview, setPreview] = useState<DriveItem | null>(null);
  const [previews, setPreviews] = useState<Record<string, LinkInfo>>({});
  const uploadRef = useRef<HTMLInputElement>(null);
  const [moveItemOpen, setMoveItemOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<DriveItem | null>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Members never see officers-only items.
  const visible = useMemo(
    () => items.filter((i) => (role === 'exec' ? true : i.audience === 'all')),
    [items, role],
  );

  // Fetch a preview (title + thumbnail + snippet + sharing) for each link so its
  // row unfurls into an inline bookmark card. Best-effort, cached per URL;
  // failures resolve to nulls so a link just shows its glyph. Also powers the
  // "not shared publicly" flag. Runs quietly in the background.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const l of visible) {
        if (l.kind !== 'link' || !l.url) continue;
        const cached = previewCache.get(l.url);
        if (cached) {
          setPreviews((p) => (p[l.id] === cached ? p : { ...p, [l.id]: cached }));
          continue;
        }
        const info = await getLinkPreview(l.url);
        previewCache.set(l.url, info);
        if (cancelled) return;
        setPreviews((p) => ({ ...p, [l.id]: info }));
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

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
    const byName = (a: DriveItem, b: DriveItem) => a.name.localeCompare(b.name);
    const folders = scope.filter((i) => i.kind === 'folder').sort(byName);
    const links = scope.filter((i) => i.kind === 'link').sort(byName);
    const files = scope.filter((i) => i.kind !== 'folder' && i.kind !== 'link').sort(byName);
    return { folders, links, files };
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

  const moveItemFunc = async (item: DriveItem, newParentId: string | null) => {
    setBusy(true);
    try {
      await moveItem(item.id, newParentId);
      router.refresh();
    } catch (err: any) {
      alert(err?.message ?? 'Move failed.');
    } finally {
      setBusy(false);
      setMoveItemOpen(false);
      setItemToMove(null);
    }
  };

  const empty = contents.folders.length === 0 && contents.links.length === 0 && contents.files.length === 0;

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

        <div className="pkp-files-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
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
                {canManage && (
                  <>
                    <RowMove disabled={busy} onClick={(e) => { e.stopPropagation(); setItemToMove(f); setMoveItemOpen(true); }} />
                    <RowDelete disabled={busy} onClick={(e) => { e.stopPropagation(); removeItem(f); }} />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Links as inline bookmark cards (thumbnail + title + domain + snippet) */}
      {contents.links.length > 0 && (
        <div>
          <div className="pkp-col-head" style={{ marginBottom: 10 }}>Links</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {contents.links.map((l) => (
      <LinkCard
        key={l.id}
        item={l}
        info={previews[l.id]}
        canManage={canManage}
        busy={busy}
        onOpen={() => setPreview(l)}
        onDelete={(e) => { e.stopPropagation(); removeItem(l); }}
        onMove={(e) => { e.stopPropagation(); setItemToMove(l); setMoveItemOpen(true); }}
      />
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
                      onClick={openable ? () => setPreview(f) : undefined}
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
                        {canManage && (
                          <>
                            <RowMove disabled={busy} onClick={(e) => { e.stopPropagation(); setItemToMove(f); setMoveItemOpen(true); }} />
                            <RowDelete disabled={busy} onClick={(e) => { e.stopPropagation(); removeItem(f); }} />
                          </>
                        )}
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
  {preview && <PreviewModal item={preview} live={live} sharing={previews[preview.id]?.sharing} onClose={() => setPreview(null)} />}
  {moveItemOpen && itemToMove && (
    <MoveFolder 
      item={itemToMove} 
      items={items} 
      onClose={() => setMoveItemOpen(false)} 
      onMove={moveItemFunc}
      currentFolderId={folderId}
    />
  )}
    </div>
  );
}

// Inline preview overlay: embeds images, PDFs, and Google Docs/Sheets/Slides/
// Drive files; falls back to an "Open in new tab" action for everything else.
// Surfaces the sharing-restricted flag as a banner so it's impossible to miss.
function PreviewModal({ item, live, sharing, onClose }: {
  item: DriveItem; live: boolean; sharing?: SharingStatus; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEscapeKey(onClose);

  const isLink = item.kind === 'link';
  const [signed, setSigned] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isLink && live && !!item.storagePath);

  // Uploaded files live in a private bucket → sign a short-lived URL to embed.
  useEffect(() => {
    if (isLink || !live || !item.storagePath) return;
    let cancelled = false;
    getBrowserSupabase().storage.from(BUCKET).createSignedUrl(item.storagePath, 300)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setError(error?.message ?? 'Could not load this file.');
        else setSigned(data.signedUrl);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isLink, live, item.storagePath]);

  const embed = useMemo(() => embedFor(item, signed), [item, signed]);
  const openUrl = isLink ? item.url ?? null : signed;

  // The row list probes sharing in the background; if the preview is opened
  // before that finishes, probe here too so the banner is never a step behind.
  const [share, setShare] = useState<SharingStatus | undefined>(sharing);
  useEffect(() => { if (sharing) setShare(sharing); }, [sharing]);
  useEffect(() => {
    if (!isLink || !item.url || share) return;
    const cached = previewCache.get(item.url);
    if (cached) { setShare(cached.sharing); return; }
    let cancelled = false;
    getLinkPreview(item.url).then((info) => {
      previewCache.set(item.url!, info);
      if (!cancelled) setShare(info.sharing);
    });
    return () => { cancelled = true; };
  }, [isLink, item.url, share]);

  if (!mounted) return null;

  return createPortal(
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(20,20,19,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(12px, 3vh, 32px) 16px', animation: 'pkpScrim .2s ease' }}>
      <div role="dialog" aria-modal onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1080px, 96vw)', height: 'min(88vh, 940px)', background: 'var(--cream-50)',
          border: '1px solid var(--cream-400)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cream-300)', background: 'var(--white)',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <Glyph kind={item.kind} size={22} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600, color: 'var(--ink-900)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{KIND[item.kind].label} · {item.ownerName}</div>
          </div>
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn, textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}>
              Open in new tab <span aria-hidden>↗</span>
            </a>
          )}
          <button onClick={onClose} aria-label="Close"
            style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-500)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>

        {/* Sharing-restricted flag */}
        {isLink && share === 'restricted' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 18px',
            background: 'var(--warning-100)', color: 'var(--warning-600)', fontSize: 12.5, borderBottom: '1px solid var(--cream-300)' }}>
            <span style={{ fontSize: 14, lineHeight: 1.2 }}>⚠</span>
            <span>This link may not be shared publicly — brothers could hit a “request access” screen. In Google, set link sharing to <strong>“Anyone with the link.”</strong></span>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: embed.mode === 'image' ? 20 : 0, background: 'var(--cream-100)', overflow: 'auto' }}>
          {loading ? (
            <div style={{ color: 'var(--ink-500)', fontSize: 13.5 }}>Loading preview…</div>
          ) : error ? (
            <NoPreview item={item} openUrl={openUrl} message={error} />
          ) : embed.mode === 'image' ? (
            <img src={embed.src} alt={item.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, boxShadow: 'var(--shadow-md)' }} />
          ) : embed.mode === 'iframe' ? (
            <iframe src={embed.src} title={item.name} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} allow="autoplay" referrerPolicy="no-referrer" />
          ) : (
            <NoPreview item={item} openUrl={openUrl} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Shown when a type can't be embedded (arbitrary sites, Drive folders, doc/xls
// blobs) or a signed URL failed — a calm fallback, not a dead end.
function NoPreview({ item, openUrl, message }: { item: DriveItem; openUrl: string | null; message?: string }) {
  return (
    <div style={{ textAlign: 'center', color: 'var(--ink-500)', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ opacity: 0.5 }}><Glyph kind={item.kind} size={44} /></div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-700)', maxWidth: 320 }}>
        {message ?? 'A preview isn’t available for this item.'}
      </div>
      {openUrl && (
        <a href={openUrl} target="_blank" rel="noopener noreferrer" className="pkp-btn-primary"
          style={{ height: 38, padding: '0 18px', fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          Open in new tab ↗
        </a>
      )}
    </div>
  );
}

// An inline bookmark card for a link item: a thumbnail banner (og:image) over
// the title, host, and a one-line snippet — so a link "unfurls" in the list
// instead of being just a name + glyph. Clicking opens the in-app preview;
// "Open ↗" goes straight to the source in a new tab. While the preview is still
// being fetched it shows a calm skeleton; if there's no thumbnail (or it fails
// to load) it falls back to a tinted banner with the link glyph — never a
// broken image.
function LinkCard({ item, info, canManage, busy, onOpen, onDelete, onMove }: {
  item: DriveItem;
  info?: LinkInfo;
  canManage: boolean;
  busy: boolean;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onMove: (e: React.MouseEvent) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const loading = info === undefined;
  const image = !imgError ? info?.image ?? null : null;
  const host = item.url ? hostLabel(item.url) : '';
  const snippet = info?.description ?? null;
  const restricted = info?.sharing === 'restricted';

  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="pkp-card"
      style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', cursor: 'pointer',
        border: '1px solid var(--cream-300)', background: 'var(--white)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--cream-400)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--cream-300)')}
    >
      {/* Thumbnail banner */}
      <div style={{ position: 'relative', aspectRatio: '1.9 / 1', background: 'var(--cream-100)',
        borderBottom: '1px solid var(--cream-200)', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loading ? (
          <div style={{ position: 'absolute', inset: 0, background: 'var(--cream-200)', animation: 'pkpPulse 1.4s ease-in-out infinite' }} />
        ) : image ? (
          <img
            src={image} alt="" referrerPolicy="no-referrer" loading="lazy"
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ opacity: 0.35 }}><Glyph kind="link" size={40} /></div>
        )}
        {restricted && (
          <span title="This link isn’t shared publicly — brothers may hit a request-access screen."
            style={{ position: 'absolute', top: 8, left: 8 }}>
            <Badge tone="warning">⚠ Restricted</Badge>
          </span>
        )}
        {canManage && (
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 6, right: 6, background: 'var(--white)', borderRadius: 8, boxShadow: 'var(--shadow-sm)', display: 'flex', gap: 2 }}>
            <RowMove disabled={busy} onClick={onMove} />
            <RowDelete disabled={busy} onClick={onDelete} />
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ display: 'inline-flex', flexShrink: 0 }}><Glyph kind="link" size={15} /></span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)', fontFamily: 'var(--font-serif)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
          {item.audience === 'officers' && <Badge tone="neutral">Officers</Badge>}
        </div>
        {snippet && (
          <div style={{ fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.45,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {snippet}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {host}
          </span>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--pkp-accent, #b7942e)', textDecoration: 'none', flexShrink: 0 }}>
              Open ↗
            </a>
          )}
        </div>
      </div>
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
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<SharingStatus | null>(null);
  const [armed, setArmed] = useState(false);   // second-click confirm once the warning is shown
  const titleRef = useRef<string | null>(null);  // last fetched title, for submit fallback
  const userTypedRef = useRef(false);            // officer typed their own name → don't overwrite
  const ok = url.trim() !== '';                  // name is optional — it fills itself in

  const normalize = (u: string) => {
    const x = u.trim();
    return x && !/^https?:\/\//i.test(x) ? `https://${x}` : x;
  };

  // As they type/paste the URL (debounced): fetch the title to auto-name the
  // item, and probe sharing so a forgotten "Anyone with the link" setting is
  // flagged loudly BEFORE they reach the button.
  useEffect(() => {
    const u = normalize(url);
    if (!u) { setStatus(null); setChecking(false); titleRef.current = null; return; }
    setChecking(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const info = await inspectLink(u);
      previewCache.set(u, info);
      if (cancelled) return;
      titleRef.current = info.title;
      setStatus(info.sharing);
      setChecking(false);
      // Fill the name from the fetched title unless the officer typed their own.
      if (info.title && !userTypedRef.current) setName(info.title);
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [url]);

  const restricted = status === 'restricted';

  const submit = async () => {
    if (!ok) return;
    const u = normalize(url);
    let s: SharingStatus | null = previewCache.get(u)?.sharing ?? status;
    if (s === null) {
      setChecking(true);
      const info = await inspectLink(u);
      previewCache.set(u, info);
      s = info.sharing;
      if (info.title) { titleRef.current = info.title; if (!userTypedRef.current) setName(info.title); }
      setStatus(s); setChecking(false);
    }
    // Restricted + not yet acknowledged → surface the flag and require a
    // deliberate second click ("Add anyway"). Never a permanent block.
    if (s === 'restricted' && !armed) { setArmed(true); return; }
    const finalName = name.trim() || titleRef.current || nameFromUrl(u) || 'Untitled link';
    onCreate(finalName, url);
  };

  return (
    <Modal
      title="Add link"
      sub="Link to a Google Drive folder, a Doc/Sheet, or any web page. The name fills in from the link; it gets an inline preview here."
      onClose={onClose}
      footer={
        <>
          <button className="pkp-btn-ghost" onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={!ok}
            className={armed ? 'pkp-btn-ghost' : 'pkp-btn-primary'}
            style={{ height: 38, padding: '0 18px', fontSize: 13.5, opacity: ok ? 1 : 0.5, cursor: ok ? 'pointer' : 'not-allowed',
              ...(armed ? { border: '1.5px solid var(--warning-500)', background: 'var(--warning-100)', color: 'var(--warning-600)', fontWeight: 700 } : {}) }}>
            {armed ? 'Add anyway' : 'Add link'}
          </button>
        </>
      }
    >
      <Field label="URL" autoFocus value={url}
        onChange={(e) => { setUrl(e.target.value); setStatus(null); setArmed(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="https://docs.google.com/…" />
      <Field label="Name (optional — auto-filled from the link)" value={name}
        onChange={(e) => { setName(e.target.value); userTypedRef.current = e.target.value.trim() !== ''; }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={checking ? 'Fetching name…' : 'e.g. Chapter Roster (Google Sheet)'} />

      {checking && <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>Checking link…</div>}

      {restricted && (
        <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 15px', borderRadius: 'var(--radius-md)',
          background: 'var(--warning-100)', border: '1.5px solid var(--warning-500)' }}>
          <span style={{ fontSize: 19, lineHeight: 1.1 }}>⚠</span>
          <div style={{ fontSize: 12.5, color: 'var(--warning-600)', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 3 }}>This link isn’t shared publicly</div>
            Brothers who open it will hit a “request access” screen. In Google, open{' '}
            <strong>Share → General access → “Anyone with the link,”</strong> then paste it again.
            {armed && <div style={{ marginTop: 7, fontWeight: 600 }}>Fix sharing and the flag clears — or click <em>Add anyway</em> to add it as-is.</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// Small move button used on folder cards + file rows (exec only).
function RowMove({ onClick, disabled }: { onClick: (e: React.MouseEvent) => void; disabled?: boolean }) {
  return (
    <button aria-label="Move" disabled={disabled} onClick={onClick}
      style={{ border: 'none', background: 'transparent', cursor: disabled ? 'default' : 'pointer', color: 'var(--ink-400)', padding: 4, display: 'inline-flex', borderRadius: 6 }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--pkp-accent, #b7942e)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-400)')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20M9 5v14M15 5v14" />
      </svg>
    </button>
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

// Modal for moving items to a different folder
function MoveFolder({ item, items, onClose, onMove, currentFolderId }: {
  item: DriveItem;
  items: DriveItem[];
  onClose: () => void;
  onMove: (item: DriveItem, newParentId: string | null) => void;
  currentFolderId: string | null;
}) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentFolderId);
  
  // Get all folders except the item itself (if it's a folder) and its descendants
  const folders = useMemo(() => {
    if (item.kind === 'folder') {
      // Exclude the folder itself and all its descendants to prevent moving into itself
      const excludeIds = new Set([item.id]);
      const addDescendants = (folderId: string) => {
        const children = items.filter(i => i.parentId === folderId && i.kind === 'folder');
        children.forEach(child => {
          excludeIds.add(child.id);
          addDescendants(child.id);
        });
      };
      addDescendants(item.id);
      return items.filter(i => i.kind === 'folder' && !excludeIds.has(i.id));
    }
    return items.filter(i => i.kind === 'folder');
  }, [items, item]);
  
  const handleMove = () => {
    onMove(item, selectedFolderId);
  };
  
  return (
    <Modal
      title={`Move "${item.name}"`}
      onClose={onClose}
      footer={
        <>
          <button className="pkp-btn-ghost" onClick={onClose} style={ghostBtn}>Cancel</button>
          <button className="pkp-btn-primary" onClick={handleMove} style={{ height: 38, padding: '0 18px', fontSize: 13.5 }}>
            Move
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--ink-700)' }}>
          Select destination folder:
        </label>
        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--cream-300)', borderRadius: 6, padding: 8 }}>
          <div 
            style={{ 
              padding: '8px 12px', 
              cursor: 'pointer', 
              borderRadius: 4,
              backgroundColor: selectedFolderId === null ? 'var(--cream-200)' : 'transparent'
            }}
            onClick={() => setSelectedFolderId(null)}
          >
            <div style={{ fontWeight: selectedFolderId === null ? 600 : 400 }}>Root (main folder)</div>
          </div>
          {folders.map(folder => (
            <div 
              key={folder.id}
              style={{ 
                padding: '8px 12px', 
                cursor: 'pointer', 
                borderRadius: 4,
                backgroundColor: selectedFolderId === folder.id ? 'var(--cream-200)' : 'transparent',
                marginLeft: 12
              }}
              onClick={() => setSelectedFolderId(folder.id)}
            >
              <div style={{ fontWeight: selectedFolderId === folder.id ? 600 : 400 }}>{folder.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 8 }}>
        Note: Moving an item to a folder will place it inside that folder.
      </div>
    </Modal>
  );
}
