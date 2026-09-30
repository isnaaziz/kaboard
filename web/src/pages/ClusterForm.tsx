import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { api, type ClusterConfig, type Sasl, type SchemaRegistry, type Tls } from "../api";
import { useConfirm } from "../components/Modal";
import { options, Select } from "../components/Select";
import { toast } from "../components/Toast";
import { Alert, Button, Field, Page, Query, submit } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";

const mechanisms = options(["", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"], (m) => m || "None");

type Form = { name: string; brokers: string; readOnly: boolean; sasl: Sasl; tls: Tls; registry: SchemaRegistry };

const emptyForm: Form = {
  name: "",
  brokers: "",
  readOnly: false,
  sasl: { mechanism: "", username: "", password: "" },
  tls: { enabled: false, insecureSkipVerify: false, ca: "", cert: "", key: "" },
  registry: { url: "", username: "", password: "" },
};

const toForm = (c: ClusterConfig): Form => ({
  name: c.name,
  brokers: c.brokers.join("\n"),
  readOnly: c.readOnly,
  sasl: { ...emptyForm.sasl, ...c.sasl },
  tls: { ...emptyForm.tls, ...c.tls },
  registry: { ...emptyForm.registry, ...c.schemaRegistry },
});

const toConfig = (f: Form): ClusterConfig => ({
  name: f.name.trim(),
  brokers: f.brokers.split(/[\s,]+/).filter(Boolean),
  readOnly: f.readOnly,
  sasl: f.sasl.mechanism ? f.sasl : null,
  tls: f.tls.enabled ? f.tls : null,
  schemaRegistry: f.registry.url.trim() ? { ...f.registry, url: f.registry.url.trim() } : null,
});

export function ClusterForm() {
  const name = useParams().name;
  const q = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: Infinity });

  if (!name) return <Editor initial={emptyForm} />;
  return (
    <Query q={q}>
      {(clusters) => {
        const found = clusters.find((c) => c.name === name);
        return found ? <Editor key={name} original={name} initial={toForm(found)} /> : <Alert>Cluster "{name}" not found</Alert>;
      }}
    </Query>
  );
}

