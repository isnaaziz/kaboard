import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Header, type ProduceRecord } from "../api";
import { options, Select } from "./Select";
import { toast } from "./Toast";
import { Button, fmt, Note, submit } from "./ui";

const encodings = options(["string", "json", "hex", "base64"]);

type Props = { cluster: string; topic: string; partitions: number; draft?: ProduceRecord };

export function ProduceForm({ cluster, topic, partitions, draft }: Props) {
  const client = useQueryClient();
  const [partition, setPartition] = useState(draft?.partition?.toString() ?? "");
  const [key, setKey] = useState(draft?.key ?? "");
  const [value, setValue] = useState(draft?.value ?? "");
  const [keyEncoding, setKeyEncoding] = useState(draft?.keyEncoding ?? "string");
  const [valueEncoding, setValueEncoding] = useState(draft?.valueEncoding ?? "string");
  const [headers, setHeaders] = useState<Header[]>(draft?.headers ?? []);
  const [count, setCount] = useState(1);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const produce = useMutation({
    mutationFn: () => {
      const record: ProduceRecord = {
        key: key === "" ? null : key,
        value,
        keyEncoding,
        valueEncoding,
        headers: headers.filter((h) => h.key),
        partition: partition === "" ? null : +partition,
      };
      return api.produce(cluster, topic, Array.from({ length: count }, () => record));
    },
    meta: { error: "Produce failed" },
    onSuccess: (sent) => {
      client.invalidateQueries({ queryKey: ["topic", cluster, topic] });
      toast.success(sent.length > 1 ? `${fmt.format(sent.length)} messages produced` : "Message produced", `${topic} · partition ${sent[0].partition} · offset ${fmt.format(sent[0].offset)}`);
    },
  });

  const format = () => {
    try {
      setValue(JSON.stringify(JSON.parse(value), null, 2));
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const setHeader = (i: number, patch: Partial<Header>) => setHeaders(headers.map((h, j) => (i === j ? { ...h, ...patch } : h)));

  return (
    <form className="flex max-w-4xl flex-col gap-3" onSubmit={submit(produce.mutate)}>
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Partition
          <Select
            className="w-44"
            value={partition}
            options={[{ value: "", label: "Auto (by key)" }, ...Array.from({ length: partitions }, (_, i) => ({ value: String(i), label: `Partition ${i}` }))]}
            onChange={setPartition}
          />
        </label>
        <label>
          Copies
          <input className="w-24" type="number" min={1} max={10000} value={count} onChange={(e) => setCount(+e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <input className="flex-1 tabular-nums text-xs" placeholder="key (empty = null)" value={key} onChange={(e) => setKey(e.target.value)} />
        <Encoding value={keyEncoding} onChange={setKeyEncoding} />
      </div>
      <textarea
        className="font-mono text-xs"
        rows={14}
        placeholder='{"hello": "kafka"}'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <Encoding value={valueEncoding} onChange={setValueEncoding} />
        <Button type="button" onClick={format}>
          Format JSON
        </Button>
        {jsonError && <Note>{jsonError}</Note>}
      </div>
      <fieldset className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3">
        <legend className="px-1 text-xs text-zinc-500">Headers</legend>
        {headers.map((h, i) => (
          <div className="flex gap-2" key={i}>
            <input className="w-48 tabular-nums text-xs" placeholder="key" value={h.key} onChange={(e) => setHeader(i, { key: e.target.value })} />
            <input className="flex-1 tabular-nums text-xs" placeholder="value" value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} />
            <Button type="button" variant="link" onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>
              remove
            </Button>
          </div>
        ))}
        <Button type="button" className="self-start" onClick={() => setHeaders([...headers, { key: "", value: "" }])}>
          Add header
        </Button>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={produce.isPending}>
          Produce
        </Button>
      </div>
    </form>
  );
}

function Encoding({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select aria-label="Encoding" className="w-28" value={value} options={encodings} onChange={onChange} />;
}
