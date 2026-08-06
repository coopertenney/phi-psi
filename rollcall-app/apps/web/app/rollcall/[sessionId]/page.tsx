"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { nextAttendanceState } from "@rollcall/shared";
import type { Attendance, Person, Session } from "@rollcall/shared";

interface Row {
  person: Person;
  attendance: Attendance;
}

export default function RollCallPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewMode, setReviewMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: sessionRow } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      setSession(sessionRow as Session);

      const { data: attendanceRows } = await supabase
        .from("attendance")
        .select("*, people(*)")
        .eq("session_id", sessionId);

      const built = ((attendanceRows as (Attendance & { people: Person })[]) ?? [])
        .map((a) => ({ person: a.people, attendance: { ...a, people: undefined } as Attendance }))
        .sort((a, b) => a.person.sort_order - b.person.sort_order);
      setRows(built);
      setLoading(false);
    })();
  }, [user, sessionId]);

  const allMarked = rows.length > 0 && rows.every((r) => r.attendance.status !== null);

  async function tap(row: Row) {
    if (reviewMode && row.attendance.status !== "present") return;
    if (reviewMode) {
      setEditingId(editingId === row.attendance.id ? null : row.attendance.id);
      return;
    }
    const update = nextAttendanceState(row.attendance);
    setRows((prev) =>
      prev.map((r) =>
        r.attendance.id === row.attendance.id ? { ...r, attendance: { ...r.attendance, ...update } } : r
      )
    );
    await supabase.from("attendance").update(update).eq("id", row.attendance.id);
  }

  async function setLate(row: Row, time: string) {
    const patch = { arrived_late: time !== "", arrival_time: time || null };
    setRows((prev) =>
      prev.map((r) => (r.attendance.id === row.attendance.id ? { ...r, attendance: { ...r.attendance, ...patch } } : r))
    );
    await supabase.from("attendance").update(patch).eq("id", row.attendance.id);
  }

  async function setLeftEarly(row: Row, time: string) {
    const patch = { left_early: time !== "", departure_time: time || null };
    setRows((prev) =>
      prev.map((r) => (r.attendance.id === row.attendance.id ? { ...r, attendance: { ...r.attendance, ...patch } } : r))
    );
    await supabase.from("attendance").update(patch).eq("id", row.attendance.id);
  }

  async function clearModifier(row: Row, field: "late" | "early") {
    const patch =
      field === "late"
        ? { arrived_late: false, arrival_time: null }
        : { left_early: false, departure_time: null };
    setRows((prev) =>
      prev.map((r) => (r.attendance.id === row.attendance.id ? { ...r, attendance: { ...r.attendance, ...patch } } : r))
    );
    await supabase.from("attendance").update(patch).eq("id", row.attendance.id);
  }

  if (authLoading || loading) return <main className="p-6">Loading…</main>;
  if (!session) return <main className="p-6">Session not found.</main>;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm underline">
          ← Home
        </Link>
        <h1 className="text-lg font-semibold">{session.date}</h1>
      </div>

      {allMarked && (
        <button
          onClick={() => setReviewMode((v) => !v)}
          className="rounded border px-3 py-2 text-sm"
        >
          {reviewMode ? "Back to marking" : "Review mode (late / left early)"}
        </button>
      )}
      {!allMarked && (
        <p className="text-xs text-gray-500">Mark everyone present or absent to unlock review mode.</p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const a = row.attendance;
          const bg =
            a.status === "present"
              ? "bg-green-500 text-white"
              : a.status === "absent"
                ? "bg-red-500 text-white"
                : "bg-gray-100";
          return (
            <li key={a.id} className="flex flex-col gap-2">
              <button
                onClick={() => tap(row)}
                className={`flex items-center justify-between rounded px-4 py-3 text-left ${bg}`}
              >
                <span>{row.person.name}</span>
                <span className="flex gap-1 text-xs">
                  {a.excused && <span className="rounded bg-black/20 px-2 py-0.5">excused</span>}
                  {a.arrived_late && <span className="rounded bg-black/20 px-2 py-0.5">late</span>}
                  {a.left_early && <span className="rounded bg-black/20 px-2 py-0.5">left early</span>}
                </span>
              </button>

              {reviewMode && editingId === a.id && a.status === "present" && (
                <div className="flex flex-col gap-2 rounded border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <label className="w-24">Arrived late</label>
                    <input
                      type="time"
                      defaultValue={a.arrival_time ?? ""}
                      onChange={(e) => setLate(row, e.target.value)}
                      className="rounded border px-2 py-1"
                    />
                    {a.arrived_late && (
                      <button onClick={() => clearModifier(row, "late")} className="text-xs text-gray-500 underline">
                        clear
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="w-24">Left early</label>
                    <input
                      type="time"
                      defaultValue={a.departure_time ?? ""}
                      onChange={(e) => setLeftEarly(row, e.target.value)}
                      className="rounded border px-2 py-1"
                    />
                    {a.left_early && (
                      <button onClick={() => clearModifier(row, "early")} className="text-xs text-gray-500 underline">
                        clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
