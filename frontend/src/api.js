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
export const getTraining = () => request("GET", "/api/training");
export const submitHack = (code) => request("POST", "/api/hack", { code });
export const mailLogin = (username, password) => request("POST", "/api/mail/login", { username, password });
export const lookupNumber = (number) => request("POST", "/api/calls/lookup", { number });
// callerId: the number the caller ID kit shows (Level 4 on); empty = no caller ID.
export const dialCall = (number, callerId) => request("POST", "/api/calls", callerId ? { number, callerId } : { number });
export const getCallStatus = (callId) => request("GET", `/api/calls/${encodeURIComponent(callId)}`);
export const reportSilence = (callId, stage) => request("POST", `/api/calls/${encodeURIComponent(callId)}/silence`, { stage });
export const hangUpCall = (callId) => request("DELETE", `/api/calls/${encodeURIComponent(callId)}`, undefined, { keepalive: true });
