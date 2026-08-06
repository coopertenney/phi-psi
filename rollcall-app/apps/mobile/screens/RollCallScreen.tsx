import { useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import { supabase } from "../lib/supabase";
import { nextAttendanceState } from "@rollcall/shared";
import type { Attendance, Person, Session } from "@rollcall/shared";

interface Row {
  person: Person;
  attendance: Attendance;
}

export default function RollCallScreen({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewMode, setReviewMode] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sessionRow } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
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
  }, [sessionId]);

  const allMarked = rows.length > 0 && rows.every((r) => r.attendance.status !== null);

  async function tap(row: Row) {
    if (reviewMode && row.attendance.status !== "present") return;
    if (reviewMode) {
      // review mode: cycle late -> left early -> clear, for present rows only
      const a = row.attendance;
      const patch = !a.arrived_late
        ? { arrived_late: true }
        : !a.left_early
          ? { left_early: true }
          : { arrived_late: false, left_early: false, arrival_time: null, departure_time: null };
      setRows((prev) =>
        prev.map((r) => (r.attendance.id === a.id ? { ...r, attendance: { ...r.attendance, ...patch } } : r))
      );
      await supabase.from("attendance").update(patch).eq("id", a.id);
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

  if (loading || !session) {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.link}>← Home</Text>
        </Pressable>
        <Text style={styles.title}>{session.date}</Text>
      </View>

      {allMarked && (
        <Pressable style={styles.toggle} onPress={() => setReviewMode((v) => !v)}>
          <Text>{reviewMode ? "Back to marking" : "Review mode (tap present rows: late → left early → clear)"}</Text>
        </Pressable>
      )}
      {!allMarked && <Text style={styles.hint}>Mark everyone present or absent to unlock review mode.</Text>}

      <FlatList
        data={rows}
        keyExtractor={(r) => r.attendance.id}
        renderItem={({ item }) => {
          const a = item.attendance;
          const bg =
            a.status === "present" ? "#22c55e" : a.status === "absent" ? "#ef4444" : "#f3f4f6";
          const textColor = a.status ? "#fff" : "#000";
          const badges = [
            a.excused && "excused",
            a.arrived_late && "late",
            a.left_early && "left early",
          ].filter(Boolean) as string[];
          return (
            <Pressable onPress={() => tap(item)} style={[styles.row, { backgroundColor: bg }]}>
              <Text style={{ color: textColor }}>{item.person.name}</Text>
              {badges.length > 0 && (
                <Text style={{ color: textColor, fontSize: 12 }}>{badges.join(" · ")}</Text>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, backgroundColor: "#fff" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "600" },
  link: { color: "#2563eb" },
  toggle: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 10 },
  hint: { color: "#888", fontSize: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 6,
    marginBottom: 8,
  },
});
