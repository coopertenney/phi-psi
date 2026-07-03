'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PnmRow, PnmStage, PnmNote } from '@/lib/types';
import { relativeDay, type BadgeTone } from '@/lib/format';
import { NOW } from '@/lib/engagement';
import { FUNNEL, STAGE_META, nextStage, pnmNotes } from '@/lib/recruitment';
import { MOCK_USER } from '@/lib/session';
import { createPnm, setPnmStage, ratePnm, votePnm, addPnmNote, type PnmInput } from '@/app/recruitment/actions';
import { useApp } from './Providers';
import { Avatar, Badge, Chips, StatCards } from './ui';
import { icons } from './icons';
import { Modal, ModalActions, Field, Select, FieldRow } from './form';

type LiveProps = {
  live?: boolean;
  notesByPnm?: Record<string, PnmNote[]>;
  myRatings?: Record<string, number>;
  myVotes?: Record<string, 'yes' | 'no'>;
};

type PnmFormInput = { fullName: string; standing: string; major: string; referredBy: string | null; stage: PnmStage };

/* ─────────────────────────── Shared bits ─────────────────────────── */

function StarIcon({ filled, size = 14 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? 'var(--warning-500)' : 'none'}
      stroke={filled ? 'var(--warning-500)' : 'var(--ink-300)'}
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
    </svg>
  );
}

// Read-only average (rounded) with a numeric label.
function StarRating({ rating, count, size = 14 }: { rating: number; count?: number; size?: number }) {
  const filled = Math.round(rating);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', gap: 1 }}>
        {[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} filled={n <= filled} size={size} />)}
      </div>
      <span className="pkp-mono" style={{ fontSize: 12.5, color: 'var(--ink-600)', fontWeight: 600 }}>
        {rating.toFixed(1)}{count != null && <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}> · {count}</span>}
      </span>
    </div>
  );
}

// Interactive "your rating" stars.
function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(value === n ? 0 : n)}
          style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}
          title={`${n} star${n > 1 ? 's' : ''}`}>
          <StarIcon filled={n <= value} size={22} />
        </button>
      ))}
    </div>
  );
}

const StageBadge = ({ stage }: { stage: PnmStage }) => <Badge tone={STAGE_META[stage].tone}>{STAGE_META[stage].short}</Badge>;

function VoteBar({ yes, no }: { yes: number; no: number }) {
  const total = yes + no || 1;
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--cream-300)' }}>
      <div style={{ width: `${(yes / total) * 100}%`, background: 'var(--success-500)' }} />
      <div style={{ width: `${(no / total) * 100}%`, background: 'var(--pkp-primary)' }} />
    </div>
  );
}

export function RecruitmentScreen({ pnms, live = false, notesByPnm = {}, myRatings = {}, myVotes = {} }: { pnms: PnmRow[] } & LiveProps) {
  const { role } = useApp();
  const liveProps = { live, notesByPnm, myRatings, myVotes };
  return role === 'member'
    ? <MemberRecruitment pnms={pnms} {...liveProps} />
    : <ExecRecruitment pnms={pnms} {...liveProps} />;
}

/* ─────────────────────────── Exec: recruitment chair ─────────────────────────── */

const CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'prospect', label: 'Prospects' },
  { id: 'invited', label: 'Invited' },
  { id: 'interview', label: 'Interview' },
  { id: 'voting', label: 'Voting' },
  { id: 'bid', label: 'Bids' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
] as const;
type Filter = (typeof CHIPS)[number]['id'];

const PNM_GRID = '2.2fr 1.4fr 1.2fr 1fr 32px';

