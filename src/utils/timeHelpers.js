export function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}
export function addMinutesMillis(baseMillis, minutes) {
  return baseMillis + minutes * 60 * 1000;
}
export function formatClock(millis) {
  if (millis == null) return "--:--";
  return new Date(millis).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
export function formatCountdown(ms) {
  const abs = Math.max(0, Math.abs(ms));
  const mm = String(Math.floor(abs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((abs % 60000) / 1000)).padStart(2, "0");
  return `${mm}:${ss}`;
}
export function getBreakWindowStatus({ shiftStartMillis, shiftEndMillis, lockoutStartMin, lockoutEndMin, nowMillis }) {
  if (!shiftStartMillis || !shiftEndMillis) {
    return { locked: true, reason: "NO_SHIFT", unlocksAtMillis: null, closesAtMillis: null };
  }
  const opensAt = addMinutesMillis(shiftStartMillis, lockoutStartMin);
  const closesAt = shiftEndMillis - lockoutEndMin * 60 * 1000;
  if (nowMillis < opensAt) return { locked: true, reason: "TOO_EARLY", unlocksAtMillis: opensAt, closesAtMillis: closesAt };
  if (nowMillis > closesAt) return { locked: true, reason: "TOO_LATE", unlocksAtMillis: null, closesAtMillis: closesAt };
  return { locked: false, reason: null, unlocksAtMillis: opensAt, closesAtMillis: closesAt };
}
