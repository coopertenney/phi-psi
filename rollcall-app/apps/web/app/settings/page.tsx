"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { getOrCreateDefaultRoster } from "@/lib/roster";
import { parseRosterCsv, localDateString } from "@rollcall/shared";
import type { Person, ExcusalRule, StudyAbroadPeriod } from "@rollcall/shared";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SettingsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [rosterId, setRosterId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [rules, setRules] = useState<ExcusalRule[]>([]);
  const [periods, setPeriods] = useState<StudyAbroadPeriod[]>([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const [ruleForm, setRuleForm] = useState({
    person_id: "",
    day_of_week: 0,
    reason: "",
    start_date: localDateString(),
    end_date: "",
  });
  const [periodForm, setPeriodForm] = useState({
    person_id: "",
    start_date: "",
    end_date: "",
    reason: "",
  });

  async function reload(rid: string) {
    const [{ data: p }, { data: r }, { data: s }] = await Promise.all([
      supabase.from("people").select("*").eq("roster_id", rid).order("sort_order"),
      supabase.from("excusal_rules").select("*, people!inner(roster_id)").eq("people.roster_id", rid),
      supabase
        .from("study_abroad_periods")
        .select("*, people!inner(roster_id)")
        .eq("people.roster_id", rid),
    ]);
    setPeople((p as Person[]) ?? []);
    setRules((r as ExcusalRule[]) ?? []);
    setPeriods((s as StudyAbroadPeriod[]) ?? []);
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      const roster = await getOrCreateDefaultRoster();
      setRosterId(roster.id);
      await reload(roster.id);
    })();
  }, [user]);

  async function addPerson() {
    if (!rosterId || !newPersonName.trim()) return;
    const nextOrder = people.length > 0 ? Math.max(...people.map((p) => p.sort_order)) + 1 : 0;
    await supabase.from("people").insert({ roster_id: rosterId, name: newPersonName.trim(), sort_order: nextOrder });
    setNewPersonName("");
    await reload(rosterId);
  }

  async function removePerson(id: string) {
    if (!rosterId) return;
    if (!confirm("Remove this person? This deletes their attendance history too.")) return;
    await supabase.from("people").delete().eq("id", id);
    await reload(rosterId);
  }

  async function movePerson(id: string, direction: -1 | 1) {
    if (!rosterId) return;
    const idx = people.findIndex((p) => p.id === id);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= people.length) return;
    const a = people[idx];
    const b = people[swapIdx];
    await Promise.all([
      supabase.from("people").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("people").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    await reload(rosterId);
  }

  async function importCsv() {
    if (!rosterId || !csvText.trim()) return;
    const parsed = parseRosterCsv(csvText);
    if (parsed.length === 0) {
      setImportMsg("No rows found.");
      return;
    }
    const base = people.length > 0 ? Math.max(...people.map((p) => p.sort_order)) + 1 : 0;
    await supabase.from("people").insert(
      parsed.map((row, i) => ({
        roster_id: rosterId,
        name: row.name,
        sort_order: base + i,
      }))
    );
    setCsvText("");
    setImportMsg(`Imported ${parsed.length} people.`);
    await reload(rosterId);
  }

  async function addRule() {
    if (!ruleForm.person_id) return;
    await supabase.from("excusal_rules").insert({
      person_id: ruleForm.person_id,
      day_of_week: ruleForm.day_of_week,
      reason: ruleForm.reason || null,
      start_date: ruleForm.start_date,
      end_date: ruleForm.end_date || null,
    });
    setRuleForm({ ...ruleForm, reason: "" });
    if (rosterId) await reload(rosterId);
  }

  async function removeRule(id: string) {
    await supabase.from("excusal_rules").delete().eq("id", id);
    if (rosterId) await reload(rosterId);
  }

  async function addPeriod() {
    if (!periodForm.person_id || !periodForm.start_date || !periodForm.end_date) return;
    await supabase.from("study_abroad_periods").insert({
      person_id: periodForm.person_id,
      start_date: periodForm.start_date,
      end_date: periodForm.end_date,
      reason: periodForm.reason || null,
    });
    setPeriodForm({ person_id: "", start_date: "", end_date: "", reason: "" });
    if (rosterId) await reload(rosterId);
  }

  async function removePeriod(id: string) {
    await supabase.from("study_abroad_periods").delete().eq("id", id);
    if (rosterId) await reload(rosterId);
  }

  function personName(id: string) {
    return people.find((p) => p.id === id)?.name ?? "?";
  }

  if (authLoading || !rosterId) return <main className="p-6">Loading…</main>;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-6 pb-24">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm underline">
          ← Home
        </Link>
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Import roster CSV</h2>
        <p className="text-xs text-gray-500">
          Paste CSV with a <code>name</code> column (optionally <code>order</code>). Adds people to the end of the
          current list.
        </p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={"name,order\nJane Doe,1\nJohn Smith,2"}
          rows={4}
          className="rounded border px-3 py-2 font-mono text-sm"
        />
        <button onClick={importCsv} className="self-start rounded bg-black px-3 py-2 text-sm text-white">
          Import
        </button>
        {importMsg && <p className="text-sm text-green-700">{importMsg}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">People ({people.length})</h2>
        <div className="flex gap-2">
          <input
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
            placeholder="Add person"
            className="flex-1 rounded border px-3 py-2 text-sm"
          />
          <button onClick={addPerson} className="rounded bg-black px-3 py-2 text-sm text-white">
            Add
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {people.map((p, i) => (
            <li key={p.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>{p.name}</span>
              <span className="flex gap-2">
                <button onClick={() => movePerson(p.id, -1)} disabled={i === 0} className="disabled:opacity-30">
                  ↑
                </button>
                <button
                  onClick={() => movePerson(p.id, 1)}
                  disabled={i === people.length - 1}
                  className="disabled:opacity-30"
                >
                  ↓
                </button>
                <button onClick={() => removePerson(p.id)} className="text-red-600">
                  remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Recurring excused absences</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={ruleForm.person_id}
            onChange={(e) => setRuleForm({ ...ruleForm, person_id: e.target.value })}
            className="rounded border px-2 py-1"
          >
            <option value="">Person…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={ruleForm.day_of_week}
            onChange={(e) => setRuleForm({ ...ruleForm, day_of_week: Number(e.target.value) })}
            className="rounded border px-2 py-1"
          >
            {DAYS.map((d, i) => (
              <option key={i} value={i}>
                Every {d}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={ruleForm.start_date}
            onChange={(e) => setRuleForm({ ...ruleForm, start_date: e.target.value })}
            className="rounded border px-2 py-1"
          />
          <input
            type="date"
            value={ruleForm.end_date}
            onChange={(e) => setRuleForm({ ...ruleForm, end_date: e.target.value })}
            placeholder="end (optional)"
            className="rounded border px-2 py-1"
          />
          <input
            value={ruleForm.reason}
            onChange={(e) => setRuleForm({ ...ruleForm, reason: e.target.value })}
            placeholder="reason (optional)"
            className="rounded border px-2 py-1"
          />
          <button onClick={addRule} className="rounded bg-black px-3 py-1 text-white">
            Add
          </button>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded border px-3 py-2">
              <span>
                {personName(r.person_id)} — every {DAYS[r.day_of_week]} from {r.start_date}
                {r.end_date ? ` to ${r.end_date}` : ""}
                {r.reason ? ` (${r.reason})` : ""}
              </span>
              <button onClick={() => removeRule(r.id)} className="text-red-600">
                remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Study abroad exclusions</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={periodForm.person_id}
            onChange={(e) => setPeriodForm({ ...periodForm, person_id: e.target.value })}
            className="rounded border px-2 py-1"
          >
            <option value="">Person…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={periodForm.start_date}
            onChange={(e) => setPeriodForm({ ...periodForm, start_date: e.target.value })}
            className="rounded border px-2 py-1"
          />
          <input
            type="date"
            value={periodForm.end_date}
            onChange={(e) => setPeriodForm({ ...periodForm, end_date: e.target.value })}
            className="rounded border px-2 py-1"
          />
          <input
            value={periodForm.reason}
            onChange={(e) => setPeriodForm({ ...periodForm, reason: e.target.value })}
            placeholder="reason (optional)"
            className="rounded border px-2 py-1"
          />
          <button onClick={addPeriod} className="rounded bg-black px-3 py-1 text-white">
            Add
          </button>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {periods.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded border px-3 py-2">
              <span>
                {personName(s.person_id)} — {s.start_date} to {s.end_date}
                {s.reason ? ` (${s.reason})` : ""}
              </span>
              <button onClick={() => removePeriod(s.id)} className="text-red-600">
                remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