function ExecRecruitment({ pnms: initial, live = false, notesByPnm = {}, myRatings = {}, myVotes = {} }: { pnms: PnmRow[] } & LiveProps) {
  const router = useRouter();
  const [pnms, setPnms] = useState<PnmRow[]>(initial);
  useEffect(() => setPnms(initial), [initial]); // follow server refreshes
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const addPnm = async (input: PnmFormInput) => {
    if (!live) {
      setPnms((x) => [{
        id: `pnm-local-${Date.now()}`, fullName: input.fullName, standing: input.standing,
        major: input.major || 'Undeclared',
        email: `${input.fullName.toLowerCase().replace(/[^a-z]+/g, '.')}@stanford.edu`,
        phone: '', referredBy: input.referredBy, stage: input.stage,
        rating: 0, ratingCount: 0, votesYes: 0, votesNo: 0, eventsAttended: 0,
      }, ...x]);
      setAdding(false);
      return;
    }
    const asInput: PnmInput = {
      fullName: input.fullName, standing: input.standing, major: input.major || 'Undeclared',
      email: `${input.fullName.toLowerCase().replace(/[^a-z]+/g, '.')}@stanford.edu`, phone: '',
      referredBy: input.referredBy, stage: input.stage,
    };
    try {
      await createPnm(asInput);
      router.refresh();
      setAdding(false);
    } catch (err: any) {
      alert(err?.message ?? 'Could not add PNM.');
    }
  };

  const setStage = async (id: string, stage: PnmStage) => {
    if (!live) {
      setPnms((prev) => prev.map((p) => (p.id === id ? { ...p, stage } : p)));
      return;
    }
    try {
      await setPnmStage(id, stage);
      router.refresh();
    } catch (err: any) {
      alert(err?.message ?? 'Could not update stage.');
    }
  };

  const rows = filter === 'all' ? pnms : pnms.filter((p) => p.stage === filter);
  const selected = pnms.find((p) => p.id === selectedId) ?? null;

  const count = (s: PnmStage) => pnms.filter((p) => p.stage === s).length;
  const bids = count('bid') + count('accepted');
  const cards = [
    { val: String(pnms.length), top: 'var(--pkp-primary)', label: 'PNMs in CRM', sub: `${pnms.filter((p) => p.stage !== 'declined' && p.stage !== 'accepted').length} still active` },
    { val: String(count('voting')), top: 'var(--warning-500)', label: 'Up for vote', sub: 'awaiting chapter vote' },
    { val: String(bids), top: 'var(--info-500)', label: 'Bids extended', sub: `${count('accepted')} accepted` },
    { val: String(count('accepted')), top: 'var(--hunter-500)', label: 'New class', sub: 'accepted bids' },
  ];

  const funnelMax = Math.max(1, ...FUNNEL.map((s) => count(s.id)));

  return (
    <>
      <StatCards cards={cards} cols={4} />

      <div className="pkp-card" style={{ padding: 20 }}>
        <h3 className="pkp-h3" style={{ marginBottom: 16 }}>Rush funnel</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FUNNEL.map((s) => {
            const c = count(s.id);
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 110, flexShrink: 0, fontSize: 12.5, color: 'var(--ink-600)', fontWeight: 500 }}>{s.label}</div>
                <div style={{ flex: 1, height: 22, borderRadius: 6, background: 'var(--cream-200)', overflow: 'hidden' }}>
                  <div style={{ width: `${(c / funnelMax) * 100}%`, height: '100%', background: 'var(--pkp-primary)', opacity: 0.18 + 0.82 * (c / funnelMax), borderRadius: 6 }} />
                </div>
                <div className="pkp-mono" style={{ width: 26, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--ink-800)' }}>{c}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Chips options={CHIPS} value={filter} onChange={setFilter} />
        <button className="pkp-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', fontSize: 13.5, boxShadow: 'var(--shadow-sm)' }} onClick={() => setAdding(true)}>
          <span style={{ display: 'inline-flex' }}>{icons.plus}</span>Add PNM
        </button>
      </div>

      <div className="pkp-card" style={{ overflow: 'hidden' }}>
        <div className="pkp-table-head" style={{ gridTemplateColumns: PNM_GRID }}>
          <div className="pkp-col-head">Prospect</div>
          <div className="pkp-col-head">Referred by</div>
          <div className="pkp-col-head">Rating</div>
          <div className="pkp-col-head">Stage</div>
          <div />
        </div>
        {rows.map((p) => (
          <div key={p.id} className="pkp-row" style={{ gridTemplateColumns: PNM_GRID }} onClick={() => setSelectedId(p.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Avatar name={p.fullName} size={36} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>{p.fullName}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{p.standing} · {p.major}</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: p.referredBy ? 'var(--ink-700)' : 'var(--ink-400)' }}>{p.referredBy ?? '—'}</div>
            <div><StarRating rating={p.rating} count={p.ratingCount} /></div>
            <div><StageBadge stage={p.stage} /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--ink-400)' }}>{icons.chevron}</div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-500)' }}>No PNMs in this stage.</div>}
      </div>

      {selected && (
        <PnmDrawer
          pnm={selected} exec live={live} notesByPnm={notesByPnm} myRatings={myRatings} myVotes={myVotes}
          onStage={setStage} onClose={() => setSelectedId(null)}
        />
      )}
      {adding && <PnmFormModal onClose={() => setAdding(false)} onSave={addPnm} />}
    </>
  );
}

