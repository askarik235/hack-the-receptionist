// A sign-in style form on the fake sites (VitalNet Mail, VitalNet Files): runs `action` once at a
// time, hands its result to `onDone`, and turns a server error code into a message from `errors`.
import { useState } from "react";

export function useFormSubmit({ action, onDone, errors, fallback }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onDone(await action());
    } catch (err) {
      setError(errors[err.code] ?? fallback);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, submit };
}
