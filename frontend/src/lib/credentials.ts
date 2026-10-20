import { apiBase } from "./config";
import {
  deriveCredentials,
  fetchAuthSalt,
  markUpgraded,
  newSalt,
  upgradeLegacyAccount,
} from "../crypto";

// A logged-in session. `master` is the in-memory secret that unlocks the private
// key backup; null when it couldn't be derived (e.g. a legacy upgrade that failed —
// the key is then served from IndexedDB, or the user is asked to unlock).
export type Session = { token: string; master: CryptoKey | null };

async function postLogin(body: { username: string; authKey?: string; password?: string }): Promise<string> {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || "login failed");
  return (await res.json()).token;
}

export async function signUp(username: string, password: string): Promise<Session> {
  const authSalt = newSalt();
  const { authKey, master } = await deriveCredentials(password, authSalt);
  const res = await fetch(`${apiBase}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, authKey, authSalt }),
  });
  if (!res.ok) throw new Error((await res.text()) || "signup failed");
  const token = await postLogin({ username, authKey });
  markUpgraded(username);
  return { token, master };
}

export async function logIn(username: string, password: string): Promise<Session> {
  const { version, authSalt } = await fetchAuthSalt(username);
  if (version >= 2) {
    const { authKey, master } = await deriveCredentials(password, authSalt!);
    const token = await postLogin({ username, authKey });
    markUpgraded(username);
    return { token, master };
  }

  // Legacy account: the raw password goes to the server this one last time, then
  // the account is upgraded so it never has to again.
  const token = await postLogin({ username, password });
  try {
    return { token, master: await upgradeLegacyAccount(username, password, token) };
  } catch (err) {
    // Still logged in; the upgrade is retried on the next login or unlock.
    console.warn("Account upgrade failed:", err);
    return { token, master: null };
  }
}

/** Re-derive the key-unlock secret for a session whose IndexedDB key was lost. */
export async function unlockKeyMaterial(username: string, password: string, token: string): Promise<CryptoKey> {
  const { version, authSalt } = await fetchAuthSalt(username);
  if (version >= 2) return (await deriveCredentials(password, authSalt!)).master;
  return upgradeLegacyAccount(username, password, token);
}
