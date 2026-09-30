export type Sasl = { mechanism: string; username: string; password?: string };
export type Tls = { enabled: boolean; insecureSkipVerify: boolean; ca?: string; cert?: string; key?: string };
export type SchemaRegistry = { url: string; username?: string; password?: string };
export type ClusterConfig = { name: string; brokers: string[]; readOnly: boolean; sasl?: Sasl | null; tls?: Tls | null; schemaRegistry?: SchemaRegistry | null };
export type ConnectionTest = { ok: boolean; latencyMs: number; error?: string; overview?: Overview };

export type Broker = { id: number; host: string; port: number; rack?: string; controller: boolean };
export type Overview = { clusterId: string; controller: number; brokers: Broker[] };

export type TopicSummary = {
  name: string;
  internal: boolean;
  partitions: number;
  replication: number;
  underReplicated: number;
  messages: number;
};

export type Partition = {
  id: number;
  leader: number;
  replicas: number[];
  isr: number[];
  offline: number[] | null;
  start: number;
  end: number;
};

export type ConfigEntry = { name: string; value: string; source: string; sensitive: boolean };
export type Topic = TopicSummary & { partitionList: Partition[]; configs: ConfigEntry[] };

export type GroupSummary = {
  name: string;
  state: string;
  protocolType: string;
  coordinator: number;
  members: number;
  topics: string[];
  lag: number;
  error?: string;
};

export type GroupMember = {
  id: string;
  instanceId?: string;
  clientId: string;
  host: string;
  assignments: { topic: string; partitions: number[] }[];
};

export type PartitionLag = {
  topic: string;
  partition: number;
  committed: number;
  start: number;
  end: number;
  lag: number;
  member?: string;
  error?: string;
};

export type Group = GroupSummary & { protocol: string; memberList: GroupMember[]; lags: PartitionLag[] };

export type Payload = { format: string; text: string; size: number; schemaId?: number; raw?: string };
export type Header = { key: string; value: string };

export type Message = {
  partition: number;
  offset: number;
  timestamp: number;
  key: Payload;
  value: Payload;
  headers: Header[];
};

export type PartitionProgress = { partition: number; from: number; to: number; current: number; done: boolean };
export type Progress = { scanned: number; matched: number; partitions: PartitionProgress[] };

export type HealthStatus = "good" | "warning" | "critical";
export type HealthPoint = { t: number; produced: number; consumed: number; lag: number };
export type HealthCheck = { id: string; status: HealthStatus; title: string; detail: string };
export type TopicRate = { name: string; rate: number; partitions: number; underReplicated: number; offline: number };
export type GroupHealth = { name: string; state: string; members: number; lag: number; lagDelta: number; rate: number };
export type PartitionCell = { topic: string; partition: number; leader: number; replicas: number; isr: number; status: HealthStatus };
export type Health = {
  status: HealthStatus;
  updatedAt: number;
  error?: string;
  brokers: number;
  expectedBrokers: number;
  controller: number;
  topics: number;
  partitions: number;
  underReplicated: number;
  offline: number;
  groups: number;
  checks: HealthCheck[];
  series: HealthPoint[];
  topTopics: TopicRate[];
  groupList: GroupHealth[];
  cells: PartitionCell[];
};

export type Role = "none" | "viewer" | "operator" | "admin";
export type Principal = { username: string; role: Exclude<Role, "none">; clusters: Record<string, Role> };
export type AuthState = { setupRequired: boolean; user?: Principal };
export type UserView = Principal & { disabled: boolean; createdAt: string; updatedAt: string };
export type UserInput = { username: string; password?: string; role: Exclude<Role, "none">; clusters: Record<string, Role>; disabled: boolean };
export type AuditEntry = { time: string; user: string; ip: string; action: string; cluster?: string; target?: string; detail?: string; status: number };

export type ProduceRecord = {
  key?: string | null;
  value?: string | null;
  keyEncoding?: string;
  valueEncoding?: string;
  headers?: Header[];
  partition?: number | null;
};

export type ResetMode = "earliest" | "latest" | "timestamp" | "offset" | "shift";
export type ResetOffsets = { topic: string; partitions?: number[]; mode: ResetMode; timestamp?: number; offset?: number };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let unauthorized = () => {};

export const onUnauthorized = (fn: () => void) => {
  unauthorized = fn;
};

