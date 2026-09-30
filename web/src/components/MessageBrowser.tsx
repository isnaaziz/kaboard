import { useMutation, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, replayRecord, type Message, type ProduceRecord, type Progress } from "../api";
import { useBrowse, type BrowseParams, type Mode, type Status } from "../useBrowse";
import { MessageDetail } from "./MessageDetail";
import { options, Select } from "./Select";
import { toast } from "./Toast";
import { Button, cx, download, fmt, formatTime, Note, submit } from "./ui";

const modes: { value: Exclude<Mode, "tail">; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "offset", label: "From offset" },
  { value: "timestamp", label: "From time" },
];

const buffers = [500, 1_000, 5_000, 10_000, 50_000];

const scans = [5_000, 20_000, 100_000, 500_000, 2_000_000];

const examples = [
  'value.tag == "84044444_RTUVACH_20_SPARE-1010_IA_1801"',
  'value.id_rtu == 84044444 && value.flag == "ONLINE"',
  'value.protocol == "DNP3" && value.value > 1000',
  'raw.contains("OFFLINE") && partition == 0',
];

const formatColor: Record<string, string> = {
  json: "text-emerald-400 bg-emerald-500/10",
  string: "text-sky-400 bg-sky-500/10",
  hex: "text-amber-400 bg-amber-500/10",
  base64: "text-fuchsia-400 bg-fuchsia-500/10",
  null: "text-zinc-500 bg-zinc-500/10",
};

const statusColor: Record<Status, string> = {
  idle: "bg-zinc-600",
  running: "bg-emerald-400 animate-pulse",
  done: "bg-indigo-400",
  error: "bg-rose-500",
};

const columns = "grid grid-cols-[28px_64px_96px_190px_minmax(80px,1fr)_minmax(200px,3fr)] items-center gap-3 px-3";

const key = (m: Message) => `${m.partition}:${m.offset}`;

type Column = "partition" | "offset" | "timestamp" | "key" | "value";
type Sort = { column: Column; desc: boolean } | null;

const headers: { column: Column; label: string }[] = [
  { column: "partition", label: "Partition" },
  { column: "offset", label: "Offset" },
  { column: "timestamp", label: "Timestamp" },
  { column: "key", label: "Key" },
  { column: "value", label: "Value" },
];

const text = new Intl.Collator(undefined, { numeric: true });

const comparators: Record<Column, (a: Message, b: Message) => number> = {
  partition: (a, b) => a.partition - b.partition || a.offset - b.offset,
  offset: (a, b) => a.offset - b.offset || a.partition - b.partition,
  timestamp: (a, b) => a.timestamp - b.timestamp || a.partition - b.partition || a.offset - b.offset,
  key: (a, b) => text.compare(a.key.text, b.key.text),
  value: (a, b) => text.compare(a.value.text, b.value.text),
};

const nextSort = (sort: Sort, column: Column): Sort =>
  sort?.column !== column ? { column, desc: false } : sort.desc ? null : { column, desc: true };

type FilterMode = "text" | "cel";

const matches = (m: Message, needle: string) =>
  m.value.text.toLowerCase().includes(needle) ||
  m.key.text.toLowerCase().includes(needle) ||
  m.headers.some((h) => h.key.toLowerCase().includes(needle) || h.value.toLowerCase().includes(needle));

type Params = Omit<BrowseParams, "mode" | "filter"> & { mode: Exclude<Mode, "tail">; time: string; buffer: number; query: string; filterMode: FilterMode };

type Props = { cluster: string; topic: string; readOnly: boolean; onEdit: (r: ProduceRecord) => void };

