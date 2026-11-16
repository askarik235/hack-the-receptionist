// Thin wrapper around the Napster REST API (https://companion-api.napster.com).
// The API key stays on the server; callers only ever see tokens and IDs.

const NAPSTER_BASE_URL = "https://companion-api.napster.com";

export class NapsterError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = "NapsterError";
    this.status = status;
    this.code = code; // e.g. "ConcurrentSessionLimitReached", "RequestRateLimitExceeded"
    this.body = body;
  }
}

// Napster error bodies come in a few shapes: {code}, [{code}], or problem+json {title}.
function errorCode(body) {
  if (Array.isArray(body)) return body[0]?.code;
  return body?.code ?? body?.title;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createNapsterClient({
  apiKey,
  baseUrl = NAPSTER_BASE_URL,
  fetchImpl = fetch,
  sleep = defaultSleep,
  connectionGapMs = 1100, // connection endpoints allow 1 request per second per API key
  maxRetries = 3, // retries after a 429 on connection endpoints
  timeoutMs = 10_000,
} = {}) {
  if (!apiKey) throw new Error("Napster API key is required");

  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new NapsterError(`Napster ${method} ${path} failed: ${err.message}`, { status: 0, code: "NetworkError" });
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const err = new NapsterError(`Napster ${method} ${path} returned ${res.status}`, {
        status: res.status,
        code: errorCode(data),
        body: data,
      });
      err.retryAfterSeconds = Number(res.headers.get("retry-after")) || 1;
      throw err;
    }
    return data;
  }

  // Connection create/delete share one rate limit, so they run one at a time with a gap
  // between them. A 429 waits for Retry-After and tries again while holding the queue,
  // which keeps later calls in order.
  let queue = Promise.resolve();
  let lastFinishedAt = 0;

  function connectionRequest(method, path, body) {
    const run = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = lastFinishedAt + connectionGapMs - Date.now();
        if (wait > 0) await sleep(wait);
        try {
          return await request(method, path, body);
        } catch (err) {
          if (err.status !== 429 || attempt >= maxRetries) throw err;
          await sleep(err.retryAfterSeconds * 1000);
        } finally {
          lastFinishedAt = Date.now();
        }
      }
    });
    queue = run.catch(() => {}); // a failed call must not block the ones behind it
    return run;
  }

  return {
    request,
    // Starts a session for an agent. Returns { token, connection: { id } }.
    createConnection: (agentId, body) =>
      connectionRequest("POST", `/public/agents/${encodeURIComponent(agentId)}/connections`, body),
    // Ends a live session from the backend (e.g. the player abandoned the call).
    closeConnection: (connectionId) =>
      connectionRequest("DELETE", `/public/connections/${encodeURIComponent(connectionId)}`),
    // Full session record, including transcript and cost once closed.
    getSession: (sessionId) => request("GET", `/public/sessions/${encodeURIComponent(sessionId)}`),
  };
}
