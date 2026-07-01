"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  notice?: string;
}

/**
 * The origin the request actually came in on, so confirmation emails link back to
 * the deployed site (not Supabase's localhost Site URL). Prefers an explicit
 * NEXT_PUBLIC_SITE_URL, else derives from the forwarded host/proto. NOTE: the
 * target must also be allow-listed in Supabase → Auth → URL Configuration.
 */
async function requestOrigin(): Promise<string | undefined> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("host");
  if (!host) return undefined;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Shared open-redirect guard. Async because this is a "use server" module: every
// export is registered as a server action, which must be async. Behavior is the
// same same-app-relative-path check used inline elsewhere.
export async function safeNext(next: FormDataEntryValue | null): Promise<string> {
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
  // Uniform message for EVERY failure (bad password, unknown email, unconfirmed) so
  // the response can't be used to enumerate which accounts exist. Detail is logged
  // server-side only.
  if (error) {
    console.error("sign-in failed:", error.message);
    return { error: "Invalid email or password." };
  }

  redirect(await safeNext(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // Self-signup is ON by default. New accounts are provisioned with the
  // least-privileged "broker" role (own clients only) — org_admin/security are
  // granted solely to hand-listed emails (ORG_ADMIN_EMAILS/SECURITY_EMAILS), so
  // self-signup can't escalate. Set ALLOW_SIGNUP=false to gate behind invites.
  if (process.env.ALLOW_SIGNUP === "false") {
    return { error: "Sign-ups are disabled. Ask your administrator to create your account." };
  }
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("name") ?? "").trim();
  const agency = String(formData.get("agency") ?? "").trim();
  if (!email || !password) return { error: "Email and password are required." };
  if (!fullName || !agency) return { error: "Your name and broker agency are required." };

  const supabase = await getServerSupabase();
  // Point the confirmation link at the deployed origin (not Supabase's Site URL,
  // which may still be localhost). Stash name + agency in user metadata;
  // first-login provisioning (resolveBroker) reads them to attach the broker.
  const origin = await requestOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, agency },
      ...(origin ? { emailRedirectTo: `${origin}/login` } : {}),
    },
  });
  // One generic message for ALL sign-up errors so "User already registered" can't
  // be distinguished from other failures (account enumeration). Logged server-side.
  if (error) {
    console.error("sign-up failed:", error.message);
    return { error: "We couldn't complete sign-up. Check your details, or ask your administrator to create your account." };
  }

  // If email confirmation is enabled in Supabase, there's no session yet.
  if (!data.session) {
    return { notice: "Account created. Check your email to confirm, then sign in." };
  }
  redirect(await safeNext(formData.get("next")));
}

/**
 * Single entry point the form binds to, so the dispatched action never depends on
 * a swapped function reference. Branches on the hidden `mode` field set by the UI.
 */
export async function submitAuth(prev: AuthState, formData: FormData): Promise<AuthState> {
  return String(formData.get("mode")) === "signup" ? signUp(prev, formData) : signIn(prev, formData);
}

export async function signOut(): Promise<void> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