function Editor({ original, initial }: { original?: string; initial: Form }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState(initial);
  const confirm = useConfirm();
  const editing = original !== undefined;

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const patchSasl = (p: Partial<Sasl>) => setForm((f) => ({ ...f, sasl: { ...f.sasl, ...p } }));
  const patchTls = (p: Partial<Tls>) => setForm((f) => ({ ...f, tls: { ...f.tls, ...p } }));
  const patchRegistry = (p: Partial<SchemaRegistry>) => setForm((f) => ({ ...f, registry: { ...f.registry, ...p } }));

  const test = useMutation({ mutationFn: () => api.testConnection(toConfig(form), original) });
  const save = useMutation({
    mutationFn: () => (original !== undefined ? api.updateCluster(original, toConfig(form)) : api.createCluster(toConfig(form))),
    meta: { error: "Could not save cluster" },
    onSuccess: (saved) => {
      client.invalidateQueries({ queryKey: ["clusters"] });
      client.removeQueries({ queryKey: ["overview", original] });
      toast.success(editing ? "Cluster updated" : "Cluster added", saved.name);
      navigate(`/c/${encodeURIComponent(saved.name)}/topics`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCluster(original!),
    meta: { error: "Could not remove cluster" },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["clusters"] });
      toast.success("Cluster removed", original);
      navigate("/clusters");
    },
  });

  const confirmRemove = async () => {
    const ok = await confirm({
      title: "Remove cluster",
      message: (
        <>
          Remove <strong className="text-zinc-50">{original}</strong> from Kaboard? Only the saved connection is deleted — nothing changes on the Kafka cluster itself.
        </>
      ),
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const secretHint = editing ? "leave blank to keep current" : "";

  return (
    <Page
      title={editing ? `Edit ${original}` : "Add cluster"}
      actions={
        editing && (
          <Button variant="danger" disabled={remove.isPending} onClick={confirmRemove}>
            Remove
          </Button>
        )
      }
    >
      <form className="flex max-w-3xl flex-col gap-4" onSubmit={submit(save.mutate)}>
        <Group title="Connection">
          <Field label="Name" hint="letters, digits, . _ -">
            <input required pattern="[A-Za-z0-9._-]{1,64}" placeholder="production" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Bootstrap brokers" hint="one per line or comma separated">
            <textarea
              required
              rows={3}
              className="tabular-nums text-xs"
              placeholder="203.0.113.10:9092"
              value={form.brokers}
              onChange={(e) => patch({ brokers: e.target.value })}
            />
          </Field>
          <label className="text-sm text-zinc-300">
            <input type="checkbox" checked={form.readOnly} onChange={(e) => patch({ readOnly: e.target.checked })} />
            Read-only — block produce, delete, config changes and offset resets
          </label>
        </Group>

        <Group title="Authentication (SASL)">
          <Field label="Mechanism">
            <Select value={form.sasl.mechanism} options={mechanisms} onChange={(mechanism) => patchSasl({ mechanism })} />
          </Field>
          {form.sasl.mechanism && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username">
                <input required autoComplete="off" value={form.sasl.username} onChange={(e) => patchSasl({ username: e.target.value })} />
              </Field>
              <Field label="Password" hint={secretHint}>
                <PasswordInput autoComplete="new-password" required={!editing} value={form.sasl.password ?? ""} onChange={(e) => patchSasl({ password: e.target.value })} />
              </Field>
            </div>
          )}
        </Group>

        <Group title="Encryption (TLS)">
          <label className="text-sm text-zinc-300">
            <input type="checkbox" checked={form.tls.enabled} onChange={(e) => patchTls({ enabled: e.target.checked })} />
            Enable TLS
          </label>
          {form.tls.enabled && (
            <>
              <label className="text-sm text-zinc-300">
                <input type="checkbox" checked={form.tls.insecureSkipVerify} onChange={(e) => patchTls({ insecureSkipVerify: e.target.checked })} />
                Skip certificate verification (insecure)
              </label>
              <Pem label="CA certificate" hint="optional, PEM" value={form.tls.ca} onChange={(ca) => patchTls({ ca })} />
              <Pem label="Client certificate" hint="optional, for mTLS" value={form.tls.cert} onChange={(cert) => patchTls({ cert })} />
              <Pem label="Client key" hint={secretHint || "optional, for mTLS"} value={form.tls.key} onChange={(key) => patchTls({ key })} />
            </>
          )}
        </Group>

        <Group title="Schema Registry">
          <Field label="URL" hint="optional — decodes Avro, Protobuf and JSON Schema messages">
            <input type="url" placeholder="http://schema-registry:8081" value={form.registry.url} onChange={(e) => patchRegistry({ url: e.target.value })} />
          </Field>
          {form.registry.url.trim() && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username" hint="optional, basic auth">
                <input autoComplete="off" value={form.registry.username ?? ""} onChange={(e) => patchRegistry({ username: e.target.value })} />
              </Field>
              <Field label="Password" hint={secretHint || "optional"}>
                <PasswordInput autoComplete="new-password" value={form.registry.password ?? ""} onChange={(e) => patchRegistry({ password: e.target.value })} />
              </Field>
            </div>
          )}
        </Group>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
          <Button variant="primary" disabled={save.isPending}>
            {editing ? "Save changes" : "Add cluster"}
          </Button>
        </div>

        {test.error && <Alert>{test.error.message}</Alert>}
        {test.data &&
          (test.data.ok && test.data.overview ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">
              Connected in {test.data.latencyMs} ms · {test.data.overview.brokers.length} brokers · controller {test.data.overview.controller}
              {test.data.overview.clusterId && ` · ${test.data.overview.clusterId}`}
              <p className="mt-1 tabular-nums text-xs text-emerald-400/80">{test.data.overview.brokers.map((b) => `${b.id}@${b.host}:${b.port}`).join("  ")}</p>
            </div>
          ) : (
            <Alert>
              Failed after {test.data.latencyMs} ms: {test.data.error}
            </Alert>
          ))}
      </form>
    </Page>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <legend className="px-1 text-xs font-semibold tracking-wider text-zinc-500 uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

function Pem({ label, hint, value, onChange }: { label: string; hint: string; value?: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        rows={4}
        spellCheck={false}
        className="tabular-nums text-[11px]"
        placeholder="-----BEGIN CERTIFICATE-----"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
