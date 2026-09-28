import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Badge, Page, Query, Stat, Stats, Table, Td, Th, Tr, useCluster } from "../components/ui";

export function Brokers() {
  const { cluster } = useCluster();
  const q = useQuery({ queryKey: ["overview", cluster], queryFn: () => api.overview(cluster), refetchInterval: 10_000 });

  return (
    <Page title="Brokers">
      <Query q={q}>
        {(o) => (
          <>
            <Stats>
              <Stat label="Cluster ID" value={o.clusterId || "—"} />
              <Stat label="Controller" value={o.controller} />
              <Stat label="Brokers" value={o.brokers.length} />
            </Stats>
            <Table>
              <thead>
                <tr>
                  <Th num>ID</Th>
                  <Th>Host</Th>
                  <Th num>Port</Th>
                  <Th>Rack</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {o.brokers.map((b) => (
                  <Tr key={b.id}>
                    <Td num>{b.id}</Td>
                    <Td dense>{b.host}</Td>
                    <Td num>{b.port}</Td>
                    <Td>{b.rack || "—"}</Td>
                    <Td>{b.controller && <Badge tone="ok">controller</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Query>
    </Page>
  );
}
