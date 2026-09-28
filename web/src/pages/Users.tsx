import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Role, type UserInput, type UserView } from "../api";
import { useAuth } from "../auth";
import { Menu } from "../components/Menu";
import { Modal, useConfirm } from "../components/Modal";
import { Select, type Option } from "../components/Select";
import { toast } from "../components/Toast";
import { Badge, Button, Field, Page, Query, submit, Table, Td, Th, Tr, type Tone } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";

type GlobalRole = Exclude<Role, "none">;

const roles: Option<GlobalRole>[] = [
  { value: "viewer", label: "Viewer — read only" },
  { value: "operator", label: "Operator — produce, configs, offsets" },
  { value: "admin", label: "Admin — full access" },
];

const overrides: Option<Role | "">[] = [
  { value: "", label: "Inherit" },
  { value: "none", label: "No access" },
  { value: "viewer", label: "Viewer" },
  { value: "operator", label: "Operator" },
  { value: "admin", label: "Admin" },
];

const roleTone: Record<Role, Tone> = { none: "muted", viewer: "muted", operator: "info", admin: "warn" };

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function Users() {
  const { user: me } = useAuth();
  const client = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["users"], queryFn: api.users });
  const [editing, setEditing] = useState<UserView | "new" | null>(null);

  const remove = useMutation({
    mutationFn: (username: string) => api.deleteUser(username),
    meta: { error: "Could not delete user" },
    onSuccess: (_, username) => {
      client.invalidateQueries({ queryKey: ["users"] });
      toast.success("User deleted", username);
    },
  });

  const confirmRemove = async (u: UserView) => {
    const ok = await confirm({
      title: "Delete user",
      message: (
        <>
          Delete <strong className="text-zinc-50">{u.username}</strong>? Their active sessions end immediately.
        </>
      ),
      confirmLabel: "Delete user",
      danger: true,
    });
    if (ok) remove.mutate(u.username);
  };

  return (
    <Page
      title="Users"
      actions={
        <Button variant="primary" onClick={() => setEditing("new")}>
          Add user
        </Button>
      }
    >
      <Query q={q}>
        {(users) => (
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Cluster access</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.username === me.username;
                const custom = Object.entries(u.clusters);
                return (
                  <Tr key={u.username}>
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={u.username} />
                        <span className="font-medium text-zinc-100">{u.username}</span>
                        {self && <Badge tone="info">you</Badge>}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={roleTone[u.role]}>{u.role}</Badge>
                    </Td>
                    <Td className="text-xs text-zinc-400">
                      {u.role === "admin" ? "All clusters" : custom.length ? custom.map(([c, r]) => `${c}: ${r}`).join(" · ") : `All clusters as ${u.role}`}
                    </Td>
                    <Td>{u.disabled ? <Badge tone="bad">disabled</Badge> : <Badge tone="ok">active</Badge>}</Td>
                    <Td className="text-xs text-zinc-500">{dateFmt.format(new Date(u.createdAt))}</Td>
                    <Td className="w-12">
                      <Menu
                        label={`${u.username} actions`}
                        items={[
                          { label: "Edit user", onSelect: () => setEditing(u) },
                          { label: "Delete user", onSelect: () => confirmRemove(u), danger: true, disabled: self },
                        ]}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Query>
      {editing && <UserForm user={editing === "new" ? null : editing} self={editing !== "new" && editing.username === me.username} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function UserForm({ user, self, onClose }: { user: UserView | null; self: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: Infinity });
  const [form, setForm] = useState<UserInput>({
    username: user?.username ?? "",
    password: "",
    role: user?.role ?? "viewer",
    clusters: user?.clusters ?? {},
    disabled: user?.disabled ?? false,
  });

  const save = useMutation({
    mutationFn: () => (user ? api.updateUser(user.username, form) : api.createUser(form)),
    meta: { error: user ? "Could not update user" : "Could not create user" },
    onSuccess: (saved) => {
      client.invalidateQueries({ queryKey: ["users"] });
      toast.success(user ? "User updated" : "User created", `${saved.username} · ${saved.role}`);
      onClose();
    },
  });

  const setOverride = (cluster: string, role: Role | "") =>
    setForm((f) => {
      const next = { ...f.clusters };
      if (role) next[cluster] = role;
      else delete next[cluster];
      return { ...f, clusters: next };
    });

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={user ? `Edit ${user.username}` : "Add user"}
      description={user ? "Changing the password or disabling the user ends their sessions." : "The user signs in with this username and password."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="user-form" disabled={save.isPending}>
            {save.isPending ? "Saving…" : user ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <form id="user-form" className="flex flex-col gap-4" onSubmit={submit(save.mutate)}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username">
            <input
              autoFocus={!user}
              required
              disabled={!!user}
              pattern="[A-Za-z0-9._@+\-]{3,64}"
              autoComplete="off"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="Password" hint={user ? "blank keeps current" : "min 10 chars"}>
            <PasswordInput required={!user} minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </div>
        <Field label="Role">
          <Select value={form.role} options={roles} disabled={self} onChange={(role) => setForm({ ...form, role })} />
        </Field>
        {form.role !== "admin" && (clusters.data?.length ?? 0) > 0 && (
          <Field label="Per-cluster access" hint="overrides the role above">
            <div className="flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800">
              {clusters.data?.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-zinc-200">{c.name}</span>
                  <Select className="w-36" align="right" value={form.clusters[c.name] ?? ""} options={overrides} onChange={(r) => setOverride(c.name, r)} />
                </div>
              ))}
            </div>
          </Field>
        )}
        {user && !self && (
          <label className="text-sm text-zinc-300">
            <input type="checkbox" checked={form.disabled} onChange={(e) => setForm({ ...form, disabled: e.target.checked })} />
            Disable account — blocks sign in and ends active sessions
          </label>
        )}
      </form>
    </Modal>
  );
}

export function Avatar({ name }: { name: string }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-200 uppercase">{name.slice(0, 2)}</span>;
}