export function MessageBrowser({ cluster, topic, readOnly, onEdit }: Props) {
  const browse = useBrowse(cluster, topic);
  const formats = useQuery({ queryKey: ["formats"], queryFn: api.formats, staleTime: Infinity });
  const formatOptions = options(formats.data ?? ["auto"]);
  const [params, setParams] = useState<Params>({
    mode: "newest",
    limit: 100,
    time: "",
    buffer: 1_000,
    valueFormat: "auto",
    keyFormat: "auto",
    query: "",
    filterMode: "text",
    scanLimit: 20_000,
  });
  const [selected, setSelected] = useState<Message | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const running = browse.status === "running";
  const streaming = running && browse.live;

  const launch = (live: boolean, p: Params = params) => {
    setSelected(null);
    setChecked(new Set());
    const { time, buffer, query, filterMode, ...rest } = p;
    const where = filterMode === "cel" ? { filter: query.trim() } : { scanLimit: undefined };
    browse.start(
      live
        ? { ...rest, ...where, mode: "tail", limit: buffer }
        : { ...rest, ...where, timestamp: p.mode === "timestamp" && time ? new Date(time).getTime() : undefined },
    );
  };

  useEffect(() => launch(false), []);

  const onSubmit = () => {
    if (streaming) return launch(true);
    if (running) return browse.stop();
    launch(false);
  };

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const toggle = (m: Message) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key(m))) next.add(key(m));
      return next;
    });
  const needle = params.filterMode === "text" ? params.query.trim().toLowerCase() : "";
  const visible = useMemo(() => (needle ? browse.messages.filter((m) => matches(m, needle)) : browse.messages), [browse.messages, needle]);
  const picked = useMemo(() => visible.filter((m) => checked.has(key(m))), [visible, checked]);

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3" onSubmit={submit(onSubmit)}>
        <div className="flex flex-wrap items-center gap-2">
          <fieldset disabled={streaming} className="contents">
            <Select aria-label="Mode" className="w-36" value={params.mode} options={modes} onChange={(mode) => set("mode", mode)} />
            {params.mode === "offset" && (
              <input className="w-32" type="number" placeholder="offset" value={params.offset ?? ""} onChange={(e) => set("offset", e.target.value === "" ? undefined : +e.target.value)} />
            )}
            {params.mode === "timestamp" && <input type="datetime-local" step={1} value={params.time} onChange={(e) => set("time", e.target.value)} required={!streaming} />}
            <label>
              Limit
              <input className="w-24" type="number" min={1} max={10000} value={params.limit} onChange={(e) => set("limit", +e.target.value)} />
            </label>
          </fieldset>
          <input className="w-40" placeholder="partitions e.g. 0,2" value={params.partitions ?? ""} onChange={(e) => set("partitions", e.target.value)} />
          <label>
            Key
            <Select className="w-24" value={params.keyFormat ?? "auto"} options={formatOptions} onChange={(f) => set("keyFormat", f)} />
          </label>
          <label>
            Value
            <Select className="w-24" value={params.valueFormat ?? "auto"} options={formatOptions} onChange={(f) => set("valueFormat", f)} />
          </label>
          <div className="ml-auto flex items-center gap-2">
            {streaming ? (
              <>
                <Button type="button" onClick={() => browse.setPaused(!browse.paused)} className={cx(browse.paused && "border-amber-500/50 text-amber-300")}>
                  {browse.paused ? "Resume" : "Pause"}
                </Button>
                <Button type="button" onClick={browse.clear}>
                  Clear
                </Button>
                <Button type="button" variant="danger" onClick={browse.stop}>
                  Stop
                </Button>
              </>
            ) : running ? (
              <Button variant="danger" className="min-w-20 justify-center">
                Stop
              </Button>
            ) : (
              <>
                <label title="Live buffer: keep the most recent N messages">
                  Buffer
                  <Select className="w-24" align="right" value={params.buffer} options={options(buffers, (b) => fmt.format(b))} onChange={(b) => set("buffer", b)} />
                </label>
                <Button type="button" onClick={() => launch(true)} className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
                  <span className="size-2 rounded-full bg-emerald-400" />
                  Live
                </Button>
                <Button variant="primary" className="min-w-20 justify-center">
                  Run
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
            {(["text", "cel"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set("filterMode", m)}
                className={cx("cursor-pointer rounded px-2.5 py-1 font-medium transition", params.filterMode === m ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-300")}
              >
                {m === "text" ? "Text" : "CEL"}
              </button>
            ))}
          </div>
          <input
            className={cx("w-full text-xs", params.filterMode === "cel" && "font-mono")}
            placeholder={
              params.filterMode === "text"
                ? "Filter loaded messages by key, value or headers — e.g. 84044444_RTUVACH_20_SPARE-1010_IA_1801"
                : 'CEL expression, press Enter — e.g. value.tag == "83020004_RECAN_N_20" && value.flag == "ONLINE"'
            }
            value={params.query}
            onChange={(e) => set("query", e.target.value)}
          />
          {params.query && (
            <Button type="button" variant="link" onClick={() => setParams((p) => ({ ...p, query: "" }))}>
              clear
            </Button>
          )}
          {params.filterMode === "cel" && (
            <Select
              aria-label="Examples"
              className="w-32 shrink-0"
              align="right"
              value=""
              placeholder="Examples"
              options={examples.map((x) => ({ value: x, label: <code className="text-xs">{x}</code> }))}
              onChange={(x) => set("query", x)}
            />
          )}
          {params.filterMode === "cel" && (
            <label className="shrink-0" title="Maximum number of messages scanned on the server">
              Scan
              <Select className="w-28" align="right" value={params.scanLimit ?? 20_000} options={options(scans, (n) => fmt.format(n))} onChange={(n) => set("scanLimit", n)} />
            </label>
          )}
        </div>
        <span className="text-[11px] text-zinc-600">
          {params.filterMode === "text"
            ? needle
              ? `Showing ${fmt.format(visible.length)} of ${fmt.format(browse.messages.length)} loaded messages`
              : "Instant, case-insensitive filter on the messages already loaded — switch to CEL to search the topic on the server"
            : "Scans the topic on the server, press Enter to run · variables: key · value · raw · headers · partition · offset · timestamp · size"}
        </span>
      </form>

      {browse.live && browse.status !== "idle" ? (
        <LiveBar browse={browse} />
      ) : (
        <StatusBar status={browse.status} error={browse.error} progress={browse.progress} count={browse.messages.length} />
      )}

      {picked.length > 0 && <Selection cluster={cluster} topic={topic} messages={picked} readOnly={readOnly} onClear={() => setChecked(new Set())} />}

      <div className={cx("grid gap-3", selected ? "grid-cols-[minmax(0,1fr)_minmax(320px,440px)]" : "grid-cols-1")}>
        <MessageTable messages={visible} selected={selected} checked={checked} onSelect={setSelected} onToggle={toggle} />
        {selected && <MessageDetail message={selected} onClose={() => setSelected(null)} onEdit={readOnly ? undefined : () => onEdit(replayRecord(selected))} />}
      </div>
    </div>
  );
}

function LiveBar({ browse }: { browse: ReturnType<typeof useBrowse> }) {
  const on = browse.status === "running";
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span
        className={cx(
          "inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-semibold tracking-wide",
          !on ? "bg-zinc-800 text-zinc-400" : browse.paused ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300",
        )}
      >
        <span className={cx("size-2 rounded-full", !on ? "bg-zinc-500" : browse.paused ? "bg-amber-400" : "animate-pulse bg-emerald-400")} />
        {!on ? "STOPPED" : browse.paused ? "PAUSED" : "LIVE"}
      </span>
      {on && <span className="text-zinc-300 tabular-nums">{fmt.format(browse.rate)} msg/s</span>}
      {browse.progress && (
        <span className="text-zinc-500 tabular-nums">
          received {fmt.format(browse.progress.scanned)} · matched {fmt.format(browse.progress.matched)} · showing {fmt.format(browse.messages.length)}
        </span>
      )}
      {browse.paused && browse.queued > 0 && (
        <button className="cursor-pointer text-amber-300 hover:underline" onClick={() => browse.setPaused(false)}>
          {fmt.format(browse.queued)} new — resume
        </button>
      )}
      {browse.error && <Note>{browse.error}</Note>}
    </div>
  );
}

