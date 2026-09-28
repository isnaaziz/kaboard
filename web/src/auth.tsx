import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { api, type AuthState, type Principal, type Role } from "./api";

const rank: Record<Role, number> = { none: 0, viewer: 1, operator: 2, admin: 3 };

export const allows = (role: Role, need: Role) => rank[role] >= rank[need];

export const roleFor = (user: Principal, cluster: string): Role => (user.role === "admin" ? "admin" : (user.clusters[cluster] ?? user.role));

type AuthContextValue = {
  user: Principal;
  isAdmin: boolean;
  roleFor: (cluster: string) => Role;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function useSignIn() {
  const client = useQueryClient();
  return useCallback(
    (user: Principal) => {
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      client.setQueryData<AuthState>(["auth"], { setupRequired: false, user });
    },
    [client],
  );
}

export function AuthProvider({ user, children }: { user: Principal; children: ReactNode }) {
  const client = useQueryClient();

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    client.setQueryData<AuthState>(["auth"], { setupRequired: false });
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAdmin: user.role === "admin", roleFor: (cluster) => roleFor(user, cluster), logout }),
    [user, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
