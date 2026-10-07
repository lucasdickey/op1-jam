import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Op1 from "./jam/page";
import KeySetup from "./key-setup";
import "./base.css";
import "./jam/op1.css";
import "./app.css";

// The app's window: the jam itself, plus the key dialog. The page reaches
// the app through window.op1Native, which the preload script provides.

type KeyState = "checking" | "missing" | "saved";

function App() {
  const [key, setKey] = useState<KeyState>("checking");
  const [editing, setEditing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const bridge = window.op1Native;
    if (!bridge) return;
    let live = true;
    void bridge.hasKey().then((has) => {
      if (live) setKey(has ? "saved" : "missing");
    });
    const off = bridge.onShowKeySetup(() => setEditing(true));
    return () => {
      live = false;
      off();
    };
  }, []);

  const close = useCallback(() => {
    setEditing(false);
    setDismissed(true);
  }, []);

  const changed = useCallback((has: boolean) => {
    setKey(has ? "saved" : "missing");
    setEditing(false);
    setDismissed(has);
  }, []);

  const showSetup = editing || (key === "missing" && !dismissed);

  return (
    <>
      <Op1 />
      {showSetup ? (
        <KeySetup hasKey={key === "saved"} onChanged={changed} onClose={close} />
      ) : null}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
