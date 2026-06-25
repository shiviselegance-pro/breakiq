import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

export function useBreakManagement(profile) {
  const [activeBreak, setActiveBreak] = useState(null);
  const [shift, setShift] = useState(null);
  const [config, setConfig] = useState({
    shiftDurationHours: 9, lockoutStartMin: 60, lockoutEndMin: 60,
    mealBreakMin: 40, shortBreakMin: 20, maxConcurrentBreaks: 2
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [windowStatus, setWindowStatus] = useState({ locked: false });
  const [now, setNow] = useState(Date.now());

  const [budget, setBudget] = useState({
    mealRemaining: 40, shortRemaining: 20, mealTotal: 40, shortTotal: 20
  });

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Sync Global Settings
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "break_settings", "config"), snap => {
      if (snap.exists()) setConfig(prev => ({ ...prev, ...snap.data() }));
    }); return () => unsub();
  }, []);

  // Sync Shift & Budget
  useEffect(() => {
    if (!profile?.activeShiftId) {
      setBudget({ mealRemaining: config.mealBreakMin, shortRemaining: config.shortBreakMin, mealTotal: config.mealBreakMin, shortTotal: config.shortBreakMin });
      return;
    }
    const unsub = onSnapshot(doc(db, "shift_sessions", profile.activeShiftId), (snap) => {
      if (snap.exists()) {
        const d = snap.data(); setShift(d); const b = d.breakBudget || {};
        const mTot = b.mealTotalMin ?? config.mealBreakMin; const sTot = b.shortTotalMin ?? config.shortBreakMin;
        const mUsed = b.mealUsedMin ?? 0; const sUsed = b.shortUsedMin ?? 0;
        setBudget({
          mealRemaining: Math.max(0, mTot - mUsed), shortRemaining: Math.max(0, sTot - sUsed),
          mealTotal: mTot, shortTotal: sTot
        });
      }
    }); return () => unsub();
  }, [profile?.activeShiftId, config]);

  // Sync Active Break
  useEffect(() => {
    if (!profile?.activeBreakId) { setActiveBreak(null); return; }
    const unsub = onSnapshot(doc(db, "break_sessions", profile.activeBreakId), (snap) => {
      if (snap.exists()) setActiveBreak({ id: snap.id, ...snap.data() }); else setActiveBreak(null);
    }); return () => unsub();
  }, [profile?.activeBreakId]);

  // Sync Outages
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "break_settings", "config"), snap => {
      if (snap.exists() && snap.data()?.emergencyLockout) {
        setWindowStatus({ locked: true, reason: "EMERGENCY_LOCKOUT", message: snap.data().emergencyReason });
      } else setWindowStatus({ locked: false });
    }); return () => unsub();
  }, []);

  // ⚡ THE PRECISE SHIFT BOUNDARY & SLA CALCULATOR
  let isStartLocked = false; let startLockoutMillis = 0;
  let isEndLocked = false; let endLockoutMillis = 0;
  let isShiftSlaMet = false; let shiftElapsedMillis = 0;
  let shiftReqMillis = (config.shiftDurationHours || 9) * 3600000;

  if (shift?.shiftStart) {
    const startMs = shift.shiftStart.toMillis();
    shiftElapsedMillis = Math.max(0, now - startMs);
    if (shiftElapsedMillis >= shiftReqMillis) isShiftSlaMet = true;

    // 1. Shift Start Lockout (e.g. first 60 mins)
    const startUnlockTime = startMs + ((config.lockoutStartMin || 60) * 60000);
    if (now < startUnlockTime) { isStartLocked = true; startLockoutMillis = startUnlockTime - now; }

    // 2. Shift Sunset Lockout (e.g. last 60 mins of scheduled 9 hours)
    const scheduledSunsetMs = startMs + shiftReqMillis;
    const endFreezeStartTime = scheduledSunsetMs - ((config.lockoutEndMin || 60) * 60000);
    if (now >= endFreezeStartTime && now < scheduledSunsetMs) {
      isEndLocked = true; endLockoutMillis = scheduledSunsetMs - now;
    }
  }

  const requestBreakNow = async ({ category, minutesNow }) => {
    setBusy(true); setActionError(null);
    try {
      const res = await httpsCallable(functions, "requestBreakNow")({ category, minutesNow, targetUid: profile.uid });
      if (res.data?.status === "AWAITING_SLOT" && res.data?.suggestedTime) {
        const t = new Date(res.data.suggestedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setActionError(`Floor slots full. System autonomously queued you for FIFO departure at ~${t}`);
      }
    } catch (e) { setActionError(e.message); } finally { setBusy(false); }
  };

  const requestBreakLater = async ({ category, minutesNow, scheduledFor }) => {
    setBusy(true); setActionError(null);
    try {
      const res = await httpsCallable(functions, "requestBreakLater")({ category, minutesNow, scheduledFor });
      if (res.data?.ok === false) {
        const t = new Date(res.data.suggestedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setActionError(`🚨 WINDOW FULLY BOOKED. Optimal available slot predicted at: ${t}`);
        setBusy(false); return;
      }
      alert(`Successfully locked ${category} window!`); window.location.reload();
    } catch (e) { setActionError(e.message); setBusy(false); }
  };

  const run = (fn) => async () => { setBusy(true); setActionError(null); try { await httpsCallable(functions, fn)(); } catch(e) { setActionError(e.message); } finally { setBusy(false); } };

  return {
    activeBreak, budget, shift, windowStatus, busy, actionError, now, config,
    isStartLocked, startLockoutMillis, isEndLocked, endLockoutMillis,
    isShiftSlaMet, shiftElapsedMillis, shiftReqMillis,
    readyToGo: activeBreak?.readyToStart || false,
    requestBreakNow, requestBreakLater, goingForBreak: run("goingForBreak"), endBreak: run("endBreak"), cancelScheduledBreak: run("cancelScheduledBreak")
  };
}