export const requestHeaders = { "X-Kaboard-Request": "1" };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? requestHeaders : { ...requestHeaders, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401 && !path.startsWith("/auth/")) unauthorized();
    throw new ApiError(res.status, String(data.error ?? res.statusText).replace(/^(invalid request|conflict|not found): /, ""));
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const c = (cluster: string) => `/clusters/${encodeURIComponent(cluster)}`;
const t = (cluster: string, topic: string) => `${c(cluster)}/topics/${encodeURIComponent(topic)}`;
const g = (cluster: string, group: string) => `${c(cluster)}/groups/${encodeURIComponent(group)}`;

export const api = {
  authState: () => request<AuthState>("GET", "/auth/state"),
  setup: (username: string, password: string) => request<Principal>("POST", "/auth/setup", { username, password }),
  login: (username: string, password: string) => request<Principal>("POST", "/auth/login", { username, password }),
  logout: () => request<void>("POST", "/auth/logout"),
  changePassword: (current: string, next: string) => request<void>("POST", "/auth/password", { current, next }),
  users: () => request<UserView[]>("GET", "/users"),
  createUser: (body: UserInput) => request<UserView>("POST", "/users", body),
  updateUser: (username: string, body: UserInput) => request<UserView>("PUT", `/users/${encodeURIComponent(username)}`, body),
  deleteUser: (username: string) => request<void>("DELETE", `/users/${encodeURIComponent(username)}`),
  audit: (q: string) => request<AuditEntry[]>("GET", `/audit?limit=1000&q=${encodeURIComponent(q)}`),
  clusters: () => request<ClusterConfig[]>("GET", "/clusters"),
  createCluster: (body: ClusterConfig) => request<ClusterConfig>("POST", "/clusters", body),
  updateCluster: (original: string, body: ClusterConfig) => request<ClusterConfig>("PUT", c(original), body),
  deleteCluster: (cluster: string) => request<void>("DELETE", c(cluster)),
  testConnection: (cluster: ClusterConfig, original?: string) => request<ConnectionTest>("POST", "/connections/test", { cluster, original }),
  formats: () => request<string[]>("GET", "/formats"),
  overview: (cluster: string) => request<Overview>("GET", c(cluster)),
  health: (cluster: string) => request<Health>("GET", `${c(cluster)}/health`),
  topics: (cluster: string) => request<TopicSummary[]>("GET", `${c(cluster)}/topics`),
  topic: (cluster: string, topic: string) => request<Topic>("GET", t(cluster, topic)),
  createTopic: (cluster: string, body: { name: string; partitions: number; replication: number }) =>
    request<Topic>("POST", `${c(cluster)}/topics`, body),
  deleteTopic: (cluster: string, topic: string) => request<void>("DELETE", t(cluster, topic)),
  setPartitions: (cluster: string, topic: string, partitions: number) => request<void>("PUT", `${t(cluster, topic)}/partitions`, { partitions }),
  throughput: (cluster: string, topic: string) => request<HealthPoint[]>("GET", `${t(cluster, topic)}/throughput`),
  purgeTopic: (cluster: string, topic: string) => request<{ purged: number }>("DELETE", `${t(cluster, topic)}/messages`),
  alterConfigs: (cluster: string, topic: string, configs: Record<string, string | null>) =>
    request<void>("PATCH", `${t(cluster, topic)}/configs`, configs),
  produce: (cluster: string, topic: string, records: ProduceRecord[]) =>
    request<{ partition: number; offset: number }[]>("POST", `${t(cluster, topic)}/messages`, records),
  groups: (cluster: string) => request<GroupSummary[]>("GET", `${c(cluster)}/groups`),
  group: (cluster: string, group: string) => request<Group>("GET", g(cluster, group)),
  deleteGroup: (cluster: string, group: string) => request<void>("DELETE", g(cluster, group)),
  resetOffsets: (cluster: string, group: string, body: ResetOffsets) =>
    request<void>("POST", `${g(cluster, group)}/reset`, body),
  messagesUrl: (cluster: string, topic: string, params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    return `/api${t(cluster, topic)}/messages?${q}`;
  },
};

export const replayRecord = (m: Message): ProduceRecord => ({
  key: m.key.format === "null" ? null : (m.key.raw ?? m.key.text),
  value: m.value.format === "null" ? null : (m.value.raw ?? m.value.text),
  keyEncoding: encodingOf(m.key),
  valueEncoding: encodingOf(m.value),
  headers: m.headers,
});

const encodingOf = (p: Payload) => (p.raw ? "base64" : p.format === "hex" || p.format === "base64" ? p.format : "string");
