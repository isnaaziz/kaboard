import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, type ConfigEntry, type ProduceRecord, type Topic } from "../api";
import { MessageBrowser } from "../components/MessageBrowser";
import { ProduceForm } from "../components/ProduceForm";
import { useConfirm } from "../components/Modal";
import { toast } from "../components/Toast";
import { Badge, Button, cx, fmt, Page, Query, Stat, Stats, submit, Table, Tabs, Td, Th, Tr, useCluster } from "../components/ui";

const tabs = ["Messages", "Partitions", "Configs", "Produce"] as const;
type Tab = (typeof tabs)[number];

export function TopicView() {
  const { cluster, readOnly, canAdmin } = useCluster();
  const topic = useParams().topic ?? "";
  const navigate = useNavigate();
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>("Messages");
  const [draft, setDraft] = useState<ProduceRecord | undefined>();
  const [purges, setPurges] = useState(0);
  const q = useQuery({ queryKey: ["topic", cluster, topic], queryFn: () => api.topic(cluster, topic), refetchInterval: 10_000 });

  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api.deleteTopic(cluster, topic),
    meta: { error: "Could not delete topic" },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["topics", cluster] });
      toast.success("Topic deleted", topic);
      navigate("..", { relative: "path" });
    },
  });

  const purge = useMutation({
    mutationFn: () => api.purgeTopic(cluster, topic),
    meta: { error: "Could not purge topic" },
    onSuccess: ({ purged }) => {
      client.invalidateQueries({ queryKey: ["topic", cluster, topic] });
      client.invalidateQueries({ queryKey: ["topics", cluster] });
      setPurges((n) => n + 1);
      toast.success("Topic purged", `${fmt.format(purged)} messages deleted from ${topic}`);
    },
  });

  const confirmPurge = async () => {
    const ok = await confirm({
      title: "Purge topic",
      message: (
        <>
          This permanently deletes all messages in <strong className="text-zinc-50">{topic}</strong>. The topic and its configs are kept. This cannot be undone.
        </>
      ),
      confirmLabel: "Purge messages",
      danger: true,
      requireText: topic,
    });
    if (ok) purge.mutate();
  };

  const confirmDelete = async () => {
    const ok = await confirm({
      title: "Delete topic",
      message: (
        <>
          This permanently deletes <strong className="text-zinc-50">{topic}</strong> and all of its messages. This cannot be undone.
        </>
      ),
      confirmLabel: "Delete topic",
      danger: true,
      requireText: topic,
    });
    if (ok) remove.mutate();
  };

  const edit = (r: ProduceRecord) => {
    setDraft(r);
    setTab("Produce");
  };

  return (
    <Page
      title={topic}
      actions={
        canAdmin && (
          <>
            <Button onClick={confirmPurge} disabled={purge.isPending || remove.isPending}>
              Purge messages
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={remove.isPending || purge.isPending}>
              Delete topic
            </Button>
          </>
        )
      }
    >
      <Query q={q}>
        {(t) => (
          <>
            <Stats>
              <Stat label="Partitions" value={t.partitions} />
              <Stat label="Replication" value={t.replication} />
              <Stat label="Messages" value={fmt.format(t.messages)} />
              <Stat label="Under-replicated" value={t.underReplicated} tone={t.underReplicated ? "bad" : "ok"} />
              <Stat label="Retention" value={retention(t.configs.find((c) => c.name === "retention.ms")?.value)} />
            </Stats>
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            {tab === "Messages" && <MessageBrowser key={purges} cluster={cluster} topic={topic} readOnly={readOnly} onEdit={edit} />}
            {tab === "Partitions" && <Partitions topic={t} />}
            {tab === "Configs" && <Configs cluster={cluster} topic={t} readOnly={readOnly} />}
            {tab === "Produce" &&
              (readOnly ? <p className="text-zinc-500">You don't have permission to produce on this cluster.</p> : <ProduceForm cluster={cluster} topic={topic} partitions={t.partitions} draft={draft} />)}
          </>
        )}
      </Query>
    </Page>
  );
}

function retention(value: string | undefined) {
  if (value === undefined) return "—";
  const ms = Number(value);
  if (ms < 0) return "Unlimited";
  const units: [number, string][] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1_000, "second"],
  ];
  const [size, unit] = units.find(([size]) => ms >= size) ?? [1, "ms"];
  const n = Math.round((ms / size) * 10) / 10;
  return unit === "ms" ? `${n} ms` : `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function Partitions({ topic }: { topic: Topic }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th num>Partition</Th>
          <Th num>Leader</Th>
          <Th>Replicas</Th>
          <Th>ISR</Th>
          <Th num>Start</Th>
          <Th num>End</Th>
          <Th num>Messages</Th>
        </tr>
      </thead>
      <tbody>
        {topic.partitionList.map((p) => (
          <Tr key={p.id}>
            <Td num>{p.id}</Td>
            <Td num>{p.leader < 0 ? <Badge tone="bad">none</Badge> : p.leader}</Td>
            <Td dense>{p.replicas.join(", ")}</Td>
            <Td dense>
              <span className="flex items-center gap-2">
                {p.isr.join(", ")}
                {p.isr.length < p.replicas.length && <Badge tone="bad">under-replicated</Badge>}
              </span>
            </Td>
            <Td num>{fmt.format(p.start)}</Td>
            <Td num>{fmt.format(p.end)}</Td>
            <Td num>{fmt.format(p.end - p.start)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function Configs({ cluster, topic, readOnly }: { cluster: string; topic: Topic; readOnly: boolean }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null);
  const save = useMutation({
    mutationFn: (configs: Record<string, string | null>) => api.alterConfigs(cluster, topic.name, configs),
    meta: { error: "Could not update config" },
    onSuccess: (_, configs) => {
      const [name, value] = Object.entries(configs)[0];
      toast.success(value === null ? "Config reset to default" : "Config updated", value === null ? name : `${name} = ${value}`);
      setEditing(null);
      client.invalidateQueries({ queryKey: ["topic", cluster, topic.name] });
    },
  });

  const overridden = (c: ConfigEntry) => c.source.includes("DYNAMIC_TOPIC");
  const rows = topic.configs.filter((c) => c.name.includes(search));

  return (
    <>
      <div className="flex items-center gap-3">
        <input className="w-72" placeholder="Filter configs…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Value</Th>
            <Th>Source</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Tr key={c.name} className={cx(overridden(c) && "bg-indigo-500/5")}>
              <Td dense className={cx(overridden(c) && "text-indigo-300")}>
                {c.name}
              </Td>
              <Td dense>
                {editing?.name === c.name ? (
                  <form className="flex gap-2" onSubmit={submit(() => save.mutate({ [c.name]: editing.value }))}>
                    <input className="flex-1" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                    <Button variant="primary">Save</Button>
                    <Button type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : c.sensitive ? (
                  "••••••"
                ) : (
                  c.value
                )}
              </Td>
              <Td className="text-xs text-zinc-500">{c.source}</Td>
              <Td className="text-right whitespace-nowrap">
                {!readOnly && editing?.name !== c.name && (
                  <>
                    <Button variant="link" onClick={() => setEditing({ name: c.name, value: c.value })}>
                      edit
                    </Button>
                    {overridden(c) && (
                      <Button variant="link" onClick={() => save.mutate({ [c.name]: null })}>
                        reset
                      </Button>
                    )}
                  </>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
