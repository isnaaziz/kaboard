import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, type Health as HealthData, type HealthStatus, type PartitionCell } from "../api";
import { LineChart } from "../components/LineChart";
import { Badge, cx, fmt, Page, Query, Section, Stat, Stats, stateTone, Table, Td, Th, Tr, useCluster } from "../components/ui";

const series = {
  produced: "var(--series-produced)",
  consumed: "var(--series-consumed)",
  lag: "var(--series-lag)",
};

const status: Record<HealthStatus, { color: string; icon: string; label: string; banner: string }> = {
  good: { color: "#0ca30c", icon: "✓", label: "Healthy", banner: "It's all good" },
  warning: { color: "#fab219", icon: "!", label: "Warning", banner: "Needs attention" },
  critical: { color: "#d03b3b", icon: "✕", label: "Critical", banner: "Critical issues detected" },
};

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const rate = (v: number) => (v < 10 ? v.toFixed(1) : compact.format(v));
const count = (v: number) => compact.format(Math.round(v));

export function Health() {
  const { cluster } = useCluster();
  const q = useQuery({ queryKey: ["health", cluster], queryFn: () => api.health(cluster), refetchInterval: 5_000 });

  return (
    <Page title="Health">
      <Query q={q}>{(h) => <Dashboard cluster={cluster} health={h} />}</Query>
    </Page>
  );
}

