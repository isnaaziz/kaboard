import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export type MenuItem = { label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | "divider";

type Props = { items: MenuItem[]; label?: string; placement?: "bottom" | "top"; children?: ReactNode };

export function Menu({ items, label = "Actions", placement = "bottom", children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "cursor-pointer rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100",
          children ? "flex w-full items-center gap-2.5 p-2 text-left" : "grid size-8 place-items-center",
          open && "bg-zinc-800 text-zinc-100",
        )}
      >
        {children ?? (
          <svg viewBox="0 0 16 16" className="size-4 fill-current" aria-hidden="true">
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={cx(
            "animate-pop-in absolute right-0 z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl shadow-black/50",
            placement === "top" ? "bottom-full mb-1 left-0" : "top-full mt-1",
          )}
        >
          {items.map((item, i) =>
            item === "divider" ? (
              <div key={i} className="my-1 h-px bg-zinc-800" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cx(
                  "flex w-full cursor-pointer items-center rounded-md px-2.5 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
                  item.danger ? "text-rose-400 hover:bg-rose-500/10" : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50",
                )}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
