import { useState, useEffect } from "react";
import { doc, onSnapshot, collection, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

export function useBreakManagement(profile) {
  const [activeBreak, setActiveBreak] = useState(null);
  const [budget, setBudget] = useState(null);
  const [shift, setShift] = useState(null);
  const [windowStatus, setWindowStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // 1. Live Shift & Budget Sync
  useEffect(() => {
    if (!profile?.activeShiftId) return;
    const unsub = onSnapshot(doc(db, "shift_sessions", profile.activeShiftId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setShift(data);
        const b = data.breakBudget || {};
        setBudget({
          mealRemaining: Math.max(0, (b.mealTotalMin || 40) - (b.mealUsedMin || 0)),
          shortRemaining: Math.max(0, (b.shortTotalMin || 20) - (b.shortUsedMin || 0)),
          mealTotal: b.mealTotalMin || 40, shortTotal: b.shortTotalMin || 20
        });
      }
    });
    return () => unsub();
  }, [profile?.activeShiftId]);

  // 2. Live Active Break Sync
  useEffect(() => {
    if (!profile?.activeBreakId) { setActiveBreak(null); return; }
    const unsub = onSnapshot(doc(db, "break_sessions", profile.activeBreakId), (snap) => {
      if (snap.exists()) setActiveBreak({ id: snap.id, ...snap.data() });
      else setActiveBreak(null);
    });
    return () => unsub();
  }, [profile?.activeBreakId]);

  const requestBreakNow = async ({ category, minutesNow }) => {
    setBusy(true); setActionError(null);
    try {
      await httpsCallable(functions, "requestBreakNow")({ category, minutesNow, targetUid: profile.uid });
    } catch (err) { setActionError(err.message); } finally { setBusy(false); }
  };

  // ⚡ THE CRITICAL FIX: PREDICTION INTERCEPTOR
  const requestBreakLater = async ({ category, minutesNow, scheduledFor }) => {
    setBusy(true); setActionError(null);
    try {
      const res = await httpsCallable(functions, "requestBreakLater")({ category, minutesNow, scheduledFor });
      
      // 🚨 INTERCEPTION: If backend bounced due to concurrency limit
      if (res.data?.ok === false) {
        const nextMs = res.data.suggestedTime;
        const formattedTime = new Date(nextMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setActionError(`🚨 SELECTED SLOT IS FULLY BOOKED. System predicts next optimal window at: ${formattedTime}`);
        setBusy(false);
        return; // strictly stops the window refresh!
      }

      alert(`Successfully locked ${category} break for scheduled time!`);
      window.location.reload();
    } catch (err) {
      setActionError(err.message || "Failed to schedule break.");
      setBusy(false);
    }
  };

  const goingForBreak = async () => {
    setBusy(true); setActionError(null);
    try { await httpsCallable(functions, "goingForBreak")(); } 
    catch (err) { setActionError(err.message); } finally { setBusy(false); }
  };

  const endBreak = async () => {
    setBusy(true); setActionError(null);
    try { await httpsCallable(functions, "endBreak")(); } 
    catch (err) { setActionError(err.message); } finally { setBusy(false); }
  };

  const cancelScheduledBreak = async () => {
    setBusy(true); setActionError(null);
    try { await httpsCallable(functions, "cancelScheduledBreak")(); } 
    catch (err) { setActionError(err.message); } finally { setBusy(false); }
  };

  return {
    activeBreak, budget, shift, windowStatus, busy, actionError, now,
    readyToGo: activeBreak?.readyToStart || false,
    requestBreakNow, requestBreakLater, goingForBreak, endBreak, cancelScheduledBreak
  };
}