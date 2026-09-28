import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Badge, cx, fmt, Page, Query, stateTone, Table, Td, Th, Tr, useCluster } from "../components/ui";

export function Groups() {
  const { cluster } = useCluster();
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["groups", cluster], queryFn: () => api.groups(cluster), refetchInterval: 5_000 });

  const rows = useMemo(() => {
    const needle = search.toLowerCase();
    return (q.data ?? []).filter((g) => g.name.toLowerCase().includes(needle) || g.topics.some((t) => t.toLowerCase().includes(needle)));
  }, [q.data, search]);

  return (
    <Page title="Consumer Groups" actions={<input className="w-72" placeholder="Search group or topic…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />}>
      <Query q={q}>
        {() => (
          <Table>
            <thead>
              <tr>
                <Th>Group</Th>
                <Th>State</Th>
                <Th num>Members</Th>
                <Th>Topics</Th>
                <Th num>Lag</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <Tr key={g.name}>
                  <Td>
                    <Link to={encodeURIComponent(g.name)}>{g.name}</Link>
                  </Td>
                  <Td>
                    <Badge tone={stateTone(g.state)}>{g.state}</Badge>
                  </Td>
                  <Td num>{g.members}</Td>
                  <Td className="max-w-md truncate text-zinc-500">{g.topics.join(", ")}</Td>
                  <Td num className={cx(g.lag > 0 && "text-amber-400")}>
                    {fmt.format(g.lag)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Query>
      <p className="text-xs text-zinc-500">{rows.length} groups</p>
    </Page>
  );
}