function Dashboard({ cluster, health: h }: { cluster: string; health: HealthData }) {
  const last = h.series.at(-1);
  const produced = useMemo(() => h.series.map((p) => ({ t: p.t, v: p.produced })), [h.series]);
  const consumed = useMemo(() => h.series.map((p) => ({ t: p.t, v: p.consumed })), [h.series]);
  const lag = useMemo(() => h.series.map((p) => ({ t: p.t, v: p.lag })), [h.series]);
  const issues = h.checks.filter((c) => c.status !== "good").length;

  return (
    <>
      <Banner health={h} issues={issues} />
      <Stats>
        <Stat label="Produced" value={last ? `${rate(last.produced)} msg/s` : "—"} />
        <Stat label="Consumed" value={last ? `${rate(last.consumed)} msg/s` : "—"} />
        <Stat label="Total lag" value={last ? fmt.format(last.lag) : "—"} />
        <Stat label="Brokers" value={`${h.brokers} / ${h.expectedBrokers}`} tone={h.brokers < h.expectedBrokers ? "bad" : undefined} />
        <Stat label="Partitions" value={fmt.format(h.partitions)} tone={h.offline ? "bad" : h.underReplicated ? "warn" : undefined} />
        <Stat label="Consumer groups" value={fmt.format(h.groups)} />
      </Stats>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Write" subtitle="Produced per second (msg/s)" latest={last && rate(last.produced)} latestLabel="Produced" color={series.produced}>
          <LineChart data={produced} color={series.produced} format={rate} />
        </ChartCard>
        <ChartCard title="Read" subtitle="Consumed per second (msg/s)" latest={last && rate(last.consumed)} latestLabel="Consumed" color={series.consumed}>
          <LineChart data={consumed} color={series.consumed} format={rate} />
        </ChartCard>
      </div>
      <ChartCard title="Lag" subtitle="Total consumer lag (messages)" latest={last && fmt.format(last.lag)} latestLabel="Lag" color={series.lag}>
        <LineChart data={lag} color={series.lag} format={count} height={150} />
      </ChartCard>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Section title="Health checks">
          <div className="flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/60">
            {h.checks.map((c) => (
              <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                <StatusIcon status={c.status} />
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium text-zinc-100">{c.title}</span>
                  <span className="text-xs text-zinc-500">{c.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Top topics by throughput">
          <TopTopics cluster={cluster} health={h} />
        </Section>
      </div>

      <Section title="Partition health">
        <Heatmap cells={h.cells} />
      </Section>

      <Section title="Consumer groups">
        <Table>
          <thead>
            <tr>
              <Th>Group</Th>
              <Th>State</Th>
              <Th num>Members</Th>
              <Th num>Consumed msg/s</Th>
              <Th num>Lag</Th>
              <Th num>Lag change (1 min)</Th>
            </tr>
          </thead>
          <tbody>
            {h.groupList.map((g) => (
              <Tr key={g.name}>
                <Td>
                  <Link to={`/c/${encodeURIComponent(cluster)}/groups/${encodeURIComponent(g.name)}`}>{g.name}</Link>
                </Td>
                <Td>
                  <Badge tone={stateTone(g.state)}>{g.state}</Badge>
                </Td>
                <Td num>{g.members}</Td>
                <Td num>{rate(g.rate)}</Td>
                <Td num>{fmt.format(g.lag)}</Td>
                <Td num className={cx(g.lagDelta > 0 ? "text-amber-400" : g.lagDelta < 0 ? "text-emerald-400" : "text-zinc-500")}>
                  {g.lagDelta > 0 ? `▲ ${fmt.format(g.lagDelta)}` : g.lagDelta < 0 ? `▼ ${fmt.format(-g.lagDelta)}` : "—"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  );
}

function Banner({ health: h, issues }: { health: HealthData; issues: number }) {
  const s = status[h.status];
  const ago = Math.max(0, Math.round((Date.now() - h.updatedAt) / 1000));
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-5 py-4">
      <div className="flex items-center gap-4">
        <span className="grid size-11 place-items-center rounded-full text-lg font-bold text-black" style={{ background: s.color }} aria-hidden>
          {s.icon}
        </span>
        <div className="flex flex-col">
          <span className="text-xs text-zinc-500">Health assistant</span>
          <strong className="text-lg font-semibold text-zinc-50">{s.banner}</strong>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-xs text-zinc-500">
        <span>
          {s.label} · {issues ? `${issues} issue${issues > 1 ? "s" : ""}` : "all checks passing"}
        </span>
        <span className="tabular-nums">updated {ago}s ago · sampling every 5s · last hour</span>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, latest, latestLabel, color, children }: { title: string; subtitle: string; latest?: string; latestLabel: string; color: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="font-semibold text-zinc-50">{title}</span>
          <span className="text-xs text-zinc-500">{subtitle}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
            Latest {latestLabel.toLowerCase()}
          </span>
          <strong className="text-lg font-semibold text-zinc-50 tabular-nums">{latest ?? "—"}</strong>
        </div>
      </div>
      {children}
    </div>
  );
}

function StatusIcon({ status: s }: { status: HealthStatus }) {
  return (
    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-black" style={{ background: status[s].color }} role="img" aria-label={status[s].label}>
      {status[s].icon}
    </span>
  );
}

function TopTopics({ cluster, health: h }: { cluster: string; health: HealthData }) {
  const top = Math.max(1, ...h.topTopics.map((t) => t.rate));
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      {h.topTopics.length === 0 && <span className="text-zinc-500">No topics</span>}
      {h.topTopics.map((t) => (
        <div key={t.name} className="grid grid-cols-[minmax(0,12rem)_1fr_4.5rem] items-center gap-3" title={`${t.name}: ${rate(t.rate)} msg/s`}>
          <Link to={`/c/${encodeURIComponent(cluster)}/topics/${encodeURIComponent(t.name)}`} className="truncate text-xs text-zinc-300! hover:text-zinc-50!">
            {t.name}
          </Link>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full" style={{ width: `${(t.rate / top) * 100}%`, background: series.produced }} />
          </div>
          <span className="text-right text-xs text-zinc-200 tabular-nums">{rate(t.rate)}/s</span>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ cells }: { cells: PartitionCell[] }) {
  const [hover, setHover] = useState<PartitionCell | null>(null);
  const rows = useMemo(() => {
    const map = new Map<string, PartitionCell[]>();
    for (const c of cells) map.set(c.topic, [...(map.get(c.topic) ?? []), c]);
    return [...map.entries()];
  }, [cells]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex gap-4">
          {(Object.keys(status) as HealthStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-zinc-400">
              <span className="size-2.5 rounded-sm" style={{ background: status[s].color }} />
              {s === "good" ? "In sync" : s === "warning" ? "Under-replicated" : "Offline"}
            </span>
          ))}
        </div>
        <span className="text-zinc-400 tabular-nums">
          {hover
            ? `${hover.topic} · partition ${hover.partition} · leader ${hover.leader < 0 ? "none" : hover.leader} · ISR ${hover.isr}/${hover.replicas}`
            : "Hover a cell for details"}
        </span>
      </div>
      <div className="grid max-h-96 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-1.5 overflow-auto">
        {rows.map(([topic, parts]) => (
          <div key={topic} className="flex min-w-0 items-center gap-2">
            <span className="w-28 shrink-0 truncate text-[11px] text-zinc-500" title={topic}>
              {topic}
            </span>
            <div className="flex flex-wrap gap-0.5">
              {parts.map((p) => (
                <span
                  key={p.partition}
                  onPointerEnter={() => setHover(p)}
                  onPointerLeave={() => setHover(null)}
                  className="size-3 rounded-[3px] transition hover:scale-125"
                  style={{ background: status[p.status].color, opacity: p.status === "good" ? 0.75 : 1 }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
