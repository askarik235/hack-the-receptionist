// Throwaway spike server. Run: node spike/server.mjs  ->  http://localhost:5177
// Local only. The API key stays here; the browser only gets short-lived session tokens.
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { napster, readIds, env, here } from "./lib.mjs";

const PORT = 5177;
const webhookLog = [];

const send = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj, null, 2));
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function verifySignature(raw, header) {
  if (!env.NAPSTER_WEBHOOK_SECRET) return "no secret set";
  const expected = createHmac("sha256", env.NAPSTER_WEBHOOK_SECRET).update(raw).digest("hex");
  const got = header ?? "";
  const ok = got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  return ok ? "valid" : "INVALID";
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const { agentId } = readIds();

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(readFileSync(join(here, "index.html")));
    }

    if (req.method === "POST" && url.pathname === "/api/call") {
      if (!agentId) return send(res, 500, { error: "Run node spike/setup.mjs first" });
      const r = await napster("POST", `/public/agents/${agentId}/connections`, {
        channelType: "webrtc",
        externalClientId: "spike_tester",
        tags: { purpose: "spike", callId: `c${Date.now()}` },
      });
      if (r.status !== 200) return send(res, r.status, { error: r.data, retryAfter: r.retryAfter });
      return send(res, 200, { token: r.data.token, sessionId: r.data.connection?.id });
    }

    if (req.method === "POST" && url.pathname === "/api/hangup") {
      const { sessionId } = JSON.parse((await readBody(req)).toString() || "{}");
      const r = await napster("DELETE", `/public/connections/${sessionId}`);
      return send(res, 200, { status: r.status, data: r.data });
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      const r = await napster("GET", `/public/sessions/${url.searchParams.get("id")}`);
      return send(res, r.status, r.data);
    }

    // Question (d): what does modality "audio" do on a webrtc connection?
    // Creates the connection, reports the response WITHOUT the token, then closes it.
    if (req.method === "POST" && url.pathname === "/api/probe-modality") {
      if (!agentId) return send(res, 500, { error: "Run node spike/setup.mjs first" });
      const r = await napster("POST", `/public/agents/${agentId}/connections`, {
        channelType: "webrtc",
        modality: "audio",
        tags: { purpose: "spike-probe" },
      });
      const out = { createStatus: r.status };
      if (r.status === 200) {
        out.connection = r.data.connection;
        await sleep(1200); // connection endpoints: 1 req/s per key
        out.closeStatus = (await napster("DELETE", `/public/connections/${r.data.connection.id}`)).status;
      } else {
        out.error = r.data;
      }
      return send(res, 200, out);
    }

    // Question (e): webhook delivery. Expose with ngrok and register in the dashboard.
    if (req.method === "POST" && url.pathname === "/webhooks/napster") {
      const raw = await readBody(req);
      const signature = verifySignature(raw, req.headers["x-webhook-signature"]);
      res.writeHead(200).end();
      let event;
      try { event = JSON.parse(raw.toString("utf8")); } catch { event = raw.toString("utf8"); }
      webhookLog.unshift({ at: new Date().toISOString(), signature, event });
      webhookLog.length = Math.min(webhookLog.length, 20);
      console.log(`[webhook] ${event?.eventType} signature=${signature}`);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/webhooks") return send(res, 200, webhookLog);

    // Page posts its results after hang-up; saved for reading later.
    if (req.method === "POST" && url.pathname === "/api/report") {
      const raw = (await readBody(req)).toString("utf8").slice(0, 200_000);
      writeFileSync(join(here, "last-report.json"), raw);
      console.log("[report] saved spike/last-report.json");
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: "not found" });
  })
  .listen(PORT, () => console.log(`Spike running at http://localhost:${PORT}`));
