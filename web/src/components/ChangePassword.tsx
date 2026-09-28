import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { Modal } from "./Modal";
import { toast } from "./Toast";
import { Alert, Button, Field, submit } from "./ui";
import { PasswordInput } from "./PasswordInput";

const empty = { current: "", next: "", confirm: "" };

export function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState(empty);
  const [mismatch, setMismatch] = useState(false);

  const close = () => {
    setForm(empty);
    setMismatch(false);
    change.reset();
    onClose();
  };

  const change = useMutation({
    mutationFn: () => api.changePassword(form.current, form.next),
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Password changed", "Other sessions for your account were signed out");
      close();
    },
  });

  const onSubmit = () => {
    if (form.next !== form.confirm) return setMismatch(true);
    setMismatch(false);
    change.mutate();
  };

  const error = change.error?.message ?? (mismatch ? "New passwords do not match" : null);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change password"
      description="Every other session on your account will be signed out."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="change-password" disabled={change.isPending}>
            {change.isPending ? "Saving…" : "Change password"}
          </Button>
        </>
      }
    >
      <form id="change-password" className="flex flex-col gap-3" onSubmit={submit(onSubmit)}>
        <Field label="Current password">
          <PasswordInput autoFocus required autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </Field>
        <Field label="New password" hint="at least 10 characters">
          <PasswordInput required minLength={10} autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput required autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}
