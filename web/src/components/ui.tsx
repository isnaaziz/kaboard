import { useQuery } from "@tanstack/react-query";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { Link, useParams, type LinkProps } from "react-router";
import { api } from "../api";
import { allows, useAuth } from "../auth";

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export const fmt = new Intl.NumberFormat();

export const formatTime = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

export const formatBytes = (n: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i ? n.toFixed(1) : n} ${units[i]}`;
};

const jsonFormats = new Set(["json", "avro", "protobuf", "json-schema"]);

export const pretty = (text: string, format: string) => {
  if (!jsonFormats.has(format)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

export function useCluster() {
  const cluster = useParams().cluster ?? "";
  const auth = useAuth();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: Infinity });
  const info = clusters.data?.find((c) => c.name === cluster);
  const role = auth.roleFor(cluster);
  const locked = info?.readOnly ?? true;
  return { cluster, role, readOnly: locked || !allows(role, "operator"), canAdmin: !locked && allows(role, "admin") };
}

export type Tone = "ok" | "warn" | "bad" | "muted" | "info";

const tones: Record<Tone, string> = {
  ok: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  warn: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  bad: "bg-rose-500/10 text-rose-400 ring-rose-500/20",
  muted: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
  info: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/20",
};

export const textTone: Record<Tone, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-rose-400",
  muted: "text-zinc-500",
  info: "text-indigo-300",
};

const variants = {
  default: "border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
  primary: "bg-indigo-600 text-white hover:bg-indigo-500",
  danger: "bg-rose-600 text-white hover:bg-rose-500",
  link: "px-1! text-indigo-400 hover:text-indigo-300",
};

type Variant = keyof typeof variants;

const buttonClass = (variant: Variant, className?: string) =>
  cx("inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50", variants[variant], className);

export function Button({ variant = "default", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({ variant = "default", className, ...props }: LinkProps & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", tones[tone])}>{children}</span>;
}

export function Page({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="truncate text-xl font-semibold text-zinc-50">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </header>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-zinc-400">
        {label} {hint && <span className="text-zinc-600">— {hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <div className={cx("flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3", className)} {...props} />;
}

export function Query<T>({ q, children }: { q: { data?: T; error: Error | null; isPending: boolean }; children: (data: T) => ReactNode }) {
  if (q.error) return <Alert>{q.error.message}</Alert>;
  if (q.isPending || q.data === undefined) return <p className="p-4 text-zinc-500">Loading…</p>;
  return <>{children(q.data)}</>;
}

export function Alert({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">{children}</div>;
}

export function Note({ tone = "bad", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("text-xs", textTone[tone])}>{children}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <nav className="flex gap-1 border-b border-zinc-800">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={cx("-mb-px cursor-pointer border-b-2 px-3 py-2 font-medium transition", t === value ? "border-indigo-500 text-zinc-50" : "border-transparent text-zinc-500 hover:text-zinc-300")}
        >
          {t}
        </button>
      ))}
    </nav>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">{children}</div>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <span className="text-xs text-zinc-500">{label}</span>
      <strong className={cx("truncate text-lg font-semibold", tone ? textTone[tone] : "text-zinc-50")}>{value}</strong>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  );
}

export function Th({ num, className, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <th className={cx("border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-500", num && "text-right", className)} {...props} />;
}

export function Td({ num, dense, className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean; dense?: boolean }) {
  return <td className={cx("border-b border-zinc-800/60 px-3 py-2", num && "text-right tabular-nums", dense && "text-xs tabular-nums", className)} {...props} />;
}

export const Tr = ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => <tr className={cx("hover:bg-zinc-800/40", className)} {...props} />;

export const stateTone = (state: string): Tone =>
  (({ Stable: "ok", Empty: "muted", Dead: "bad", PreparingRebalance: "warn", CompletingRebalance: "warn" }) as Record<string, Tone>)[state] ?? "info";

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export const submit = (fn: () => void) => (e: { preventDefault(): void }) => {
  e.preventDefault();
  fn();
};
