import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, requestHeaders, type Message, type Progress } from "./api";

export type Mode = "newest" | "oldest" | "offset" | "timestamp" | "tail";

export type BrowseParams = {
  mode: Mode;
  offset?: number;
  timestamp?: number;
  partitions?: string;
  limit: number;
  scanLimit?: number;
  filter?: string;
  keyFormat?: string;
  valueFormat?: string;
};

export type Status = "idle" | "running" | "done" | "error";

const maxKept = 50_000;
const flushMs = 100;

const ascending = (a: Message, b: Message) => a.timestamp - b.timestamp || a.partition - b.partition || a.offset - b.offset;
const descending = (a: Message, b: Message) => ascending(b, a);

type Session = { live: boolean; keep: number; paused: boolean; order: typeof ascending };

export function useBrowse(cluster: string, topic: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [paused, setPausedState] = useState(false);
  const [queued, setQueued] = useState(0);
  const [rate, setRate] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<Message[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const session = useRef<Session>({ live: false, keep: maxKept, paused: false, order: descending });
  const sample = useRef({ scanned: 0, at: 0 });

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const s = session.current;
    if (s.paused) {
      setQueued(pending.current.length);
      return;
    }
    const batch = pending.current;
    if (!batch.length) return;
    pending.current = [];
    setQueued(0);
    setMessages((prev) =>
      s.live ? [...batch.sort(descending), ...prev].slice(0, s.keep) : [...prev, ...batch].sort(s.order).slice(0, s.keep),
    );
  }, []);

  const receive = useCallback(
    (m: Message) => {
      const { keep } = session.current;
      pending.current.push(m);
      if (pending.current.length > keep * 2) pending.current = pending.current.slice(-keep);
      timer.current ??= window.setTimeout(flush, flushMs);
    },
    [flush],
  );

  const measure = useCallback((p: Progress) => {
    const now = performance.now();
    const prev = sample.current;
    if (prev.at && now > prev.at) setRate(Math.max(0, Math.round(((p.scanned - prev.scanned) * 1000) / (now - prev.at))));
    sample.current = { scanned: p.scanned, at: now };
    setProgress(p);
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);

  const setPaused = useCallback(
    (p: boolean) => {
      session.current.paused = p;
      setPausedState(p);
      if (!p) flush();
    },
    [flush],
  );

  const clear = useCallback(() => {
    pending.current = [];
    setQueued(0);
    setMessages([]);
  }, []);

  const start = useCallback(
    async (params: BrowseParams) => {
      stop();
      const controller = new AbortController();
      abort.current = controller;
      const isLive = params.mode === "tail";
      session.current = {
        live: isLive,
        keep: isLive ? params.limit : maxKept,
        paused: false,
        order: params.mode === "newest" ? descending : ascending,
      };
      sample.current = { scanned: 0, at: 0 };
      pending.current = [];
      setMessages([]);
      setProgress(null);
      setError(null);
      setLive(isLive);
      setPausedState(false);
      setQueued(0);
      setRate(0);
      setStatus("running");
      try {
        await readStream(api.messagesUrl(cluster, topic, params), controller.signal, (event, data) => {
          switch (event) {
            case "message":
              receive(data as Message);
              break;
            case "progress":
              measure(data as Progress);
              break;
            case "failure":
              throw new Error((data as { error: string }).error);
          }
        });
        setStatus("done");
      } catch (e) {
        if (controller.signal.aborted) setStatus("done");
        else {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      } finally {
        session.current.paused = false;
        setPausedState(false);
        setRate(0);
        flush();
        if (abort.current === controller) abort.current = null;
      }
    },
    [cluster, topic, flush, receive, measure, stop],
  );

  useEffect(() => stop, [stop]);

  return { messages, progress, status, error, live, paused, queued, rate, start, stop, setPaused, clear };
}

async function readStream(url: string, signal: AbortSignal, on: (event: string, data: unknown) => void) {
  const res = await fetch(url, { signal, headers: { ...requestHeaders, Accept: "text/event-stream" } });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (event === "done") return;
      on(event, data ? JSON.parse(data) : null);
    }
  }
}
