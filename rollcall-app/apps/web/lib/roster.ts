import { supabase } from "./supabase";
import type { Roster } from "@rollcall/shared";

/** v1 supports a single shared roster; fetch it or create it on first use. */
export async function getOrCreateDefaultRoster(): Promise<Roster> {
  const { data: existing, error: fetchError } = await supabase
    .from("rosters")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return existing as Roster;

  const { data: created, error: createError } = await supabase
    .from("rosters")
    .insert({ name: "Roster" })
    .select("*")
    .single();

  if (createError) throw createError;
  return created as Roster;
}
