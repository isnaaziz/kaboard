import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, cx, submit } from "./ui";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
};

const sizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" };

export function Modal({ open, onClose, title, description, children, footer, size = "sm" }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center p-4">
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx("animate-modal-in relative flex w-full flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60", sizes[size])}>
        <header className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-base font-semibold text-zinc-50">
              {title}
            </h2>
            {description && <p className="text-zinc-400">{description}</p>}
          </div>
          <button onClick={onClose} className="cursor-pointer text-zinc-500 transition hover:text-zinc-200" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireText?: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setPending({ ...o, resolve });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  const blocked = !!pending?.requireText && typed !== pending.requireText;
  const cancel = useCallback(() => close(false), [close]);

  return (
    <ConfirmContext value={confirm}>
      {children}
      <Modal
        open={!!pending}
        onClose={cancel}
        title={pending?.title}
        footer={
          <>
            <Button onClick={cancel}>Cancel</Button>
            <Button variant={pending?.danger ? "danger" : "primary"} disabled={blocked} onClick={() => close(true)} autoFocus={!pending?.requireText}>
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {pending?.message && <div className="text-zinc-300">{pending.message}</div>}
        {pending?.requireText && (
          <form className="flex flex-col gap-1.5" onSubmit={submit(() => !blocked && close(true))}>
            <span className="text-xs text-zinc-400">
              Type <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-100">{pending.requireText}</code> to confirm
            </span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} autoComplete="off" />
          </form>
        )}
      </Modal>
    </ConfirmContext>
  );
}
