import type { Request, Response } from 'express';
import { internalHeaders } from '@credisync/middleware';

export interface ForwardOptions {
  method?: string;
  body?: unknown;
  /** Defaults to the authenticated user, if any. */
  actingUser?: { id: string; role: string } | null;
  timeoutMs?: number;
}

export interface Forwarded {
  status: number;
  data: unknown;
  headers: Headers;
}

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/**
 * Calls an internal service with the service token, the acting user and the
 * trace id. Network failures become 502, timeouts 504; upstream status codes
 * pass through unchanged.
 */
export async function callService(baseUrl: string, path: string, req: Request, opts: ForwardOptions = {}): Promise<Forwarded> {
  const actingUser = opts.actingUser === undefined ? (req.user ? { id: req.user.id, role: req.user.role } : undefined) : opts.actingUser ?? undefined;
  const headers: Record<string, string> = {
    ...internalHeaders(actingUser, req.traceId),
    'x-client-ip': req.ip ?? '',
    'x-client-user-agent': String(req.headers['user-agent'] ?? '').slice(0, 256),
  };
  const method = opts.method ?? req.method;
  const hasBody = opts.body !== undefined || (method !== 'GET' && method !== 'DELETE' && req.body && Object.keys(req.body).length > 0);
  if (hasBody) headers['content-type'] = 'application/json';

  let response: globalThis.Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(opts.body ?? req.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new UpstreamError(timedOut ? 504 : 502, timedOut ? 'upstream_timeout' : 'upstream_unavailable');
  }

  const text = response.status === 204 ? '' : await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'invalid_upstream_response' };
    }
  }
  return { status: response.status, data, headers: response.headers };
}

const PASSTHROUGH_HEADERS = ['retry-after', 'content-disposition'];

/** Forwards and writes the upstream response to the client. */
export async function forward(baseUrl: string, path: string, req: Request, res: Response, opts: ForwardOptions = {}): Promise<void> {
  const result = await callService(baseUrl, path, req, opts);
  for (const h of PASSTHROUGH_HEADERS) {
    const v = result.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (result.status === 204 || result.data === null) {
    res.status(result.status).end();
    return;
  }
  res.status(result.status).json(result.data);
}
