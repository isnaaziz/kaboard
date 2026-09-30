import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate, useParams } from "react-router";
import { api, onUnauthorized, type AuthState } from "./api";
import { AuthProvider, useAuth } from "./auth";
import { ChangePassword } from "./components/ChangePassword";
import { Menu } from "./components/Menu";
import { options, Select } from "./components/Select";
import { Alert, Badge, cx } from "./components/ui";
import { About } from "./pages/About";
import { Audit } from "./pages/Audit";
import { Brokers } from "./pages/Brokers";
import { ClusterForm } from "./pages/ClusterForm";
import { Clusters } from "./pages/Clusters";
import { GroupView } from "./pages/GroupView";
import { Groups } from "./pages/Groups";
import { Health } from "./pages/Health";
import { Login } from "./pages/Login";
import { Topics } from "./pages/Topics";
import { TopicView } from "./pages/TopicView";
import { Avatar, Users } from "./pages/Users";
import { ThemeToggle } from "./theme";

export function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route index element={<Home />} />
          <Route element={<Shell />}>
            <Route path="about" element={<About />} />
            <Route path="clusters" element={<Clusters />} />
            <Route path="clusters/new" element={<AdminOnly><ClusterForm /></AdminOnly>} />
            <Route path="clusters/:name/edit" element={<AdminOnly><ClusterForm /></AdminOnly>} />
            <Route path="users" element={<AdminOnly><Users /></AdminOnly>} />
            <Route path="audit" element={<AdminOnly><Audit /></AdminOnly>} />
            <Route path="c/:cluster">
              <Route index element={<Navigate to="topics" replace />} />
              <Route path="topics" element={<Topics />} />
              <Route path="topics/:topic" element={<TopicView />} />
              <Route path="groups" element={<Groups />} />
              <Route path="groups/:group" element={<GroupView />} />
              <Route path="brokers" element={<Brokers />} />
              <Route path="health" element={<Health />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["auth"], queryFn: api.authState, staleTime: Infinity, retry: false });

  useEffect(() => onUnauthorized(() => client.setQueryData<AuthState>(["auth"], (s) => ({ setupRequired: s?.setupRequired ?? false }))), [client]);

  if (q.error)
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <Alert>{q.error.message}</Alert>
      </div>
    );
  if (!q.data) return null;
  if (q.data.setupRequired) return <Login mode="setup" />;
  if (!q.data.user) return <Login mode="login" />;
  return <AuthProvider user={q.data.user}>{children}</AuthProvider>;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/" replace />;
}

function Home() {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: Infinity });
  if (clusters.error)
    return (
      <div className="p-6">
        <Alert>{clusters.error.message}</Alert>
      </div>
    );
  if (!clusters.data) return null;
  const first = clusters.data[0];
  return <Navigate to={first ? `/c/${encodeURIComponent(first.name)}/topics` : "/clusters"} replace />;
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx("rounded-md px-2.5 py-1.5 transition", isActive ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200");

function Shell() {
  const { cluster } = useParams();
  const navigate = useNavigate();
  const { isAdmin, roleFor } = useAuth();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: Infinity });
  const info = clusters.data?.find((c) => c.name === cluster);
  const base = cluster ? `/c/${encodeURIComponent(cluster)}` : "";

  return (
    <div className="grid h-screen grid-cols-[220px_1fr]">
      <aside className="flex min-h-0 flex-col gap-3 border-r border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-2 flex items-center gap-2 text-base font-bold text-zinc-50">
          <span className="grid size-7 place-items-center rounded-lg bg-indigo-600 text-white">K</span>
          Kaboard
        </div>
        <Select
          aria-label="Cluster"
          value={cluster ?? ""}
          placeholder="Select cluster…"
          options={options(clusters.data?.map((c) => c.name) ?? [])}
          onChange={(name) => navigate(`/c/${encodeURIComponent(name)}/topics`)}
        />
        {cluster && (
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="info">{roleFor(cluster)}</Badge>
            {info?.readOnly && <Badge tone="warn">read-only</Badge>}
          </div>
        )}
        {cluster && (
          <nav className="flex flex-col gap-0.5">
            <NavLink to={`${base}/health`} className={navClass}>
              Health
            </NavLink>
            <NavLink to={`${base}/topics`} className={navClass}>
              Topics
            </NavLink>
            <NavLink to={`${base}/groups`} className={navClass}>
              Consumer Groups
            </NavLink>
            <NavLink to={`${base}/brokers`} className={navClass}>
              Brokers
            </NavLink>
          </nav>
        )}
        <div className="mt-auto flex flex-col gap-0.5">
          {info && <p className="mb-2 text-[11px] break-all text-zinc-600 tabular-nums">{info.brokers.join(", ")}</p>}
          <NavLink to="/clusters" end className={navClass}>
            Connections
          </NavLink>
          {isAdmin && (
            <>
              <NavLink to="/users" className={navClass}>
                Users
              </NavLink>
              <NavLink to="/audit" className={navClass}>
                Audit log
              </NavLink>
            </>
          )}
          <NavLink to="/about" className={navClass}>
            About
          </NavLink>
          <div className="mt-2 flex flex-col gap-2 border-t border-zinc-800 pt-3">
            <ThemeToggle />
            <Account />
          </div>
        </div>
      </aside>
      <main className="min-w-0 overflow-auto">
        <Outlet key={cluster} />
      </main>
    </div>
  );
}

function Account() {
  const { user, logout } = useAuth();
  const [changing, setChanging] = useState(false);
  return (
    <>
      <Menu
        label="Account"
        placement="top"
        items={[
          { label: "Change password", onSelect: () => setChanging(true) },
          "divider",
          { label: "Sign out", onSelect: logout, danger: true },
        ]}
      >
        <Avatar name={user.username} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-zinc-100">{user.username}</span>
          <span className="text-xs text-zinc-500">{user.role}</span>
        </span>
      </Menu>
      <ChangePassword open={changing} onClose={() => setChanging(false)} />
    </>
  );
}
