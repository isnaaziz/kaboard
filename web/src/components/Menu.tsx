import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePopover } from "./popover";
import { cx } from "./ui";

export type MenuItem = { label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | "divider";

type Props = { items: MenuItem[]; label?: string; placement?: "auto" | "top"; children?: ReactNode };

export function Menu({ items, label = "Actions", placement = "auto", children }: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { anchor, panel, style } = usePopover<HTMLButtonElement, HTMLDivElement>(open, close, {
    align: children ? "left" : "right",
    placement,
    matchWidth: !!children,
  });

  return (
    <>
      <button
        ref={anchor}
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
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={style}
            className="animate-pop-in z-[95] min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl shadow-black/20"
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
                    close();
                    item.onSelect();
                  }}
                  className={cx(
                    "flex w-full cursor-pointer items-center rounded-md px-2.5 py-1.5 text-left whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-40",
                    item.danger ? "text-rose-400 hover:bg-rose-500/10" : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50",
                  )}
                >
                  {item.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
