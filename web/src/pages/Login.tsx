import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useSignIn } from "../auth";
import { submit } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";
import { ThemeToggle } from "../theme";

type Mode = "login" | "setup";

const copy: Record<Mode, { title: string; subtitle: string; action: string }> = {
  login: { title: "Sign in to Kaboard", subtitle: "Use the account your administrator created for you.", action: "Sign in" },
  setup: { title: "Create the admin account", subtitle: "No users exist yet. This first account gets full admin access.", action: "Create account" },
};

export function Login({ mode }: { mode: Mode }) {
  const signIn = useSignIn();
  const [form, setForm] = useState({ username: "", password: "", confirm: "" });
  const [mismatch, setMismatch] = useState(false);

  const auth = useMutation({
    mutationFn: () => (mode === "setup" ? api.setup(form.username, form.password) : api.login(form.username, form.password)),
    meta: { silent: true },
    onSuccess: signIn,
  });

  const onSubmit = () => {
    if (mode === "setup" && form.password !== form.confirm) return setMismatch(true);
    setMismatch(false);
    auth.mutate();
  };

  const error = auth.error?.message ?? (mismatch ? "Passwords do not match" : null);

  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-950">
      <ThemeToggle className="absolute top-6 right-6 w-32" />
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-12 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-lg font-bold text-white shadow-lg">K</span>
              <div>
                <div className="text-2xl font-bold tracking-tight text-zinc-50">Kaboard</div>
                <div className="text-xs font-medium text-zinc-400">Kafka Admin</div>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-zinc-50">{copy[mode].title}</h1>
            <p className="mt-2 text-sm text-zinc-400">{copy[mode].subtitle}</p>
          </div>

          <form className="flex flex-col gap-5" onSubmit={submit(onSubmit)}>
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-300">Username</label>
              <input
                autoFocus
                required
                autoComplete="username"
                placeholder={mode === "setup" ? "admin@example.com or admin" : "username"}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-300">Password</label>
              <PasswordInput
                required
                minLength={mode === "setup" ? 10 : undefined}
                autoComplete={mode === "setup" ? "new-password" : "current-password"}
                placeholder={mode === "setup" ? "At least 10 characters" : "Enter your password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {mode === "setup" && (
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">Confirm password</label>
                <PasswordInput
                  required
                  autoComplete="new-password"
                  placeholder="Confirm password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-rose-900/30 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={auth.isPending}
              className="mt-2 w-full rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 py-3 text-sm font-medium text-white shadow-lg transition hover:shadow-xl hover:from-indigo-500 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {auth.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" opacity="0.2" />
                    <path d="M12 2a10 10 0 0 1 0 20" />
                  </svg>
                  Please wait…
                </span>
              ) : (
                copy[mode].action
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-zinc-500">
            Sessions expire after 8 hours of inactivity
          </p>
        </div>
      </div>
    </div>
  );
}
