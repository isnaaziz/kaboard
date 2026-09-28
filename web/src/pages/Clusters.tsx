import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { api, type ClusterConfig } from "../api";
import { useAuth } from "../auth";
import { Menu, type MenuItem } from "../components/Menu";
import { useConfirm } from "../components/Modal";
import { toast } from "../components/Toast";
import { ButtonLink, cx, Page, Query } from "../components/ui";

export function Clusters() {
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: Infinity });

  return (
    <Page
      title="Connections"
      actions={
        isAdmin && (
          <ButtonLink to="/clusters/new" variant="primary">
            Add connection
          </ButtonLink>
        )
      }
    >
      <Query q={q}>
        {(clusters) =>
          clusters.length === 0 ? (
            <Onboarding admin={isAdmin} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {clusters.map((c) => (
                <ConnectionCard key={c.name} cluster={c} />
              ))}
              {isAdmin && (
                <Link
                  to="/clusters/new"
                  className="group grid min-h-72 place-items-center rounded-xl border border-dashed border-zinc-800 text-zinc-500! transition hover:border-indigo-500/60 hover:bg-indigo-500/5 hover:text-zinc-200!"
                >
                  <span className="flex flex-col items-center gap-2">
                    <span className="grid size-10 place-items-center rounded-full border border-zinc-700 text-xl transition group-hover:border-indigo-500/60">+</span>
                    Add connection
                  </span>
                </Link>
              )}
            </div>
          )
        }
      </Query>
    </Page>
  );
}

function ConnectionCard({ cluster: c }: { cluster: ClusterConfig }) {
  const { isAdmin, roleFor } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const confirm = useConfirm();
  const health = useQuery({ queryKey: ["overview", c.name], queryFn: () => api.overview(c.name), retry: false, staleTime: 30_000 });
  const base = `/c/${encodeURIComponent(c.name)}`;

  const test = useMutation({
    mutationFn: () => api.testConnection(c, c.name),
    onSuccess: (r) =>
      r.ok && r.overview ? toast.success(`${c.name} is reachable`, `${r.overview.brokers.length} brokers · ${r.latencyMs} ms`) : toast.error(`${c.name} is unreachable`, r.error),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteCluster(c.name),
    meta: { error: "Could not remove connection" },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["clusters"] });
      toast.success("Connection removed", c.name);
    },
  });

  const confirmRemove = async () => {
    const ok = await confirm({
      title: "Remove connection",
      message: (
        <>
          Remove <strong className="text-zinc-50">{c.name}</strong> from Kaboard? Only the saved connection is deleted — nothing changes on the Kafka cluster itself.
        </>
      ),
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const state = health.isPending ? "checking" : health.isSuccess ? "online" : "offline";

  return (
    <article className="flex min-h-72 flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition hover:border-zinc-700">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-100">
            <KafkaIcon />
          </span>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <Link to={`${base}/topics`} className="truncate text-base font-semibold text-zinc-50! hover:text-indigo-300!">
                {c.name}
              </Link>
              <StatusDot state={state} />
            </div>
            <span className="text-[11px] font-semibold tracking-[0.14em] text-zinc-500">KAFKA</span>
          </div>
        </div>
        <Menu
          label={`${c.name} actions`}
          items={[
            { label: "Open", onSelect: () => navigate(`${base}/topics`) },
            { label: "Health", onSelect: () => navigate(`${base}/health`) },
            ...(isAdmin
              ? ([
                  { label: test.isPending ? "Testing…" : "Test connection", onSelect: () => test.mutate(), disabled: test.isPending },
                  "divider",
                  { label: "Edit connection", onSelect: () => navigate(`/clusters/${encodeURIComponent(c.name)}/edit`) },
                  { label: "Remove", onSelect: confirmRemove, danger: true },
                ] satisfies MenuItem[])
              : []),
          ]}
        />
      </header>

      <Detail title="Details">
        <span className="break-all">{c.brokers.join(", ")}</span>
        {health.data && (
          <span className="text-zinc-500">
            {health.data.brokers.length} broker{health.data.brokers.length === 1 ? "" : "s"} · controller {health.data.controller}
          </span>
        )}
        {health.data?.clusterId && <span className="truncate text-xs text-zinc-600">{health.data.clusterId}</span>}
        {health.error && <span className="line-clamp-2 text-xs text-rose-400">{health.error.message}</span>}
      </Detail>

      <Detail title="Security">
        <span>{c.tls?.enabled ? (c.tls.cert ? "Encrypted (mTLS)" : "Encrypted (TLS)") : "Unsecured cluster"}</span>
        <span>{c.sasl?.mechanism ? `SASL configured · ${c.sasl.mechanism}` : "No authentication"}</span>
        {c.readOnly && <span className="text-amber-300">Read-only cluster</span>}
        <span className="text-zinc-500">Your access: {roleFor(c.name)}</span>
      </Detail>

      <div className="mt-auto flex flex-col gap-1">
        <ButtonLink to={`${base}/topics`} className="justify-center py-2">
          View cluster details
        </ButtonLink>
        <ButtonLink to={`${base}/health`} variant="link" className="justify-center">
          Health
        </ButtonLink>
      </div>
    </article>
  );
}

function Detail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold text-zinc-400">{title}</h3>
      <div className="flex flex-col gap-0.5 text-zinc-200">{children}</div>
    </section>
  );
}

const dot = {
  online: { color: "bg-emerald-400", label: "Online" },
  offline: { color: "bg-rose-500", label: "Offline" },
  checking: { color: "bg-zinc-500 animate-pulse", label: "Checking" },
};

function StatusDot({ state }: { state: keyof typeof dot }) {
  return (
    <span className="flex items-center" title={dot[state].label}>
      <span className={cx("size-2 rounded-full", dot[state].color)} />
      <span className="sr-only">{dot[state].label}</span>
    </span>
  );
}

function KafkaIcon() {
  return (
    <svg viewBox="0 0 28 32" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M11 7.6v5.3M11 19.1v5.3M13.7 14.6l6.1-3.2M13.7 17.4l6.1 3.2" strokeLinecap="round" />
      <circle cx="11" cy="16" r="3.2" />
      <circle cx="11" cy="5" r="2.6" />
      <circle cx="11" cy="27" r="2.6" />
      <circle cx="22" cy="10.2" r="2.6" />
      <circle cx="22" cy="21.8" r="2.6" />
    </svg>
  );
}

function Onboarding({ admin }: { admin: boolean }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-zinc-800 p-12 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <span className="grid size-14 place-items-center rounded-xl bg-zinc-800 text-zinc-100">
          <KafkaIcon />
        </span>
        <h2 className="text-lg font-semibold text-zinc-50">{admin ? "Connect your first cluster" : "No clusters available"}</h2>
        {admin ? (
          <>
            <p className="text-zinc-500">Add bootstrap brokers, optional SASL and TLS, test the connection, and start browsing.</p>
            <ButtonLink to="/clusters/new" variant="primary">
              Add connection
            </ButtonLink>
          </>
        ) : (
          <p className="text-zinc-500">No clusters are shared with your account yet. Ask an administrator for access.</p>
        )}
      </div>
    </div>
  );
}
