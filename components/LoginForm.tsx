"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "@/app/login/actions";

export default function LoginForm({ next, allowSignup }: { next: string; allowSignup: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {});

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
      {allowSignup && (
        <div className="mb-5 inline-flex rounded-md border border-slate-200 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded px-3 py-1 font-medium ${mode === "signin" ? "bg-accent text-white" : "text-slate-600"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded px-3 py-1 font-medium ${mode === "signup" ? "bg-accent text-white" : "text-slate-600"}`}
          >
            Create account
          </button>
        </div>
      )}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Email</label>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Password</label>
          <input
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
        {state.notice && <p className="text-sm text-emerald-700">{state.notice}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
