"use client";

import { useActionState, useState } from "react";
import { submitAuth, type AuthState } from "@/app/login/actions";
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
  const [state, formAction, pending] = useActionState<AuthState, FormData>(submitAuth, {});

  const isSignup = mode === "signup";

  return (
    <>
      <div className="rounded-xl border border-line bg-surface p-[26px] shadow-card">
        <h2 className="display mb-1.5 text-[21px] font-semibold leading-[1.15] text-ink">
          {isSignup ? "Create your account" : "Sign in"}
        </h2>
        <p className="mb-[18px] text-[12.5px] leading-[1.5] text-ink2">
          {isSignup
            ? "Your account is your private workspace — your clients and audit records are visible only to you."
            : "Welcome back. Pick up your private workspace where you left off."}
        </p>

        {isSignup && (
          <div className="mb-[18px] rounded-lg border border-line bg-paper px-4 py-3.5">
            <div className="eyebrow mb-2.5 text-accent">How it works</div>
            <ol className="space-y-2">
              {[
                "Capture a member's facts — type them in, or send a secure link.",
                "Get a ranked, cited plan recommendation you can defend.",
                "Save a reproducible record you can re-verify any time.",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[12.5px] leading-[1.4] text-ink">
                  <span className="num mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {state.notice && (
          <div className="mb-3.5 rounded-sm border border-pos/30 bg-pos/10 px-3 py-2.5 text-[12.5px] leading-[1.45] text-pos">
            {state.notice}
          </div>
        )}
        {state.error && (
          <div className="mb-3.5 rounded-sm border border-neg/30 bg-neg/10 px-3 py-2.5 text-[12.5px] text-neg">
            {state.error}
          </div>
        )}

        <form action={formAction}>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="mode" value={mode} />
          {isSignup && (
            <>
              <label className="mb-1.5 block text-xs font-medium text-ink">Your name</label>
              <input
                name="name"
                type="text"
                autoComplete="name"
                required
                placeholder="Jane Broker"
                className="mb-3.5 w-full rounded-sm border border-line bg-surface px-3 py-2.5 text-[13.5px]"
              />
              <label className="mb-1.5 block text-xs font-medium text-ink">Broker agency</label>
              <input
                name="agency"
                type="text"
                autoComplete="organization"
                required
                placeholder="e.g. Pacific Senior Advisors"
                className="mb-3.5 w-full rounded-sm border border-line bg-surface px-3 py-2.5 text-[13.5px]"
              />
            </>
          )}
          <label className="mb-1.5 block text-xs font-medium text-ink">Email</label>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="broker@smg.example"
            className="mb-3.5 w-full rounded-sm border border-line bg-surface px-3 py-2.5 text-[13.5px]"
          />
          <label className="mb-1.5 block text-xs font-medium text-ink">Password</label>
          <input
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            placeholder="••••••••"
            className="mb-5 w-full rounded-sm border border-line bg-surface px-3 py-2.5 text-[13.5px]"
          />
          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {pending && <Spinner light />}
            {isSignup ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>

      {allowSignup && (
        <p className="mt-[18px] text-center text-[12.5px] text-ink2">
          {isSignup ? "Already have an account?" : "New to the SMG Recommender?"}{" "}
          <button type="button" onClick={() => setMode(isSignup ? "signin" : "signup")} className="lk font-semibold">
            {isSignup ? "Sign in instead" : "Create your account"}
          </button>
        </p>
      )}

      <p className="mt-6 text-center text-[11px] leading-[1.5] text-ink2">
        Your clients and audit records are private to your account.
        <br />
        Recommendations are reproducible and logged.
      </p>
    </>
  );
}
