"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { getOrCreateDefaultRoster } from "@/lib/roster";
import { buildInitialAttendanceSeeds, localDateString } from "@rollcall/shared";
import type { Person, Session, StudyAbroadPeriod, ExcusalRule } from "@rollcall/shared";

export default function HomePage() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [rosterId, setRosterId] = useState<string | null>(null);
  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const roster = await getOrCreateDefaultRoster();
      setRosterId(roster.id);

      const { count } = await supabase
        .from("people")
        .select("*", { count: "exact", head: true })
        .eq("roster_id", roster.id);
      setPeopleCount(count ?? 0);

      const { data: sessionRows } = await supabase
        .from("sessions")
        .select("*")
        .eq("roster_id", roster.id)
        .order("date", { ascending: false })
        .limit(10);
      setSessions((sessionRows as Session[]) ?? []);
    })();
  }, [user]);

  async function startNewRollCall() {
    if (!rosterId) return;
    setCreating(true);
    setError(null);
    try {
      const today = localDateString();

      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .insert({ roster_id: rosterId, date: today })
        .select("*")
        .single();
      if (sessionError) throw sessionError;

      const [{ data: people, error: peopleError }, { data: studyAbroad }, { data: excusalRules }] =
        await Promise.all([
          supabase.from("people").select("*").eq("roster_id", rosterId),
          supabase
            .from("study_abroad_periods")
            .select("*, people!inner(roster_id)")
            .eq("people.roster_id", rosterId),
          supabase
            .from("excusal_rules")
            .select("*, people!inner(roster_id)")
            .eq("people.roster_id", rosterId),
        ]);
      if (peopleError) throw peopleError;

      const seeds = buildInitialAttendanceSeeds(
        (people as Person[]) ?? [],
        today,
        (studyAbroad as StudyAbroadPeriod[]) ?? [],
        (excusalRules as ExcusalRule[]) ?? []
      );

      if (seeds.length > 0) {
        const { error: attendanceError } = await supabase.from("attendance").insert(
          seeds.map((s) => ({
            session_id: session.id,
            person_id: s.person_id,
            status: s.status,
            excused: s.excused,
          }))
        );
        if (attendanceError) throw attendanceError;
      }

      router.push(`/rollcall/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start roll call");
      setCreating(false);
    }
  }

  if (authLoading || peopleCount === null) {
    return <main className="p-6">Loading…</main>;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Roll Call</h1>
        <button
          onClick={() => supabase.auth.signOut().then(() => router.replace("/login"))}
          className="text-sm text-gray-500 underline"
        >
          Sign out
        </button>
      </div>

      {peopleCount === 0 ? (
        <div className="rounded border border-dashed p-4 text-sm">
          No people on the roster yet.{" "}
          <Link href="/settings" className="underline">
            Import your roster CSV in Settings
          </Link>{" "}
          to get started.
        </div>
      ) : (
        <button
          onClick={startNewRollCall}
          disabled={creating}
          className="rounded bg-black px-4 py-3 text-lg text-white disabled:opacity-50"
        >
          {creating ? "Starting…" : "New Roll Call"}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-4 text-sm">
        <Link href="/settings" className="underline">
          Settings
        </Link>
        <Link href="/reports" className="underline">
          Reports
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-gray-500">Recent sessions</h2>
        <ul className="flex flex-col gap-1">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/rollcall/${s.id}`} className="underline">
                {s.date}
                {s.label ? ` — ${s.label}` : ""}
              </Link>
            </li>
          ))}
          {sessions.length === 0 && <li className="text-sm text-gray-400">None yet</li>}
        </ul>
      </div>
    </main>
  );
}
