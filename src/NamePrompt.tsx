import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";

export default function NamePrompt() {
  const saveName = useMutation(api.users.saveName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (!name) { setError("Please enter your name."); return; }
    setPending(true); setError("");
    try { await saveName({ name }); }
    catch (e) { setError(e instanceof ConvexError ? String(e.data) : "We couldn't save your name. Please try again."); }
    finally { setPending(false); }
  }

  return <section className="auth-card name-prompt" aria-labelledby="name-prompt-title">
    <p className="eyebrow">Make yourself at home</p>
    <h2 id="name-prompt-title">What should we call you?</h2>
    <p>We'll use your name to greet you when you sign in.</p>
    <form onSubmit={submit}>
      <label>Your name<input name="name" autoComplete="name" maxLength={100} required autoFocus disabled={pending} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={pending}>{pending ? "Saving…" : "Continue"}</button>
    </form>
  </section>;
}
