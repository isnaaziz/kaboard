import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { toast } from "../components/Toast";
import { Badge, Button, Field, fmt, formatBytes, Page, Query, submit, Table, Td, Th, Tr, useCluster } from "../components/ui";

export function Topics() {
  const { cluster, readOnly } = useCluster();
  const [search, setSearch] = useState("");
  const [internal, setInternal] = useState(false);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["topics", cluster], queryFn: () => api.topics(cluster), refetchInterval: 15_000 });

  const rows = useMemo(() => {
    const needle = search.toLowerCase();
    return (q.data ?? []).filter((t) => (internal || !t.internal) && t.name.toLowerCase().includes(needle));
  }, [q.data, search, internal]);

  return (
    <Page
      title="Topics"
      actions={
        <>
          <input className="w-64" placeholder="Search topics…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <label>
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> internal
          </label>
          {!readOnly && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New topic
            </Button>
          )}
        </>
      }
    >
      <CreateTopic cluster={cluster} open={creating} onClose={() => setCreating(false)} />
      <Query q={q}>
        {() => (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th num>Partitions</Th>
                <Th num>Replication</Th>
                <Th num>Messages</Th>
                <Th num>Size</Th>
                <Th>Health</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <Tr key={t.name}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <Link to={encodeURIComponent(t.name)}>{t.name}</Link>
                      {t.internal && <Badge>internal</Badge>}
                    </span>
                  </Td>
                  <Td num>{t.partitions}</Td>
                  <Td num>{t.replication}</Td>
                  <Td num>{fmt.format(t.messages)}</Td>
                  <Td num>{t.size === undefined ? "—" : formatBytes(t.size)}</Td>
                  <Td>{t.underReplicated ? <Badge tone="bad">{t.underReplicated} under-replicated</Badge> : <Badge tone="ok">healthy</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Query>
      <p className="text-xs text-zinc-500">{rows.length} topics</p>
    </Page>
  );
}

function CreateTopic({ cluster, open, onClose }: { cluster: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState({ name: "", partitions: 3, replication: 1 });
  const create = useMutation({
    mutationFn: () => api.createTopic(cluster, form),
    meta: { error: "Could not create topic" },
    onSuccess: (t) => {
      client.invalidateQueries({ queryKey: ["topics", cluster] });
      toast.success("Topic created", `${t.name} · ${t.partitions} partitions · replication ${t.replication}`);
      onClose();
      setForm({ name: "", partitions: 3, replication: 1 });
      navigate(encodeURIComponent(t.name));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New topic"
      description="Create a topic on this cluster."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-topic" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create topic"}
          </Button>
        </>
      }
    >
      <form id="create-topic" className="flex flex-col gap-3" onSubmit={submit(create.mutate)}>
        <Field label="Name">
          <input autoFocus required placeholder="scada.telemetry" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Partitions">
            <input type="number" min={1} value={form.partitions} onChange={(e) => setForm({ ...form, partitions: +e.target.value })} />
          </Field>
          <Field label="Replication factor">
            <input type="number" min={1} value={form.replication} onChange={(e) => setForm({ ...form, replication: +e.target.value })} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
