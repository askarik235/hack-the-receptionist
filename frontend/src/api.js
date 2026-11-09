// Talks to our backend only. The player is identified by an HttpOnly cookie the server sets.
async function request(method, path, body, { keepalive = false } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    keepalive, // lets a hang-up finish even while the page is closing
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status, code: data.error });
  return data;
}

export const getContent = () => request("GET", "/api/content");
export const lookupNumber = (number) => request("POST", "/api/calls/lookup", { number });
export const dialCall = (number) => request("POST", "/api/calls", { number });
export const getCallStatus = (callId) => request("GET", `/api/calls/${encodeURIComponent(callId)}`);
export const reportSilence = (callId, stage) => request("POST", `/api/calls/${encodeURIComponent(callId)}/silence`, { stage });
export const hangUpCall = (callId) => request("DELETE", `/api/calls/${encodeURIComponent(callId)}`, undefined, { keepalive: true });
