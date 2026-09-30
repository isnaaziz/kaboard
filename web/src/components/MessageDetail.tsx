import { useState } from "react";
import type { Message } from "../api";
import { toast } from "./Toast";
import { Button, formatBytes, formatTime, pretty, Tabs } from "./ui";

const tabs = ["Value", "Key", "Headers", "Meta"] as const;
type Tab = (typeof tabs)[number];

type Props = { message: Message; onClose: () => void; onEdit?: () => void };

export function MessageDetail({ message: m, onClose, onEdit }: Props) {
  const [tab, setTab] = useState<Tab>("Value");
  const payload = tab === "Key" ? m.key : m.value;
  const text =
    tab === "Headers" ? JSON.stringify(Object.fromEntries(m.headers.map((h) => [h.key, h.value])), null, 2) : tab === "Meta" ? meta(m) : pretty(payload.text, payload.format);

  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard", `${tab} of p${m.partition} · #${m.offset}`),
      () => toast.error("Copy failed", "The browser blocked clipboard access"),
    );

  return (
    <aside className="flex h-[calc(100vh-380px)] min-h-80 flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <header className="flex items-center justify-between gap-2">
        <strong className="tabular-nums text-zinc-50">
          p{m.partition} · #{m.offset}
        </strong>
        <div className="flex items-center gap-1">
          <Button onClick={copy}>Copy</Button>
          {onEdit && <Button onClick={onEdit}>Edit & produce</Button>}
          <Button variant="link" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
      </header>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {(tab === "Value" || tab === "Key") && (
        <p className="text-xs text-zinc-500">
          {payload.format}
          {payload.schemaId !== undefined && ` · schema #${payload.schemaId}`} · {formatBytes(payload.size)}
        </p>
      )}
      <pre className="flex-1 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-xs break-all whitespace-pre-wrap text-zinc-300">{text}</pre>
    </aside>
  );
}

const meta = (m: Message) =>
  JSON.stringify(
    {
      partition: m.partition,
      offset: m.offset,
      timestamp: m.timestamp,
      time: formatTime(m.timestamp),
      iso: new Date(m.timestamp).toISOString(),
      keyFormat: m.key.format,
      keySize: m.key.size,
      valueFormat: m.value.format,
      valueSize: m.value.size,
      headers: m.headers.length,
    },
    null,
    2,
  );