function PnmFormModal({ onClose, onSave }: { onClose: () => void; onSave: (input: PnmFormInput) => void }) {
  const [fullName, setFullName] = useState('');
  const [standing, setStanding] = useState('Freshman');
  const [major, setMajor] = useState('');
  const [referredBy, setReferredBy] = useState('');
  const [stage, setStage] = useState<PnmStage>('prospect');

  const canSave = fullName.trim() !== '';
  const submit = () => {
    if (!canSave) return;
    onSave({ fullName: fullName.trim(), standing, major: major.trim(), referredBy: referredBy.trim() || null, stage });
  };

  return (
    <Modal title="Add PNM" sub="New potential new member" onClose={onClose}
      footer={<ModalActions onCancel={onClose} onSave={submit} canSave={canSave} saveLabel="Add PNM" />}>
      <Field label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="First Last" />
      <FieldRow>
        <Select label="Standing" value={standing} onChange={(e) => setStanding(e.target.value)}
          options={['Freshman', 'Sophomore', 'Junior', 'Senior'].map((s) => ({ value: s, label: s }))} />
        <Field label="Major" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="e.g. Economics" />
      </FieldRow>
      <FieldRow>
        <Field label="Referred by (optional)" value={referredBy} onChange={(e) => setReferredBy(e.target.value)} placeholder="Brother's name" />
        <Select label="Stage" value={stage} onChange={(e) => setStage(e.target.value as PnmStage)}
          options={FUNNEL.map((s) => ({ value: s.id, label: s.label }))} />
      </FieldRow>
    </Modal>
  );
}

/* ─────────────────────────── Member: brother ─────────────────────────── */

