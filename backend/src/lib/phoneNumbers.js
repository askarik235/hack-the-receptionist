// "04 555 0142", "+971 4 555 0142", "045550142" -> "045550142"
export function normalizeNumber(input) {
  if (typeof input !== "string" || input.length > 25) return null;
  let digits = input.replace(/[\s().+-]/g, "");
  if (!/^\d{6,15}$/.test(digits)) return null;
  if (digits.startsWith("00971")) digits = "0" + digits.slice(5);
  else if (digits.startsWith("971")) digits = "0" + digits.slice(3);
  return digits;
}

// "045550142" -> "04 555 0142", "0505550177" -> "050 555 0177"
export function formatNumber(digits) {
  if (/^0\d{8}$/.test(digits)) return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  if (/^0\d{9}$/.test(digits)) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return digits;
}
