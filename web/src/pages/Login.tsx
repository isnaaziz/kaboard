import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useSignIn } from "../auth";
import { Alert, Button, Field, submit } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";

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
    <div className="grid min-h-screen place-items-center bg-zinc-950 p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-indigo-600 text-xl font-bold text-white">K</span>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-zinc-50">{copy[mode].title}</h1>
            <p className="text-zinc-500">{copy[mode].subtitle}</p>
          </div>
        </div>
        <form className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6" onSubmit={submit(onSubmit)}>
          <Field label="Username" hint={mode === "setup" ? "an email address works too" : undefined}>
            <input autoFocus required autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Password" hint={mode === "setup" ? "at least 10 characters" : undefined}>
            <PasswordInput
              required

              minLength={mode === "setup" ? 10 : undefined}
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          {mode === "setup" && (
            <Field label="Confirm password">
              <PasswordInput required autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            </Field>
          )}
          {error && <Alert>{error}</Alert>}
          <Button variant="primary" className="justify-center py-2" disabled={auth.isPending}>
            {auth.isPending ? "Please wait…" : copy[mode].action}
          </Button>
        </form>
        <p className="text-center text-xs text-zinc-600">Sessions expire after 8 hours of inactivity.</p>
      </div>
    </div>
  );
}
