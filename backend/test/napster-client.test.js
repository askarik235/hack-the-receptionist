import { test } from "node:test";
import assert from "node:assert/strict";
import { createNapsterClient, NapsterError } from "../src/napster/client.js";

// Fake fetch that records calls and replies from a queue of responses.
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, at: Date.now() });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers ?? {},
    });
  };
  return { impl, calls };
}

test("sends the API key and JSON body, returns parsed JSON", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { token: "tok", connection: { id: "sess_1" } } }]);
  const client = createNapsterClient({ apiKey: "secret-key", fetchImpl: impl, connectionGapMs: 0 });
  const out = await client.createConnection("agent_1", { channelType: "webrtc" });
  assert.deepEqual(out, { token: "tok", connection: { id: "sess_1" } });
  assert.equal(calls[0].url, "https://companion-api.napster.com/public/agents/agent_1/connections");
  assert.equal(calls[0].init.headers["X-Api-Key"], "secret-key");
  assert.equal(calls[0].init.body, JSON.stringify({ channelType: "webrtc" }));
});

test("connection calls are spaced out, even when started together", async () => {
  const { impl, calls } = fakeFetch([]);
  const client = createNapsterClient({ apiKey: "k", fetchImpl: impl, connectionGapMs: 120 });
  await Promise.all([
    client.createConnection("a", {}),
    client.closeConnection("s1"),
    client.createConnection("b", {}),
  ]);
  assert.equal(calls.length, 3);
  for (let i = 1; i < calls.length; i++) {
    assert.ok(calls[i].at - calls[i - 1].at >= 110, `gap ${i} was ${calls[i].at - calls[i - 1].at} ms`);
  }
  assert.match(calls[1].url, /\/public\/connections\/s1$/);
  assert.equal(calls[1].init.method, "DELETE");
});

test("a 429 waits for Retry-After and retries", async () => {
  const slept = [];
  const { impl, calls } = fakeFetch([
    { status: 429, headers: { "retry-after": "2" }, body: { code: "RequestRateLimitExceeded" } },
    { status: 200, body: { ok: true } },
  ]);
  const client = createNapsterClient({
    apiKey: "k",
    fetchImpl: impl,
    connectionGapMs: 0,
    sleep: async (ms) => slept.push(ms),
  });
  assert.deepEqual(await client.createConnection("a", {}), { ok: true });
  assert.equal(calls.length, 2);
  assert.ok(slept.includes(2000));
});

test("errors carry status and Napster's error code; the queue keeps working after", async () => {
  const { impl } = fakeFetch([
    { status: 409, body: { code: "ConcurrentSessionLimitReached", description: "max 5" } },
    { status: 200, body: { second: true } },
  ]);
  const client = createNapsterClient({ apiKey: "k", fetchImpl: impl, connectionGapMs: 0 });
  await assert.rejects(client.createConnection("a", {}), (err) => {
    assert.ok(err instanceof NapsterError);
    assert.equal(err.status, 409);
    assert.equal(err.code, "ConcurrentSessionLimitReached");
    return true;
  });
  assert.deepEqual(await client.createConnection("a", {}), { second: true });
});

test("array-shaped error bodies are understood", async () => {
  const { impl } = fakeFetch([{ status: 400, body: [{ code: "ConnectionNotFound" }] }]);
  const client = createNapsterClient({ apiKey: "k", fetchImpl: impl, connectionGapMs: 0 });
  await assert.rejects(client.closeConnection("gone"), { code: "ConnectionNotFound", status: 400 });
});

test("network failures become a NapsterError with status 0", async () => {
  const client = createNapsterClient({
    apiKey: "k",
    fetchImpl: async () => { throw new Error("ECONNRESET"); },
  });
  await assert.rejects(client.getSession("s"), { name: "NapsterError", status: 0, code: "NetworkError" });
});