function StatusBar({ status, error, progress, count }: { status: Status; error: string | null; progress: Progress | null; count: number }) {
  const ratio = useMemo(() => {
    if (!progress) return 0;
    const total = progress.partitions.reduce((s, p) => s + (p.to - p.from), 0);
    const done = progress.partitions.reduce((s, p) => s + (p.done ? p.to - p.from : p.current - p.from), 0);
    return total ? done / total : 1;
  }, [progress]);

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className={cx("size-2 rounded-full", statusColor[status])} />
      <span className="font-medium">{status}</span>
      {progress && (
        <span className="text-zinc-500 tabular-nums">
          scanned {fmt.format(progress.scanned)} · matched {fmt.format(progress.matched)} · showing {fmt.format(count)}
        </span>
      )}
      {progress && (
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-zinc-800" title={progress.partitions.map((p) => `p${p.partition}: ${p.current}/${p.to}`).join("\n")}>
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      )}
      {error && <Note>{error}</Note>}
    </div>
  );
}

function Selection({ cluster, topic, messages, readOnly, onClear }: { cluster: string; topic: string; messages: Message[]; readOnly: boolean; onClear: () => void }) {
  const [target, setTarget] = useState(topic);
  const replay = useMutation({
    mutationFn: () => api.produce(cluster, target, messages.map(replayRecord)),
    meta: { error: "Replay failed" },
    onSuccess: (sent) => toast.success(`Replayed ${fmt.format(sent.length)} message${sent.length > 1 ? "s" : ""}`, `→ ${target}`),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2">
      <strong className="text-indigo-300">{messages.length} selected</strong>
      <Button
        onClick={() => {
          download(`${topic}-messages.json`, messages);
          toast.success("Exported", `${fmt.format(messages.length)} messages → ${topic}-messages.json`);
        }}
      >
        Export JSON
      </Button>
      {!readOnly && (
        <form className="flex items-center gap-2" onSubmit={submit(replay.mutate)}>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target topic" required />
          <Button variant="primary" disabled={replay.isPending}>
            Replay
          </Button>
        </form>
      )}
      <Button variant="link" onClick={onClear}>
        clear
      </Button>
    </div>
  );
}

type TableProps = {
  messages: Message[];
  selected: Message | null;
  checked: Set<string>;
  onSelect: (m: Message) => void;
  onToggle: (m: Message) => void;
};

function MessageTable({ messages: raw, selected, checked, onSelect, onToggle }: TableProps) {
  const parent = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<Sort>(null);
  const messages = useMemo(() => {
    if (!sort) return raw;
    const compare = comparators[sort.column];
    return [...raw].sort(sort.desc ? (a, b) => compare(b, a) : compare);
  }, [raw, sort]);
  const rows = useVirtualizer({ count: messages.length, getScrollElement: () => parent.current, estimateSize: () => 32, overscan: 20 });

  return (
    <div ref={parent} className="h-[calc(100vh-380px)] min-h-80 overflow-auto rounded-lg border border-zinc-800">
      <div className={cx(columns, "sticky top-0 z-10 h-8 border-b border-zinc-800 bg-zinc-900 text-xs font-medium text-zinc-500")}>
        <span />
        {headers.map((h) => (
          <button
            key={h.column}
            type="button"
            onClick={() => setSort((s) => nextSort(s, h.column))}
            className={cx("flex cursor-pointer items-center gap-1 text-left transition hover:text-zinc-200", sort?.column === h.column && "text-zinc-100")}
          >
            {h.label}
            <span className="text-[10px]">{sort?.column === h.column ? (sort.desc ? "▼" : "▲") : ""}</span>
          </button>
        ))}
      </div>
      {messages.length === 0 && <p className="p-4 text-zinc-500">No messages.</p>}
      <div className="relative" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((row) => {
          const m = messages[row.index];
          const k = key(m);
          return (
            <div
              key={k}
              onClick={() => onSelect(m)}
              style={{ transform: `translateY(${row.start}px)` }}
              className={cx(
                columns,
                "absolute inset-x-0 top-0 h-8 cursor-pointer border-b border-zinc-800/50 tabular-nums text-xs",
                selected && key(selected) === k ? "bg-indigo-500/15" : "hover:bg-zinc-800/40",
              )}
            >
              <span onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={checked.has(k)} onChange={() => onToggle(m)} />
              </span>
              <span>{m.partition}</span>
              <span>{m.offset}</span>
              <span className="text-zinc-400">{formatTime(m.timestamp)}</span>
              <span className="truncate">{m.key.format === "null" ? <i className="text-zinc-600">null</i> : m.key.text}</span>
              <span className="flex min-w-0 items-center gap-2">
                <em className={cx("shrink-0 rounded px-1 text-[10px] not-italic uppercase", formatColor[m.value.format] ?? formatColor.null)}>{m.value.format}</em>
                <span className="truncate">{m.value.text.slice(0, 400)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
