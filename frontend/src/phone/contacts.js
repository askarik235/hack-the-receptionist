// The phone's contacts and recent calls, saved in this browser only.
// Contacts fill in as the player finds numbers during recon (e.g. the company's contact page).
import { useSyncExternalStore } from "react";

const KEY = { contacts: "midas.contacts", recents: "midas.recents" };
const MAX_RECENTS = 12;
const listeners = new Set();
const cache = {};

function read(key) {
  if (!(key in cache)) {
    try {
      const value = JSON.parse(localStorage.getItem(KEY[key]) ?? "[]");
      cache[key] = Array.isArray(value) ? value : [];
    } catch {
      cache[key] = [];
    }
  }
  return cache[key];
}

function write(key, value) {
  cache[key] = value;
  try {
    localStorage.setItem(KEY[key], JSON.stringify(value));
  } catch {
    /* private window: keep it for this visit only */
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export const digitsOf = (number) => String(number).replace(/\D/g, "");

export function discoverContacts(entries) {
  const known = read("contacts");
  const fresh = entries.filter((e) => !known.some((k) => digitsOf(k.number) === digitsOf(e.number)));
  if (fresh.length) write("contacts", [...known, ...fresh.map(({ name, number }) => ({ name, number }))]);
}

export function addRecent(entry) {
  write("recents", [{ ...entry, at: Date.now() }, ...read("recents")].slice(0, MAX_RECENTS));
}

export const useContacts = () => useSyncExternalStore(subscribe, () => read("contacts"));
export const useRecents = () => useSyncExternalStore(subscribe, () => read("recents"));

export function nameFor(contacts, number) {
  return contacts.find((c) => digitsOf(c.number) === digitsOf(number))?.name ?? null;
}
