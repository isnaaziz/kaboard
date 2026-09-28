import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type Group, type ResetMode } from "../api";
import { useConfirm } from "../components/Modal";
import { options, Select } from "../components/Select";
import { toast } from "../components/Toast";
import { Alert, Badge, Button, Card, cx, fmt, Note, Page, Query, Section, Stat, Stats, stateTone, submit, Table, Td, Th, Tr, useCluster } from "../components/ui";

export function GroupView() {
  const { cluster, readOnly, canAdmin } = useCluster();
  const name = useParams().group ?? "";
  const navigate = useNavigate();
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["group", cluster, name], queryFn: () => api.group(cluster, name), refetchInterval: 5_000 });
  const empty = q.data?.state === "Empty" || q.data?.state === "Dead";

  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api.deleteGroup(cluster, name),
    meta: { error: "Could not delete group" },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["groups", cluster] });
      toast.success("Consumer group deleted", name);
      navigate("..", { relative: "path" });
    },
  });

  const confirmDelete = async () => {
    const ok = await confirm({
      title: "Delete consumer group",
      message: (
        <>
          Committed offsets of <strong className="text-zinc-50">{name}</strong> will be removed. Consumers will restart from their auto.offset.reset policy.
        </>
      ),
      confirmLabel: "Delete group",
      danger: true,
    });
    if (ok) remove.mutate();
  };

  return (
    <Page
      title={name}
      actions={
        canAdmin &&
        empty && (
          <Button variant="danger" disabled={remove.isPending} onClick={confirmDelete}>
            Delete group
          </Button>
        )
      }
    >
      <Query q={q}>
        {(g) => (
          <>
            <Stats>
              <Stat label="State" value={<Badge tone={stateTone(g.state)}>{g.state}</Badge>} />
              <Stat label="Members" value={g.members} />
              <Stat label="Coordinator" value={g.coordinator} />
              <Stat label="Protocol" value={g.protocol || "—"} />
              <Stat label="Total lag" value={fmt.format(g.lag)} tone={g.lag > 0 ? "warn" : "ok"} />
            </Stats>
            {g.error && <Alert>{g.error}</Alert>}
            <Lags group={g} cluster={cluster} />
            <Members group={g} />
            {!readOnly && <Reset group={g} cluster={cluster} enabled={empty} />}
          </>
        )}
      </Query>
    </Page>
  );
}

function Lags({ group, cluster }: { group: Group; cluster: string }) {
  const max = Math.max(1, ...group.lags.map((l) => l.lag));
  return (
    <Section title="Lag">
      <Table>
        <thead>
          <tr>
            <Th>Topic</Th>
            <Th num>Partition</Th>
            <Th num>Committed</Th>
            <Th num>End</Th>
            <Th num>Lag</Th>
            <Th className="w-1/5" />
            <Th>Member</Th>
          </tr>
        </thead>
        <tbody>
          {group.lags.map((l) => (
            <Tr key={`${l.topic}:${l.partition}`}>
              <Td>
                <Link to={`/c/${encodeURIComponent(cluster)}/topics/${encodeURIComponent(l.topic)}`}>{l.topic}</Link>
              </Td>
              <Td num>{l.partition}</Td>
              <Td num>{l.committed < 0 ? "—" : fmt.format(l.committed)}</Td>
              <Td num>{fmt.format(l.end)}</Td>
              <Td num className={cx(l.lag > 0 && "text-amber-400")}>
                {l.error ? <Note>{l.error}</Note> : fmt.format(l.lag)}
              </Td>
              <Td>
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${(Math.max(0, l.lag) / max) * 100}%` }} />
                </div>
              </Td>
              <Td dense className="max-w-56 truncate text-zinc-500">
                {l.member ?? "—"}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

function Members({ group }: { group: Group }) {
  if (!group.memberList.length) return null;
  return (
    <Section title="Members">
      <Table>
        <thead>
          <tr>
            <Th>Client ID</Th>
            <Th>Host</Th>
            <Th>Member ID</Th>
            <Th>Assignment</Th>
          </tr>
        </thead>
        <tbody>
          {group.memberList.map((m) => (
            <Tr key={m.id}>
              <Td>{m.clientId}</Td>
              <Td dense>{m.host}</Td>
              <Td dense className="max-w-56 truncate text-zinc-500">
                {m.instanceId || m.id}
              </Td>
              <Td dense>{m.assignments.map((a) => `${a.topic}[${a.partitions.join(",")}]`).join("  ")}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

const modes: { value: ResetMode; label: string }[] = [
  { value: "earliest", label: "Earliest" },
  { value: "latest", label: "Latest" },
  { value: "timestamp", label: "Timestamp" },
  { value: "offset", label: "Specific offset" },
  { value: "shift", label: "Shift by" },
];

function Reset({ group, cluster, enabled }: { group: Group; cluster: string; enabled: boolean }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const topics = [...new Set(group.lags.map((l) => l.topic))];
  const [form, setForm] = useState({ topic: topics[0] ?? "", mode: "earliest" as ResetMode, value: "", partitions: "" });
  const numeric = form.mode === "offset" || form.mode === "shift";
  const reset = useMutation({
    mutationFn: () =>
      api.resetOffsets(cluster, group.name, {
        topic: form.topic,
        mode: form.mode,
        timestamp: form.mode === "timestamp" ? new Date(form.value).getTime() : undefined,
        offset: numeric ? +form.value : undefined,
        partitions: form.partitions ? form.partitions.split(",").map((p) => +p.trim()) : undefined,
      }),
    meta: { error: "Could not reset offsets" },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["group", cluster, group.name] });
      toast.success("Offsets reset", `${group.name} → ${form.topic} (${describe})`);
    },
  });

  const describe = `${modes.find((m) => m.value === form.mode)?.label}${form.value ? ` ${form.value}` : ""}`;

  const confirmReset = async () => {
    const ok = await confirm({
      title: "Reset offsets",
      message: (
        <>
          Move <strong className="text-zinc-50">{group.name}</strong> on <strong className="text-zinc-50">{form.topic}</strong>
          {form.partitions ? ` (partitions ${form.partitions})` : " (all partitions)"} to <strong className="text-zinc-50">{describe}</strong>?
        </>
      ),
      confirmLabel: "Reset offsets",
      danger: true,
    });
    if (ok) reset.mutate();
  };

  return (
    <Section title="Reset offsets">
      {!enabled && <p className="text-zinc-500">Stop all consumers first — offsets can only be reset while the group is Empty.</p>}
      <form onSubmit={submit(confirmReset)}>
        <Card>
          {topics.length > 0 ? (
            <Select aria-label="Topic" className="w-64" value={form.topic} options={options(topics)} onChange={(topic) => setForm({ ...form, topic })} />
          ) : (
            <input placeholder="topic" required value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          )}
          <Select aria-label="Reset to" className="w-40" value={form.mode} options={modes} onChange={(mode) => setForm({ ...form, mode, value: "" })} />
          {form.mode === "timestamp" && <input type="datetime-local" step={1} required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />}
          {numeric && (
            <input className="w-32" type="number" required placeholder={form.mode === "shift" ? "-100" : "0"} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          )}
          <input className="w-40" placeholder="partitions (all)" value={form.partitions} onChange={(e) => setForm({ ...form, partitions: e.target.value })} />
          <Button variant="primary" disabled={!enabled || reset.isPending}>
            Reset
          </Button>
        </Card>
      </form>
    </Section>
  );
}
