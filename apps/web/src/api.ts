const rawApiBase = import.meta.env.VITE_API_BASE ||
  (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    ? "http://localhost:4000"
    : "/api");
const normalizedApiBase = rawApiBase.replace(/\/+$/, "");
const API_BASE = normalizedApiBase.endsWith("/api") ? normalizedApiBase : `${normalizedApiBase}/api`;

type RequestOptions = {
  method?: string;
  token?: string | null;
  body?: unknown;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${API_BASE}${normalizedPath}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Request failed");
  }

  return (await response.json()) as T;
}

export { API_BASE };
