/**
 * CONFIRMATION THAT DOES NOT ASK FOR ANYTHING.
 *
 * A sent Challenge is finished business. It needs a receipt, not a dialog: one
 * line, bottom centre, gone by itself. No dependency and no provider — a module
 * store plus one host mounted at the root, because a toast that lives inside a
 * screen dies the moment that screen advances, which is exactly when this one
 * has to still be readable.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "bad";
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let seq = 0;
const emit = () => listeners.forEach((l) => l());

export function notify(text: string, tone: Toast["tone"] = "ok") {
  const id = ++seq;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 2600);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const empty: Toast[] = [];

export function Toasts() {
  const list = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => empty,
  );
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastRow({ toast }: { toast: Toast }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      role="status"
      className={`rounded-full border px-4 py-2 text-[12.5px] font-medium shadow-lg transition-all duration-200 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
      style={{
        background: "var(--surface)",
        borderColor: toast.tone === "bad" ? "var(--no)" : "var(--border-strong)",
        color: "var(--text)",
      }}
    >
      {toast.text}
    </div>
  );
}
