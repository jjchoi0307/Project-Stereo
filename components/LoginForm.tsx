"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "@/app/login/actions";
import Spinner from "@/components/ui/Spinner";

export default function LoginForm({
  next,
  allowSignup,
  initialMode = "signin",
}: {
  next: string;
  allowSignup: boolean;
  initialMode?: "signin" | "signup";
}) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {});

  const isSignup = mode === "signup";

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-[26px]">
        <h2 className="mb-[18px] text-[15px] font-semibold text-ink">
          {isSignup ? "Create your account" : "Sign in"}
        </h2>

        {state.notice && (
          <div className="mb-3.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] leading-[1.45] text-emerald-800">
            {state.notice}
          </div>
        )}
        {state.error && (
          <div className="mb-3.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-800">
            {state.error}
          </div>
        )}

        <form action={formAction}>
          <input type="hidden" name="next" value={next} />
          {isSignup && (
            <>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Your name</label>
              <input
                name="name"
                type="text"
                autoComplete="name"
                required
                placeholder="Jane Broker"
                className="mb-3.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[13.5px]"
              />
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Broker agency</label>
              <input
                name="agency"
                type="text"
                autoComplete="organization"
                required
                placeholder="e.g. Pacific Senior Advisors"
                className="mb-3.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[13.5px]"
              />
            </>
          )}
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Email</label>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="broker@smg.example"
            className="mb-3.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[13.5px]"
          />
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Password</label>
          <input
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            placeholder="••••••••"
            className="mb-5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[13.5px]"
          />
          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {pending && <Spinner light />}
            {isSignup ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>

      {allowSignup && (
        <p className="mt-[18px] text-center text-[12.5px] text-slate-500">
          {isSignup ? "Already have an account?" : "New to SMG Recommender?"}{" "}
          <span onClick={() => setMode(isSignup ? "signin" : "signup")} className="lk font-medium">
            {isSignup ? "Sign in" : "Create account"}
          </span>
        </p>
      )}

      <p className="mt-6 text-center text-[11px] leading-[1.5] text-slate-400">
        Your clients and audit records are private to your account.
        <br />
        Recommendations are reproducible and logged.
      </p>
    </>
  );
}
