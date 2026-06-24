"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  notice?: string;
}

function safeNext(next: FormDataEntryValue | null): string {
  // Only allow same-app relative paths (no protocol-relative // or absolute URLs).
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // Access establishment is controlled (HIPAA §164.308(a)(4)): self-signup is OFF
  // unless explicitly enabled. Otherwise anyone could self-provision an org_admin
  // account. Enable only for demo/dev, or replace with an invite flow.
  if (process.env.ALLOW_SIGNUP !== "true") {
    return { error: "Sign-ups are disabled. Ask your administrator to create your account." };
  }
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  // If email confirmation is enabled in Supabase, there's no session yet.
  if (!data.session) {
    return { notice: "Account created. Check your email to confirm, then sign in." };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
