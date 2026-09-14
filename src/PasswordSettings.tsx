import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { MIN_PASSWORD_LENGTH } from "@convex-dev/auth/providers/password/validation";
import { api } from "../convex/_generated/api";
import { authError } from "./AuthForm";
import Modal from "./Modal";
export default function PasswordSettings({ onClose, username }: { onClose: () => void; username: string }) {
  const change = useMutation(api.auth.changePassword);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setPending(true); setStatus("");
    try {
      const result = await change({ currentPassword: String(data.get("currentPassword")), newPassword: String(data.get("newPassword")) });
      setStatus(result.success ? "Your password has been changed." : authError(result.userError));
      if (result.success) form.reset();
    } catch { setStatus("Unable to change your password. Please try again."); }
    finally { setPending(false); }
  }
  return <Modal title="Change password" onClose={onClose}><form onSubmit={submit}>
    <input name="username" autoComplete="username" value={username} readOnly hidden />
    <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required disabled={pending} /></label>
    <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required disabled={pending} /></label>
    {status && <p role="status">{status}</p>}<button disabled={pending}>{pending ? "Saving…" : "Change password"}</button>
  </form></Modal>;
}
