import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import RollCallScreen from "./screens/RollCallScreen";

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <View style={styles.container}>
      {user === undefined ? null : !user ? (
        <LoginScreen />
      ) : sessionId ? (
        <RollCallScreen sessionId={sessionId} onBack={() => setSessionId(null)} />
      ) : (
        <HomeScreen onOpenSession={setSessionId} />
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
});
