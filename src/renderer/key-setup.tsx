import { useEffect, useState, type FormEvent } from "react";

// Asks for the AI Gateway key on first launch, and again from the app menu's
// "Claude Key…". The key goes straight to the main process, which keeps it
// encrypted with the Keychain; this window never sees it again.

interface Props {
  hasKey: boolean;
  /** The key was saved (true) or removed (false). */
  onChanged: (hasKey: boolean) => void;
  onClose: () => void;
}

/** ipcRenderer wraps thrown errors in "Error invoking remote method …"; keep the reason. */
function reason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export default function KeySetup({ hasKey, onChanged, onClose }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const bridge = window.op1Native;
    if (!bridge || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.setKey(value.trim());
      setValue("");
      onChanged(true);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const bridge = window.op1Native;
    if (!bridge) return;
    await bridge.clearKey();
    onChanged(false);
  }

  return (
    <div className="km-backdrop">
      <div className="op-panel km-panel" role="dialog" aria-modal="true" aria-labelledby="km-title">
        <h2 id="km-title" className="km-title">
          Connect to Claude
        </h2>
        <p className="km-text">
          OP-1 Jam asks Claude for each loop through the Vercel AI Gateway. Paste a gateway key
          once; it’s kept with your Mac’s Keychain.
        </p>
        <p className="km-text">
          <a
            className="op-link"
            href="https://vercel.com/docs/ai-gateway"
            target="_blank"
            rel="noreferrer"
          >
            Where to get a key
          </a>
        </p>
        <form onSubmit={save}>
          <label className="op-field-block">
            <span className="op-label">AI Gateway key</span>
            <input
              className="km-input"
              type="password"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={value}
              placeholder={hasKey ? "A key is saved. Paste a new one to replace it." : ""}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {error ? <p className="op-warn km-error">{error}</p> : null}
          <div className="km-actions">
            <button
              type="submit"
              className="op-key op-key-orange"
              disabled={busy || !value.trim()}
            >
              Save key
            </button>
            <button type="button" className="op-seg" onClick={onClose}>
              {hasKey ? "Cancel" : "Not now"}
            </button>
            {hasKey ? (
              <button type="button" className="op-link km-remove" onClick={remove}>
                Remove the saved key
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
