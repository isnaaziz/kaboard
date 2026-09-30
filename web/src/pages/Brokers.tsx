import { useQuery } from "@tanstack/react-query";
import { api, type BrokerDisk } from "../api";
import { Badge, cx, formatBytes, Page, Query, Stat, Stats, Table, Td, Th, Tr, useCluster } from "../components/ui";

const hint = "cursor-help underline decoration-dotted underline-offset-2";

const duration = (sec: number) => {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 2 * 86400) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} days`;
};

const fullIn = (d?: BrokerDisk) => {
  if (!d) return "—";
  if (d.growthPerSec === undefined) return <span className="text-zinc-500">measuring…</span>;
  if (d.total < 0) return <span className="text-zinc-400">{d.growthPerSec > 0 ? `+${formatBytes(d.growthPerSec * 3600)}/h` : "not growing"}</span>;
  if (d.fullInSec === undefined) return <span className="text-zinc-500">not growing</span>;
  return <span className={cx(d.fullInSec < 86400 ? "text-rose-400" : d.fullInSec < 7 * 86400 && "text-amber-400")}>{duration(d.fullInSec)}</span>;
};

function Usage({ d }: { d?: BrokerDisk }) {
  if (!d || d.total < 0) return <>—</>;
  const pct = ((d.total - d.free) / d.total) * 100;
  return (
    <span className="flex items-center gap-2" title={`${formatBytes(d.total - d.free)} of ${formatBytes(d.total)} used`}>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
        <span className={cx("block h-full rounded-full", pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">{pct.toFixed(0)}%</span>
      <span className="text-xs text-zinc-500">of {formatBytes(d.total)}</span>
    </span>
  );
}

export function Brokers() {
  const { cluster } = useCluster();
  const q = useQuery({ queryKey: ["overview", cluster], queryFn: () => api.overview(cluster), refetchInterval: 10_000 });
  const disks = useQuery({ queryKey: ["disks", cluster], queryFn: () => api.disks(cluster), refetchInterval: 30_000, retry: false });
  const byBroker = new Map((disks.data ?? []).map((d) => [d.broker, d]));
  const data = disks.data?.reduce((sum, d) => sum + d.data, 0);

  return (
    <Page title="Brokers">
      <Query q={q}>
        {(o) => (
          <>
            <Stats>
              <Stat label="Cluster ID" value={o.clusterId || "—"} />
              <Stat label="Controller" value={o.controller} />
              <Stat label="Brokers" value={o.brokers.length} />
              <Stat label="Kafka data" value={data === undefined ? "—" : formatBytes(data)} />
            </Stats>
            <Table>
              <thead>
                <tr>
                  <Th num>ID</Th>
                  <Th>Host</Th>
                  <Th num>Port</Th>
                  <Th>Rack</Th>
                  <Th num>Kafka data</Th>
                  <Th className={hint} title="Disk capacity is reported by Kafka 3.3 or newer. Older brokers only report the size of Kafka data, so Disk and Free stay empty.">
                    Disk
                  </Th>
                  <Th num>Free</Th>
                  <Th
                    className={hint}
                    title="Estimated from disk growth observed while this page is open (up to the last 2 hours); resets when Kaboard restarts. On Kafka older than 3.3 this shows how fast Kafka data grows instead."
                  >
                    Full in
                  </Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {o.brokers.map((b) => {
                  const d = byBroker.get(b.id);
                  return (
                    <Tr key={b.id}>
                      <Td num>{b.id}</Td>
                      <Td dense>{b.host}</Td>
                      <Td num>{b.port}</Td>
                      <Td>{b.rack || "—"}</Td>
                      <Td num>{d ? formatBytes(d.data) : "—"}</Td>
                      <Td>
                        <Usage d={d} />
                      </Td>
                      <Td num>{d && d.free >= 0 ? formatBytes(d.free) : "—"}</Td>
                      <Td>{fullIn(d)}</Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          {b.controller && <Badge tone="ok">controller</Badge>}
                          {d?.error && <Badge tone="bad">log dir error</Badge>}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            {disks.error && <p className="text-xs text-zinc-500">Disk usage unavailable: {disks.error.message}</p>}
          </>
        )}
      </Query>
    </Page>
  );
}
