import { useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import { supabase } from "../lib/supabase";
import { getOrCreateDefaultRoster } from "../lib/roster";
import { buildInitialAttendanceSeeds, localDateString } from "@rollcall/shared";
import type { Person, Session, StudyAbroadPeriod, ExcusalRule } from "@rollcall/shared";

export default function HomeScreen({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const [rosterId, setRosterId] = useState<string | null>(null);
  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

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

      onOpenSession(session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start roll call");
    } finally {
      setCreating(false);
    }
  }

  if (peopleCount === null) {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Roll Call</Text>

      {peopleCount === 0 ? (
        <Text style={styles.hint}>No people on the roster yet. Import your roster CSV from the web app first.</Text>
      ) : (
        <Pressable style={styles.button} onPress={startNewRollCall} disabled={creating}>
          <Text style={styles.buttonText}>{creating ? "Starting…" : "New Roll Call"}</Text>
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.sectionTitle}>Recent sessions</Text>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        ListEmptyComponent={<Text style={styles.hint}>None yet</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpenSession(item.id)} style={styles.sessionRow}>
            <Text>
              {item.date}
              {item.label ? ` — ${item.label}` : ""}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "600" },
  button: { backgroundColor: "#000", borderRadius: 6, padding: 16, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16 },
  error: { color: "#dc2626" },
  hint: { color: "#888" },
  sectionTitle: { color: "#888", fontSize: 13, marginTop: 12 },
  sessionRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee" },
});
