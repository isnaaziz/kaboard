import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, cx, Page, Query, Table, Td, Th, Tr } from "../components/ui";

const timeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });

export function Audit() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const q = useQuery({ queryKey: ["audit", query], queryFn: () => api.audit(query), refetchInterval: 10_000, placeholderData: (prev) => prev });

  return (
    <Page
      title="Audit log"
      actions={<input className="w-80" placeholder="Search user, action, cluster, target, IP…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />}
    >
      <Query q={q}>
        {(entries) => (
          <div className={cx("transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
            <Table>
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>User</Th>
                  <Th>Action</Th>
                  <Th>Cluster</Th>
                  <Th>Target</Th>
                  <Th>Detail</Th>
                  <Th>Result</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <Td colSpan={8} className="text-zinc-500">
                      No entries
                    </Td>
                  </tr>
                )}
                {entries.map((e, i) => (
                  <Tr key={`${e.time}-${i}`}>
                    <Td dense className="whitespace-nowrap text-zinc-400">
                      {timeFmt.format(new Date(e.time))}
                    </Td>
                    <Td className="font-medium text-zinc-100">{e.user || "—"}</Td>
                    <Td>{e.action}</Td>
                    <Td className="text-zinc-400">{e.cluster || "—"}</Td>
                    <Td className="max-w-48 truncate text-zinc-300" title={e.target}>
                      {e.target || "—"}
                    </Td>
                    <Td className="max-w-80 truncate text-xs text-zinc-500" title={e.detail}>
                      {e.detail || "—"}
                    </Td>
                    <Td>{e.status < 400 ? <Badge tone="ok">✓ {e.status}</Badge> : <Badge tone="bad">✕ {e.status}</Badge>}</Td>
                    <Td dense className="text-zinc-500">
                      {e.ip}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Query>
      <p className="text-xs text-zinc-600">Showing the most recent {q.data?.length ?? 0} entries · stored in data/audit.log</p>
    </Page>
  );
}
