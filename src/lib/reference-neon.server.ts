const GATEWAY_URL = 'https://connector-gateway.lovable.dev/neon';

// Env is read per request inside the server boundary: module-scope reads are
// undefined on Cloudflare Workers and can leak into the client bundle.
function gatewayHeaders(): Record<string, string> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const NEON_API_KEY = process.env.NEON_API_KEY;  // connection key (lovc_…), not a Neon key
  if (!LOVABLE_API_KEY || !NEON_API_KEY) {
    throw new Error('Missing LOVABLE_API_KEY or NEON_API_KEY');
  }
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    'X-Connection-Api-Key': NEON_API_KEY,
    'Content-Type': 'application/json',
  };
}

type Statement = { query: string; params?: unknown[] };
type NeonResult = {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID: number }[];
  rowCount: number | null;
  command: string;
};
type NeonBatchResult = { results: NeonResult[] };
type NeonResponse = { status: number; retryAfter: string | null; text: string; json: any; elapsedMs: number };
type NeonErrorKind = 'stale_connection' | 'endpoint_blocked' | 'maybe_committed' | 'too_large' | 'rate_limited' | 'unavailable' | 'input' | 'statement' | 'rejected';
type NeonError = Error & { status: number; code?: string; body: string; kind: NeonErrorKind };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toBody = (q: string | Statement[], params: unknown[]) =>
  typeof q === 'string' ? { query: q, params } : { queries: q };

