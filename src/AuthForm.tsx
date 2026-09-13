import { useState, type FormEvent } from "react";
import { useSignInWithPassword, useSignUpWithPassword } from "@convex-dev/auth/providers/password/react";
import { MIN_PASSWORD_LENGTH } from "@convex-dev/auth/providers/password/validation";
import { api } from "../convex/_generated/api";

export function authError(e: { error: string; minimumLength?: number; maximumLength?: number; retryAfterMs?: number }) {
  switch (e.error) {
    case "USERNAME_TAKEN": return "That username is already taken.";
    case "USER_NOT_FOUND": case "INVALID_CREDENTIALS": return "Check your username and password.";
    case "USERNAME_TOO_SHORT": return `Use at least ${e.minimumLength} characters for your username.`;
    case "USERNAME_HAS_INVALID_CHARACTERS": return "Use letters, numbers, underscores, or hyphens in your username.";
    case "PASSWORD_TOO_SHORT": return `Use a password with at least ${e.minimumLength} characters.`;
    case "PASSWORD_TOO_LONG": return `Use no more than ${e.maximumLength} characters for your password.`;
    case "PASSWORD_TOO_COMMON": return "Choose a less common password.";
    case "USERNAME_HAS_SURROUNDING_WHITESPACE": case "PASSWORD_HAS_SURROUNDING_WHITESPACE": return "Remove spaces from the start and end of your credentials.";
    case "RATE_LIMITED": return `Too many attempts. Try again in ${Math.ceil((e.retryAfterMs ?? 60000) / 1000)} seconds.`;
    default: return "We couldn't complete that request. Please try again.";
  }
}

export default function AuthForm() {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const login = useSignInWithPassword(api.auth.signInWithPassword);
  const signup = useSignUpWithPassword(api.auth.signUpWithPassword);
  const pending = login.pending || signup.pending;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const credentials = { username: String(data.get("username")), password: String(data.get("password")) };
      const result = creating ? await signup.signUp(credentials) : await login.signIn(credentials);
      if (result.status !== "complete") setError(authError(result.userError));
    } catch { setError("Unable to connect. Please try again."); }
  }
  return <section className="auth-card"><p className="eyebrow">Your search, saved</p>
    <h2>{creating ? "Make yourself at home." : "Welcome back."}</h2>
    <p>Save your preferences, find apartments, and keep your conversations in one place.</p>
    <form onSubmit={submit}>
      <label>Username<input name="username" autoComplete="username" required disabled={pending} /></label>
      <label>Password<input name="password" type="password" autoComplete={creating ? "new-password" : "current-password"} minLength={MIN_PASSWORD_LENGTH} required disabled={pending} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={pending}>{pending ? "One moment…" : creating ? "Create account" : "Sign in"}</button>
    </form>
    <button className="text-button" disabled={pending} onClick={() => { setCreating(!creating); setError(""); }}>{creating ? "Already have an account? Sign in" : "New here? Create an account"}</button>
  </section>;
}
