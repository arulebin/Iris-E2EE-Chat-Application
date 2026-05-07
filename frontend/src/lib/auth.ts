export function getUsername(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub as string;
  } catch {
    return null;
  }
}

export function getTokenExpiryMs(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string | null): boolean {
  const expiryMs = getTokenExpiryMs(token);
  return expiryMs === null || expiryMs <= Date.now();
}
