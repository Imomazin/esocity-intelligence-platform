import { NextRequest } from "next/server";

type Handler<P> = (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>;

let clientCounter = 0;

/** Invoke a Route Handler in-process with a fresh client address (independent rate limits). */
export async function call<P extends Record<string, string> = Record<string, never>>(
  handler: Handler<P>,
  options: {
    url?: string;
    method?: string;
    body?: unknown;
    params?: P;
    headers?: Record<string, string>;
    cookie?: string;
  } = {},
): Promise<{ status: number; body: Record<string, any>; headers: Headers }> {
  clientCounter += 1;
  const headers: Record<string, string> = {
    host: "localhost:3000",
    "x-forwarded-for": `203.0.113.${clientCounter % 250}`,
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...options.headers,
  };
  const request = new NextRequest(new URL(options.url ?? "/", "http://localhost:3000"), {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = await handler(request, { params: Promise.resolve((options.params ?? {}) as P) });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, any>,
    headers: response.headers,
  };
}

export function sessionCookieFrom(headers: Headers): string | undefined {
  const raw = headers.get("set-cookie");
  return raw?.split(";")[0];
}
