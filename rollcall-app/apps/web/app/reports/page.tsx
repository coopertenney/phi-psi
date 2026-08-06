"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { getOrCreateDefaultRoster } from "@/lib/roster";
import { computeAttendancePercent, buildAttendanceExportCsv } from "@rollcall/shared";
import type { Person, Attendance, Session } from "@rollcall/shared";

export default function ReportsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ person: Person; percent: number | null; total: number }[]>([]);
  const [exportRows, setExportRows] = useState<Parameters<typeof buildAttendanceExportCsv>[0]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const roster = await getOrCreateDefaultRoster();

      const { data: people } = await supabase
        .from("people")
        .select("*")
        .eq("roster_id", roster.id)
        .order("sort_order");

      const { data: sessions } = await supabase
        .from("sessions")
        .select("*")
        .eq("roster_id", roster.id);

      // Supabase caps rows per request (commonly 1000) — page through the full history
      // instead of trusting a single select to return everything.
      const PAGE_SIZE = 1000;
      const attendanceList: (Attendance & { people: { name: string } })[] = [];
      for (let page = 0; ; page++) {
        const { data: batch } = await supabase
          .from("attendance")
          .select("*, people!inner(roster_id, name)")
          .eq("people.roster_id", roster.id)
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        const rows = (batch as (Attendance & { people: { name: string } })[]) ?? [];
        attendanceList.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }

      const peopleList = (people as Person[]) ?? [];
      const sessionsById = new Map(((sessions as Session[]) ?? []).map((s) => [s.id, s]));

      const byPerson = new Map<string, Attendance[]>();
      for (const a of attendanceList) {
        const arr = byPerson.get(a.person_id) ?? [];
        arr.push(a);
        byPerson.set(a.person_id, arr);
      }

      setStats(
        peopleList.map((p) => {
          const rows = byPerson.get(p.id) ?? [];
          return { person: p, percent: computeAttendancePercent(rows), total: rows.length };
        })
      );

      setExportRows(
        attendanceList.map((a) => {
          const session = sessionsById.get(a.session_id);
          return {
            date: session?.date ?? "",
            label: session?.label ?? null,
            person_name: a.people.name,
            status: a.status,
            excused: a.excused,
            arrived_late: a.arrived_late,
            arrival_time: a.arrival_time,
            left_early: a.left_early,
            departure_time: a.departure_time,
          };
        })
      );

      setLoading(false);
    })();
  }, [user]);

  function downloadCsv() {
    const csv = buildAttendanceExportCsv(exportRows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading || loading) return <main className="p-6">Loading…</main>;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm underline">
          ← Home
        </Link>
        <h1 className="text-lg font-semibold">Reports</h1>
      </div>

      <button onClick={downloadCsv} className="self-start rounded bg-black px-3 py-2 text-sm text-white">
        Export attendance CSV
      </button>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1">Person</th>
            <th className="py-1">Attendance %</th>
            <th className="py-1">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(({ person, percent, total }) => (
            <tr key={person.id} className="border-t">
              <td className="py-2">{person.name}</td>
              <td className="py-2">{percent === null ? "—" : `${Math.round(percent * 100)}%`}</td>
              <td className="py-2">{total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
