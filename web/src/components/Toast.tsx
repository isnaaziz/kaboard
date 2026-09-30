import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cx } from "./ui";

type Tone = "success" | "error" | "info";

type Item = { id: number; tone: Tone; title: string; description?: string };

const tones: Record<Tone, { icon: string; color: string; label: string }> = {
  success: { icon: "✓", color: "#0ca30c", label: "Success" },
  error: { icon: "✕", color: "#d03b3b", label: "Error" },
  info: { icon: "i", color: "#6366f1", label: "Info" },
};

const maxVisible = 5;

let items: Item[] = [];
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(tone: Tone, title: string, description?: string) {
  const id = ++seq;
  items = [...items.slice(-(maxVisible - 1)), { id, tone, title, description }];
  emit();
  window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
}

export const toast = {
  success: (title: string, description?: string) => push("success", title, description),
  error: (title: string, description?: string) => push("error", title, description),
  info: (title: string, description?: string) => push("info", title, description),
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items);
  return createPortal(
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 shadow-xl shadow-black/40 backdrop-blur"
        >
          <span
            className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-black"
            style={{ background: tones[t.tone].color }}
            role="img"
            aria-label={tones[t.tone].label}
          >
            {tones[t.tone].icon}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <strong className="font-medium text-zinc-50">{t.title}</strong>
            {t.description && <span className={cx("text-xs break-words", t.tone === "error" ? "text-rose-300" : "text-zinc-400")}>{t.description}</span>}
          </div>
          <button onClick={() => dismiss(t.id)} className="cursor-pointer text-zinc-500 transition hover:text-zinc-200" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
