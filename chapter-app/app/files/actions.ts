'use server';

import { getServerSupabase } from '@/lib/supabase/server';
import { CHAPTER_ID } from '@/lib/chapter';

// Server-side inspection of an external link, used by the Files "Add link" flow:
//
//  • sharing — is the linked Google resource publicly viewable? A public one
//    returns 200 viewer HTML; a restricted one 3xx-redirects to
//    accounts.google.com. We follow redirects and inspect the final URL. Only
//    Google hosts are judged ('unknown' otherwise — we don't assert what we
//    can't verify). Powers an advisory flag; never blocks saving.
//  • title — the page's <title> / og:title, so the item names itself. Fetched
//    for any public http(s) host (with an SSRF guard), Google-suffix stripped.
//
// Both come from a single fetch. Titles/sharing are best-effort: failures and
// login walls resolve to null/'unknown', not a hard error.

export type SharingStatus = 'public' | 'restricted' | 'unknown';
export interface LinkInfo {
  sharing: SharingStatus;
  title: string | null;
  image: string | null;        // og:image — an inline thumbnail for the link card
  description: string | null;  // og:description — a one-line snippet
}

// Move a file or folder to a different parent folder
export async function moveItem(itemId: string, newParentId: string | null) {
  const sb = getServerSupabase();
  
  // Validate that the new parent is a folder (if not null)
  if (newParentId !== null) {
    const { data: parent, error: parentError } = await sb
      .from('files')
      .select('kind')
      .eq('id', newParentId)
      .eq('chapter_id', CHAPTER_ID)
      .single();
      
    if (parentError || !parent || parent.kind !== 'folder') {
      throw new Error('Invalid parent folder');
    }
  }
  
  // Update the item's parent_id
  const { error } = await sb
    .from('files')
    .update({ parent_id: newParentId })
    .eq('id', itemId)
    .eq('chapter_id', CHAPTER_ID);
    
  if (error) {
    throw new Error(`Failed to move item: ${error.message}`);
  }
  
  return { success: true };
}

const GOOGLE_HOSTS = /(^|\.)(google\.com|googleusercontent\.com)$/i;

function hostOf(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

// Block non-http(s) schemes and private / loopback / link-local / metadata
// targets so a pasted URL can't turn this fetch into an SSRF probe of the
// deploy's own network.
function isFetchable(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
    || h === '0.0.0.0' || h === '::1' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return false;
  return true;
}

// Read at most maxBytes of the body — the <title> lives in <head> near the top,
// so we never pull a whole multi-MB doc just to name it.
async function readCapped(res: Response, maxBytes = 96_000): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); total += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } })
    .replace(/&amp;/g, '&'); // last, so we don't double-decode
}

// Pull `content` from the <meta> tag matching a property/name, tolerating either
// attribute order (content-before-property or property-before-content).
function metaContent(html: string, key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*>`, 'i'))?.[0]
    ?? html.match(new RegExp(`<meta[^>]+content=["'][^"']*["'][^>]*(?:property|name)=["']${k}["'][^>]*>`, 'i'))?.[0];
  const raw = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return raw ? decodeEntities(raw).replace(/\s+/g, ' ').trim() : null;
}

function extractTitle(html: string): string | null {
  const ogContent = metaContent(html, 'og:title');
  const raw = ogContent ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return null;
  let title = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  title = title.replace(/\s*[-–—|]\s*Google (Docs|Sheets|Slides|Drive|Forms)\s*$/i, '').trim();
  // Login walls / placeholder titles aren't useful names.
  if (!title || /^(sign in|untitled|google (docs|sheets|slides|drive))\b/i.test(title)) return null;
  return title.slice(0, 120);
}

// A preview thumbnail (og:image / twitter:image), resolved to an absolute URL
// against the page it came from so a relative `/thumb.png` still loads.
function extractImage(html: string, base: string): string | null {
  const raw = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
  if (!raw) return null;
  try { return new URL(raw, base).toString(); } catch { return null; }
}

// A one-line snippet for the card body.
function extractDescription(html: string): string | null {
  const raw = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  if (!raw) return null;
  return raw.slice(0, 200);
}

const NO_INFO: LinkInfo = { sharing: 'unknown', title: null, image: null, description: null };

async function probe(rawUrl: string, wantMeta: boolean): Promise<LinkInfo> {
  const url = rawUrl?.trim();
  if (!url || !isFetchable(url)) return NO_INFO;
  const host = hostOf(url);
  const googley = !!host && GOOGLE_HOSTS.test(host);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; PhiPsiApp/1.0)' },
      cache: 'no-store',
    });
    const landed = hostOf(res.url) ?? host;

    let sharing: SharingStatus = 'unknown';
    if (/(^|\.)accounts\.google\.com$/i.test(landed ?? '')) sharing = 'restricted';
    else if (googley && res.ok) sharing = 'public';
    else if (googley && (res.status === 401 || res.status === 403)) sharing = 'restricted';

    // Read the <head> once and pull title/thumbnail/snippet from it. Skipped for
    // restricted docs (the body is a login wall, not the real content) and when
    // the caller only needs the sharing verdict.
    let title: string | null = null;
    let image: string | null = null;
    let description: string | null = null;
    if (wantMeta && res.ok && sharing !== 'restricted') {
      const html = await readCapped(res);
      title = extractTitle(html);
      image = extractImage(html, res.url);
      description = extractDescription(html);
    } else {
      res.body?.cancel().catch(() => {});
    }

    return { sharing, title, image, description };
  } catch {
    return NO_INFO;
  } finally {
    clearTimeout(timer);
  }
}

// Sharing verdict only — used by the background row-probe + preview banner.
// Skips the fetch entirely for non-Google hosts (nothing to assert there).
export async function checkLinkSharing(rawUrl: string): Promise<SharingStatus> {
  const host = hostOf(rawUrl?.trim() ?? '');
  if (!host || !GOOGLE_HOSTS.test(host)) return 'unknown';
  return (await probe(rawUrl, false)).sharing;
}

// Sharing + auto-title — used once by the Add-link dialog as the URL is entered.
export async function inspectLink(rawUrl: string): Promise<LinkInfo> {
  return probe(rawUrl, true);
}

// Full preview metadata (title + thumbnail + snippet + sharing) for the inline
// bookmark card. Fetched for ANY http(s) host, not just Google — an og:image is
// what makes the card feel like a real link unfurl.
export async function getLinkPreview(rawUrl: string): Promise<LinkInfo> {
  return probe(rawUrl, true);
}