// Throws only from gatewayHeaders (missing key). Otherwise never throws: an abort, a
// network failure or a body cut after a 2xx header (the gateway's 90 s deadline) is status 0.
async function neonFetch(body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<NeonResponse> {
  const base = gatewayHeaders();
  const started = Date.now();
  try {
    const res = await fetch(`${GATEWAY_URL}/sql`, {
      method: 'POST',
      headers: { ...base, ...headers },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = {}; }
    return { status: res.status, retryAfter: res.headers.get('Retry-After'), text, json, elapsedMs: Date.now() - started };
  } catch (err: any) {
    return { status: 0, retryAfter: null, text: '', json: { message: String(err?.name ?? err) }, elapsedMs: Date.now() - started };
  }
}

// Stale connection string, at any status: a rotated password, a dropped role, or a
// deleted or mistyped endpoint. Never retried.
const isStale = (json: any) =>
  json?.code === '28P01' || json?.code === '28000' ||
  /^(password authentication failed|Control plane request failed: endpoint cannot be found)/.test(json?.message ?? '');
// Neon is not serving the endpoint: disabled (live wording first, proxy fallback
// second), or a quota or billing limit. The string is fine; never retried unchanged.
const isEndpointBlocked = (json: any) =>
  /^(The endpoint has been disabled|Control plane request failed: endpoint is)/.test(json?.message ?? '');

function neonFailure(r: NeonResponse, write: boolean): NeonError {
  const { status, json, elapsedMs } = r;
  let hint: string;
  let kind: NeonErrorKind;
  if (isStale(json)) {
    kind = 'stale_connection';
    hint = 'the stored connection string no longer works: stop retrying; only the connection\'s creator can paste a new one in Lovable connector settings';
  } else if (isEndpointBlocked(json)) {
    kind = 'endpoint_blocked';
    hint = 'Neon is not serving this endpoint (disabled, or a quota or billing limit): log Neon\'s message; never retry unchanged';
  } else if (status === 413) {
    kind = 'too_large';
    hint = 'request too large: split bulk writes into several `queries` batches; never retry unchanged';
  } else if (status === 507) {
    kind = 'too_large';
    hint = 'result too large: add LIMIT and paginate; never retry unchanged';
  } else if (status === 429) {
    kind = 'rate_limited';
    hint = 'Lovable gateway rate limit (per project), not Neon; the statement was not forwarded: batch with `queries`, cache, re-run after Retry-After';
  } else if (status === 0 || status === 502) {
    const slow = /^(TimeoutError|AbortError)/.test(json?.message ?? '') || elapsedMs >= 25_000;
    kind = write ? 'maybe_committed' : slow ? 'statement' : 'unavailable';
    hint = slow
      ? 'too slow: add an index, LIMIT, paginate, or move the work into Neon; never retry unchanged'
      : 'the gateway could not reach Neon\'s regional proxy, or the network failed: see status.neon.tech and retry later';
    if (write) hint = `the statement may have committed: check the row before re-running; ${hint}`;
  } else if (json?.code === '42P01') {
    kind = 'statement';
    hint = 'table renamed or removed: stop';
  } else if (/^2[23]/.test(json?.code ?? '')) {
    kind = 'input';
    hint = 'the values break a constraint or a type (unique, foreign key, check, cast): validate the input; never retry unchanged';
  } else if (/^Control plane request failed/.test(json?.message ?? '')) {
    kind = 'unavailable';
    hint = 'Neon control-plane outage, not the statement and not the string: see status.neon.tech and retry later (reads only)';
  } else if (status === 400) {
    kind = 'statement';
    hint = 'fix the statement; never retry unchanged';
  } else if (status >= 500) {
    kind = 'unavailable';
    hint = 'Neon error (a bare "Control plane request failed" is a Neon control-plane outage; a persistent 500 can be plan-quota exhaustion): log it';
  } else {
    kind = 'rejected';
    hint = 'gateway rejection, not retryable: the request must be exactly POST /sql on a connection linked to this project';
  }
  const code = json?.code || json?.type;  // Neon sends a SQLSTATE `code`; the gateway sends `type`
  return Object.assign(
    new Error(`Neon ${status}${code ? ` ${code}` : ''}: ${json?.message ?? r.text.slice(0, 300)} (${hint})`),
    { status, code, body: r.text, kind },
  );
}

// What the app answers with. Handlers log the full error and return this; the raw
// status is never forwarded (0 on a timeout, the gateway's 401/403 on an app credential).
function neonUserError(err: unknown): { status: number; message: string } {
  switch ((err as Partial<NeonError>)?.kind) {
    case 'stale_connection':
      return { status: 503, message: 'The database connection configured for this app no longer works. The app owner has to replace it in Lovable connector settings.' };
    case 'endpoint_blocked':
      return { status: 503, message: 'The database behind this app is not available right now. The app owner should check its endpoint and plan in Neon.' };
    case 'maybe_committed':
      return { status: 503, message: 'The change may have been saved. Refresh to check before trying again.' };
    case 'too_large':
      return { status: 413, message: 'This request or its result is too large for one call. Narrow it and try again.' };
    case 'rate_limited':
      return { status: 429, message: 'The database is busy. Try again in a moment.' };
    case 'unavailable':
      return { status: 503, message: 'The database is temporarily unavailable. Try again in a moment.' };
    case 'input':
      return { status: 400, message: 'The database rejected these values. Check the input and try again.' };
    default:
      return { status: 500, message: 'The database request could not be completed.' };
  }
}

// Reads: one 30 s budget shared by every attempt and wait; a stale string or a
// blocked endpoint throws at once, then one 429 retry and up to three attempts on 500/503.
async function neonQuery<T = NeonResult>(
  query: string | Statement[], params: unknown[] = [], headers: Record<string, string> = {},
): Promise<T> {
  const deadline = Date.now() + 30_000;
  const left = () => Math.max(0, deadline - Date.now());
  let retried429 = false;
  for (let attempt = 1; ; attempt++) {
    const r = await neonFetch(toBody(query, params), headers, AbortSignal.timeout(Math.max(1, left())));
    if (r.status >= 200 && r.status < 300) return r.json as T;
    if (isStale(r.json) || isEndpointBlocked(r.json)) throw neonFailure(r, false);
    if (r.status === 429 && !retried429) {
      retried429 = true;
      const seconds = Math.min(Math.max(Number(r.retryAfter) || 1, 1), 15);
      await sleep(Math.min(seconds * 1000, left()));
      continue;
    }
    const backoff = 500 * 2 ** (attempt - 1);
    if ((r.status === 500 || r.status === 503) && attempt < 3 && backoff < left()) {
      await sleep(backoff);
      continue;
    }
    throw neonFailure(r, false);
  }
}

// Writes: no client deadline and no automatic retry. An abort or a 502 means
// Neon most likely cancelled the statement when the stream closed, but it may
// have committed; the error says so, so the caller checks before re-running.
async function neonExecute<T = NeonResult>(
  query: string | Statement[], params: unknown[] = [], headers: Record<string, string> = {},
): Promise<T> {
  const r = await neonFetch(toBody(query, params), headers);
  if (r.status >= 200 && r.status < 300) return r.json as T;
  throw neonFailure(r, true);
}

export { neonQuery, neonExecute, neonUserError };
