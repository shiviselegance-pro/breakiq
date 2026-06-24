import { useState, useEffect, useMemo, useCallback } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { getBreakWindowStatus, toMillis } from "../utils/timeHelpers";
import { DEFAULT_SETTINGS } from "../utils/constants";

export function useBreakManagement(profile) {
  const activeShiftId = profile?.activeShiftId;
  const activeBreakId = profile?.activeBreakId;

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [shift, setShift] = useState(null);
  const [activeBreak, setActiveBreak] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "break_settings", "config"), (snap) =>
      setSettings(snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.data() } : DEFAULT_SETTINGS)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!activeShiftId) { setShift(null); return; }
    const unsub = onSnapshot(doc(db, "shift_sessions", activeShiftId), (snap) =>
      setShift(snap.exists() ? { id: snap.id, ...snap.data() } : null)
    );
    return () => unsub();
  }, [activeShiftId]);

  useEffect(() => {
    if (!activeBreakId) { setActiveBreak(null); return; }
    const unsub = onSnapshot(doc(db, "break_sessions", activeBreakId), (snap) =>
      setActiveBreak(snap.exists() ? { id: snap.id, ...snap.data() } : null)
    );
    return () => unsub();
  }, [activeBreakId]);

  // 🚨 OUTAGE SIREN OVERRIDE (Highest Priority Invariant)
  const windowStatus = useMemo(() => {
    if (settings.emergencyLockout) {
      return { 
        locked: true, reason: "EMERGENCY_LOCKOUT", 
        message: settings.emergencyReason || "Floor frozen due to active P1 outage." 
      };
    }
    if (!shift) return { locked: true, reason: "NO_SHIFT" };
    return getBreakWindowStatus({
      shiftStartMillis: toMillis(shift.shiftStart), shiftEndMillis: toMillis(shift.shiftEnd),
      lockoutStartMin: settings.lockoutStartMin, lockoutEndMin: settings.lockoutEndMin, nowMillis: now,
    });
  }, [shift, settings, now]);

  const budget = useMemo(() => {
    const b = shift?.breakBudget || { mealUsedMin: 0, shortUsedMin: 0, mealTotalMin: settings.mealBreakMin, shortTotalMin: settings.shortBreakMin };
    return {
      mealRemaining: Math.max(0, b.mealTotalMin - b.mealUsedMin),
      shortRemaining: Math.max(0, b.shortTotalMin - b.shortUsedMin),
      mealTotal: b.mealTotalMin, shortTotal: b.shortTotalMin,
    };
  }, [shift, settings]);

  const countdown = useMemo(() => {
    if (!activeBreak || activeBreak.status !== "ON_BREAK") return null;
    const startMs = toMillis(activeBreak.breakStartedAt);
    const endMs = toMillis(activeBreak.expectedEndAt);
    if (!startMs || !endMs) return null;
    const remaining = endMs - now;
    return { remainingMs: remaining, overrun: remaining < 0, elapsedMs: now - startMs };
  }, [activeBreak, now]);

  const readyToGo = useMemo(() => {
    if (!activeBreak || activeBreak.status !== "APPROVED_SCHEDULED") return false;
    const schedMs = toMillis(activeBreak.scheduledFor);
    return schedMs != null && now >= schedMs;
  }, [activeBreak, now]);

  const callable = useCallback((name) => async (payload) => {
    setBusy(true); setActionError(null);
    try {
      const res = await httpsCallable(functions, name)(payload);
      return res.data;
    } catch (e) {
      setActionError(e.message || String(e));
      throw e;
    } finally { setBusy(false); }
  }, []);

  return {
    settings, shift, activeBreak, windowStatus, budget, countdown, readyToGo, busy, actionError, now,
    requestBreakNow: callable("requestBreakNow"),
    requestBreakLater: callable("requestBreakLater"),
    goingForBreak: callable("goingForBreak"),
    endBreak: callable("endBreak"),
    cancelScheduledBreak: callable("cancelScheduledBreak"),
  };}