function MemberRecruitment({ pnms, live = false, notesByPnm = {}, myRatings = {}, myVotes = {} }: { pnms: PnmRow[] } & LiveProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = filter === 'all' ? pnms : pnms.filter((p) => p.stage === filter);
  const selected = pnms.find((p) => p.id === selectedId) ?? null;
  const votingNow = pnms.filter((p) => p.stage === 'voting').length;

  return (
    <>
      <div className="pkp-card" style={{ padding: 18 }}>
        <h3 className="pkp-h3" style={{ marginBottom: 4 }}>Help pick our next class</h3>
        <p style={{ fontSize: 13.5, color: 'var(--ink-600)', margin: 0, lineHeight: 1.55 }}>
          Rate and leave notes on the brothers we&apos;re rushing. {votingNow > 0 ? `${votingNow} PNM${votingNow > 1 ? 's are' : ' is'} up for a vote right now — cast yours.` : 'Nobody is up for a vote at the moment.'}
        </p>
      </div>

      <Chips options={CHIPS} value={filter} onChange={setFilter} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
        {rows.map((p) => (
          <div key={p.id} className="pkp-card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => setSelectedId(p.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={p.fullName} size={42} fontSize={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink-900)' }}>{p.fullName}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{p.standing} · {p.major}</div>
              </div>
              <StageBadge stage={p.stage} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <StarRating rating={p.rating} count={p.ratingCount} />
              {p.referredBy && <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>via {p.referredBy}</span>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="pkp-card" style={{ padding: 28, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-500)', gridColumn: '1 / -1' }}>No PNMs in this stage.</div>}
      </div>

      {selected && (
        <PnmDrawer pnm={selected} live={live} notesByPnm={notesByPnm} myRatings={myRatings} myVotes={myVotes} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}

/* ─────────────────────────── Shared detail drawer ─────────────────────────── */

function PnmDrawer({ pnm: p, exec, live = false, notesByPnm = {}, myRatings = {}, myVotes = {}, onStage, onClose }: {
  pnm: PnmRow; exec?: boolean; onStage?: (id: string, stage: PnmStage) => void; onClose: () => void;
} & LiveProps) {
  const { role } = useApp();
  const router = useRouter();
  const [myRating, setMyRating] = useState(() => (live ? myRatings[p.id] ?? 0 : 0));
  useEffect(() => { if (live) setMyRating(myRatings[p.id] ?? 0); }, [live, myRatings, p.id]);
  const [myVote, setMyVote] = useState<'yes' | 'no' | null>(() => (live ? myVotes[p.id] ?? null : null));
  useEffect(() => { if (live) setMyVote(myVotes[p.id] ?? null); }, [live, myVotes, p.id]);
  const [notes, setNotes] = useState<PnmNote[]>(() => (live ? notesByPnm[p.id] ?? [] : pnmNotes(p.id, p.ratingCount)));
  useEffect(() => { if (live) setNotes(notesByPnm[p.id] ?? []); }, [live, notesByPnm, p.id]);
  const [draft, setDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);

  const rate = (n: number) => {
    setMyRating(n);
    if (live) ratePnm(p.id, n).then(() => router.refresh()).catch((err: any) => alert(err?.message ?? 'Could not save rating.'));
  };

  const castVote = (v: 'yes' | 'no') => {
    const next = myVote === v ? null : v;
    setMyVote(next);
    if (live) votePnm(p.id, next).then(() => router.refresh()).catch((err: any) => alert(err?.message ?? 'Could not save vote.'));
  };

  const addNote = async () => {
    if (!draft.trim()) return;
    if (!live) {
      setNotes((prev) => [{ id: `note-new-${Date.now()}`, author: MOCK_USER[role].name, text: draft.trim(), when: NOW.toISOString() }, ...prev]);
      setDraft('');
      return;
    }
    setNoteBusy(true);
    try {
      await addPnmNote(p.id, draft.trim());
      router.refresh();
      setDraft('');
    } catch (err: any) {
      alert(err?.message ?? 'Could not add note.');
    } finally {
      setNoteBusy(false);
    }
  };

  // In live mode p.votesYes/votesNo already reflect the DB (including this
  // user's vote after a refresh) — the mock path overlays myVote locally
  // since p never updates there.
  const votesYes = live ? p.votesYes : p.votesYes + (myVote === 'yes' ? 1 : 0);
  const votesNo = live ? p.votesNo : p.votesNo + (myVote === 'no' ? 1 : 0);

  const inVoting = p.stage === 'voting' || p.stage === 'bid';
  const next = nextStage(p.stage);
  const detail = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--ink-800)', fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );

  return (
    <>
      <div className="pkp-scrim" onClick={onClose} />
      <div className="pkp-drawer">
        <div style={{ padding: 22, borderBottom: '1px solid var(--cream-300)', display: 'flex', alignItems: 'flex-start', gap: 16, background: 'var(--white)' }}>
          <Avatar name={p.fullName} size={58} fontSize={20} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600, color: 'var(--ink-900)' }}>{p.fullName}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--ink-500)', marginTop: 3 }}>{p.standing} · {p.major}</div>
            <div style={{ marginTop: 8 }}><StageBadge stage={p.stage} /></div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-500)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="pkp-card" style={{ padding: 16 }}>
            <div className="pkp-col-head" style={{ marginBottom: 12 }}>Details</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {detail('Referred by', p.referredBy ?? 'Walk-up')}
              {detail('Rush events', `${p.eventsAttended} attended`)}
              {detail('Chapter rating', <StarRating rating={p.rating} count={p.ratingCount} />)}
              {detail('Email', p.email)}
              {detail('Phone', p.phone)}
            </div>
          </div>

          <div className="pkp-card" style={{ padding: 16 }}>
            <div className="pkp-col-head" style={{ marginBottom: 12 }}>Your rating</div>
            <StarInput value={myRating} onChange={rate} />
            <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 8 }}>{myRating ? `You rated ${myRating}/5 — counts toward the chapter average.` : 'Tap to rate this PNM.'}</div>
          </div>

          {inVoting && (
            <div className="pkp-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div className="pkp-col-head">Chapter vote</div>
                <span className="pkp-mono" style={{ fontSize: 12.5, color: 'var(--ink-600)' }}>{votesYes}–{votesNo}</span>
              </div>
              <VoteBar yes={votesYes} no={votesNo} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-500)', marginTop: 7 }}>
                <span>{votesYes} bid</span>
                <span>{votesNo} pass</span>
              </div>
              {!exec && (
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => castVote('yes')} className={myVote === 'yes' ? 'pkp-btn-primary' : 'pkp-btn-ghost'} style={{ flex: 1, height: 38, fontSize: 13 }}>Bid</button>
                  <button onClick={() => castVote('no')} className={myVote === 'no' ? 'pkp-btn-primary' : 'pkp-btn-ghost'} style={{ flex: 1, height: 38, fontSize: 13 }}>Pass</button>
                </div>
              )}
            </div>
          )}

          <div className="pkp-card" style={{ padding: 16 }}>
            <div className="pkp-col-head" style={{ marginBottom: 12 }}>Notes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note about this PNM…"
                style={{ width: '100%', minHeight: 56, resize: 'vertical', border: '1px solid var(--cream-400)', borderRadius: 'var(--radius-md)', background: 'var(--white)', padding: '9px 11px', fontSize: 13, color: 'var(--ink-800)', fontFamily: 'var(--font-sans)', outline: 'none' }} />
              <button className="pkp-btn-primary" disabled={!draft.trim() || noteBusy} onClick={addNote}
                style={{ alignSelf: 'flex-start', height: 34, padding: '0 16px', fontSize: 12.5, opacity: draft.trim() && !noteBusy ? 1 : 0.5, cursor: draft.trim() && !noteBusy ? 'pointer' : 'not-allowed' }}>
                {noteBusy ? 'Adding…' : 'Add note'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
              {notes.map((n) => (
                <div key={n.id} style={{ padding: '11px 0', borderTop: '1px solid var(--cream-200)' }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-700)', lineHeight: 1.5 }}>{n.text}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 4 }}>{n.author} · {relativeDay(n.when, NOW)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {exec && (
          <div style={{ padding: '16px 22px', borderTop: '1px solid var(--cream-300)', background: 'var(--white)', display: 'flex', gap: 10 }}>
            {p.stage === 'accepted' ? (
              <div style={{ flex: 1, textAlign: 'center', fontSize: 13.5, fontWeight: 600, color: 'var(--success-600)' }}>🎉 Joined the chapter</div>
            ) : p.stage === 'declined' ? (
              <button className="pkp-btn-ghost" style={{ flex: 1, height: 42, fontSize: 13.5 }} onClick={() => onStage?.(p.id, 'interview')}>Reopen candidate</button>
            ) : (
              <>
                {p.stage === 'bid'
                  ? <button className="pkp-btn-primary" style={{ flex: 1, height: 42, fontSize: 13.5 }} onClick={() => onStage?.(p.id, 'accepted')}>Mark accepted</button>
                  : next && <button className="pkp-btn-primary" style={{ flex: 1, height: 42, fontSize: 13.5 }} onClick={() => onStage?.(p.id, next)}>Advance to {STAGE_META[next].short}</button>}
                <button className="pkp-btn-ghost" style={{ flex: 1, height: 42, fontSize: 13.5 }} onClick={() => onStage?.(p.id, 'declined')}>Decline</button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
