import React, { useState, useEffect } from "react";
import { doc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useBreakManagement } from "../hooks/useBreakManagement";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import { formatClock, toMillis } from "../utils/timeHelpers";
import { 
  LogOut, WifiOff, AlertTriangle, Key, Copy, Check, 
  Sparkles, X, ShieldAlert, Clock, Sunset, Shield, BellRing 
} from "lucide-react";

export default function AgentConsole() {
  const { profile } = useAuth(); 
  useHeartbeat(profile?.uid, profile?.name, profile?.role);
  
  const supervisorsOnline = useOnlineRoster("SUPERVISOR");
  const bm = useBreakManagement(profile);

  const [syncing, setSyncing] = useState(false);
  const [showPassModal, setShowPassModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const missingShift = profile?.role === "AGENT" && !profile?.activeShiftId;
  const myProject = (profile?.project || "GENERAL").trim().toUpperCase();
  const projectSupervisors = supervisorsOnline.filter(s => 
    (s.project || "GENERAL").toUpperCase() === myProject || 
    (s.project || "GENERAL").toUpperCase() === "GENERAL"
  );

  const handleSafeLogout = async () => {
    try { 
      await auth.signOut(); 
    } catch(e) {}
    window.location.replace("/");
  };

  const handleClockIn = async () => {
    setSyncing(true);
    try { 
      await httpsCallable(functions, "startShift")(); 
      window.location.reload(); 
    } catch (e) { 
      alert("Clock-in failed: " + e.message); 
      setSyncing(false); 
    }
  };

  const handleCopyId = () => {
    if (!profile?.employeeId) return; 
    navigator.clipboard.writeText(profile.employeeId);
    setCopiedId(true); 
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div className="relative min-h-screen text-slate-800 font-sans pb-24 selection:bg-indigo-500 selection:text-white">
      <div className="mesh-bg" />

      {/* ⚡ MOBILE COMPATIBLE HEADER */}
      <header className="glass-bar sticky top-0 z-30 px-4 sm:px-6 py-3.5 font-sans">
        <div className="mx-auto flex flex-wrap max-w-6xl items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white font-black text-xs shadow-md font-mono">
              IQ
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-xs font-black uppercase text-slate-900">Agent Portal</h1>
                <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 font-mono">
                  {myProject}
                </span>
                {!missingShift && <WorkModeToggle profile={profile} />}
              </div>
              <div className="flex items-center gap-1 text-[11px] sm:text-xs text-slate-500 mt-0.5">
                <span className="font-bold text-slate-700 truncate max-w-[100px] sm:max-w-none">{profile?.name}</span>
                <span>·</span>
                <span className="font-mono text-slate-600 font-bold inline-flex items-center gap-1 bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                  {profile?.employeeId}
                  <button type="button" onClick={handleCopyId} className="text-slate-400 hover:text-indigo-600 cursor-pointer">
                    {copiedId ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                  </button>
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono ml-auto sm:ml-0">
            <button type="button" onClick={() => setShowPassModal(true)} className="btn-soft flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold cursor-pointer">
              <Key size={13} className="text-indigo-600" /> <span className="hidden sm:inline">Password</span>
            </button>
            <button type="button" onClick={() => setShowLogoutModal(true)} className="btn-soft flex items-center gap-1 rounded-xl px-3 sm:px-4 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer transition-all">
              <LogOut size={13} /> Exit
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 border-b border-slate-200/80 bg-white/60 py-2.5 px-4 sm:px-6 text-xs text-slate-600 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between font-sans">
          <span className="flex items-center gap-1.5 font-medium truncate sm:overflow-visible">
            <Sparkles size={13} className="text-amber-600 shrink-0" />
            <strong>Rules:</strong> Shift is {bm.config?.shiftDurationHours || 9}h. Short break quota is {bm.config?.shortBreakMin || 20}m.
          </span>
          <span className="text-[11px] font-mono text-emerald-600 font-bold shrink-0">● Live Tracking</span>
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 mt-6 sm:mt-8 font-sans">
        {missingShift ? (
          <div className="glass max-w-md mx-auto rounded-[32px] p-8 text-center space-y-4 animate-rise font-sans">
            <div className="flex items-center justify-center gap-2 text-indigo-600 font-black text-xs uppercase tracking-wider font-mono">
              <AlertTriangle size={16} /> <span>Shift Clock Inactive</span>
            </div>
            <p className="text-xs text-slate-600 font-medium leading-relaxed">
              Welcome to {myProject}. Please clock in to begin working and unlock break limits.
            </p>
            <button type="button" onClick={handleClockIn} disabled={syncing} className="btn-glass w-full font-black uppercase tracking-wider py-4 rounded-2xl text-xs cursor-pointer shadow-md font-sans active:scale-95">
              {syncing ? "Stamping..." : "Clock In Now"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
            <div className="lg:col-span-8 space-y-6">
              <AgentLightStatusWidget activeBreak={bm.activeBreak} budget={bm.budget} now={bm.now} />
              
              {bm.windowStatus?.locked ? (
                <div className="glass rounded-[32px] border-rose-200 bg-rose-50/80 p-8 text-center space-y-3 animate-rise">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-md">
                    <ShieldAlert size={24} />
                  </div>
                  <h3 className="text-base font-black uppercase tracking-wider text-rose-900 font-mono">Breaks Paused</h3>
                  <p className="text-xs text-slate-600 max-w-md mx-auto font-medium">Supervisors have paused all floor departures:</p>
                  <div className="inline-block bg-white border border-rose-200 rounded-xl px-4 py-2 shadow-sm">
                    <p className="text-xs font-mono font-bold text-rose-700">"{bm.windowStatus?.message || "High Volume Call Hold"}"</p>
                  </div>
                </div>
              ) : bm.isStartLocked ? (
                <div className="glass rounded-[32px] border-indigo-200/80 bg-indigo-50/40 p-8 text-center space-y-3 animate-rise">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md animate-spin">
                    <Clock size={24} />
                  </div>
                  <h3 className="text-base font-black uppercase tracking-wider text-indigo-950 font-mono">Shift Just Started</h3>
                  <p className="text-xs text-slate-600 max-w-md mx-auto font-medium leading-relaxed">
                    Breaks are disabled for the first {bm.config?.lockoutStartMin || 60} minutes of your shift. Fencing unlocks in:
                  </p>
                  <div className="inline-block bg-white border border-indigo-200 rounded-2xl px-6 py-3 shadow-sm font-mono text-3xl font-black text-indigo-900 tabular-nums">
                    {String(Math.floor(bm.startLockoutMillis / 60000)).padStart(2, '0')}:{String(Math.floor((bm.startLockoutMillis % 60000) / 1000)).padStart(2, '0')}
                  </div>
                </div>
              ) : bm.isEndLocked ? (
                <div className="glass rounded-[32px] border-amber-200/80 bg-amber-50/50 p-8 text-center space-y-3 animate-rise">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md">
                    <Sunset size={24} />
                  </div>
                  <h3 className="text-base font-black uppercase tracking-wider text-amber-950 font-mono">Shift Ending Soon</h3>
                  <p className="text-xs text-slate-600 max-w-md mx-auto font-medium leading-relaxed">
                    You are in the final {bm.config?.lockoutEndMin || 60} minutes of your scheduled shift. Break requests are frozen for handover.
                  </p>
                </div>
              ) : (
                <AgentLightControlsWidget bm={bm} />
              )}

              {bm.actionError && (
                <div className="glass rounded-2xl border-rose-200 bg-rose-50/80 p-5 text-center shadow-sm">
                  <p className="text-xs font-bold text-rose-700 font-mono">{bm.actionError}</p>
                </div>
              )}
            </div>

            <div className="lg:col-span-4 space-y-6 font-sans">
              <div className="glass rounded-[28px] p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 font-mono">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Shield size={14} className="text-indigo-600" /> Supervisors
                  </span>
                  <span className="text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200 font-bold">
                    {projectSupervisors.length} Online
                  </span>
                </div>
                {projectSupervisors.length === 0 ? (
                  <div className="py-8 text-center border border-dashed border-slate-200 rounded-2xl bg-white/40 space-y-1">
                    <WifiOff size={18} className="mx-auto text-slate-400" />
                    <p className="text-xs font-bold text-slate-500">No Supervisors Duty</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {projectSupervisors.map(sup => (
                      <div key={sup.id || sup.uid} className="flex items-center justify-between bg-white/70 p-3 rounded-2xl border border-slate-200/60 transition-all hover:bg-white shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 font-bold text-indigo-600 font-mono shrink-0">
                            {sup.name?.charAt(0).toUpperCase()}
                          </div>
                          <p className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{sup.name}</p>
                        </div>
                        <span className="text-[10px] text-emerald-700 font-bold font-mono">● Duty</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {bm.shift && <ShiftLightFooter shift={bm.shift} now={bm.now} reqMs={bm.shiftReqMillis} />}
            </div>
          </div>
        )}
      </main>

      {showPassModal && <AgentChangePasswordModal onClose={() => setShowPassModal(false)} />}
      {showLogoutModal && <AgentShiftLogoutModal bm={bm} onClose={() => setShowLogoutModal(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI COMPONENT: LIVE STATUS WIDGET (WITH COUNTDOWN TIMER)
// ─────────────────────────────────────────────────────────────────────────────
function AgentLightStatusWidget({ activeBreak, budget, now }) {
  const isOnBreak = activeBreak?.status === "ON_BREAK"; 
  const isInQueue = activeBreak?.status === "AWAITING_SLOT" || activeBreak?.status === "IN_QUEUE"; 
  const isSched = activeBreak?.status === "APPROVED_SCHEDULED";
  const isPrompted = activeBreak?.status === "NOTIFIED_TO_START"; 

  const mealTotal = budget?.mealTotal ?? 40; 
  const shortTotal = budget?.shortTotal ?? 20; 
  const mealLeft = budget?.mealRemaining ?? mealTotal; 
  const shortLeft = budget?.shortRemaining ?? shortTotal;

  let elapsedStr = "00:00"; 
  let isOverrun = false;

  // ⚡ QUEUE/SCHEDULE TIMER LOGIC
  let qTargetMs = null;
  let qExpectedTimeStr = "";
  let qCountdownStr = "";

  if (isOnBreak && activeBreak?.breakStartedAt) {
    const startMs = toMillis(activeBreak.breakStartedAt) || now; 
    const diffMs = Math.max(0, now - startMs); 
    const allottedMin = activeBreak.requestedDurationMin || 20;
    if (diffMs > allottedMin * 60000) isOverrun = true;
    
    const mm = String(Math.floor(diffMs / 60000)).padStart(2, "0"); 
    const ss = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, "0"); 
    elapsedStr = `${mm}:${ss}`;
  } else if (isInQueue || isSched) {
    // ⚡ If scheduled, use scheduledFor. If queued, use suggestedTime.
    qTargetMs = isSched ? toMillis(activeBreak?.scheduledFor) : toMillis(activeBreak?.suggestedTime);
    
    if (qTargetMs) {
      qExpectedTimeStr = new Date(qTargetMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const diff = qTargetMs - now;
      if (diff > 0) {
        const m = String(Math.floor(diff / 60000)).padStart(2, "0");
        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
        qCountdownStr = `${m}:${s}`;
      } else {
        qCountdownStr = "00:00";
      }
    }
  }

  let statusBg = "bg-emerald-500"; 
  let statusText = "AVAILABLE"; 
  let cardBorder = "border-slate-200/80 bg-white/70";

  if (isOnBreak) { 
    statusBg = isOverrun ? "bg-rose-500 animate-ping" : "bg-amber-500 animate-pulse"; 
    statusText = isOverrun ? `OVER LIMIT (${activeBreak?.breakCategory})` : `ON ${activeBreak?.breakCategory} BREAK`; 
    cardBorder = isOverrun ? "border-rose-300 bg-rose-50/60" : "border-amber-200 bg-amber-50/50"; 
  }
  else if (isPrompted) {
    statusBg = "bg-fuchsia-500 animate-ping"; 
    statusText = "ACTION REQUIRED (SLA)"; 
    cardBorder = "border-fuchsia-300 bg-fuchsia-50/60";
  }
  else if (isInQueue) { 
    statusBg = "bg-indigo-500 animate-bounce"; 
    statusText = "IN QUEUE"; 
    cardBorder = "border-indigo-200 bg-indigo-50/40"; 
  }
  else if (isSched) { 
    statusBg = "bg-cyan-500"; 
    statusText = "BREAK SCHEDULED"; 
  }

  return (
    <div className={`glass rounded-[32px] p-5 sm:p-7 space-y-6 transition-all ${cardBorder}`}>
      <div className="flex items-center justify-between border-b border-slate-200/60 pb-5 font-mono">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Live Status</span>
          <div className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full shrink-0 ${statusBg}`} />
            <h2 className={`text-xs sm:text-sm font-black uppercase tracking-wider ${isOverrun ? "text-rose-700" : "text-slate-900"}`}>{statusText}</h2>
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs text-slate-400 block">Clock</span>
          <span className="text-sm sm:text-base font-black text-slate-900 tabular-nums">{formatClock(now)}</span>
        </div>
      </div>
      
      {isOnBreak && (
        <div className={`p-6 rounded-2xl border text-center transition-all shadow-sm ${isOverrun ? "bg-rose-500/15 border-rose-300" : "bg-amber-50 border-amber-200"}`}>
          <div className="flex items-center justify-center gap-1.5 text-xs font-mono uppercase tracking-widest font-bold mb-1 text-slate-600">
            <Clock size={14} className={isOverrun ? "text-rose-600 animate-spin" : "text-amber-600"} />
            <span>{isOverrun ? "Limit Exceeded!" : "Stopwatch Timer"}</span>
          </div>
          <div className={`font-mono text-4xl sm:text-5xl font-black tabular-nums tracking-tight ${isOverrun ? "text-rose-600 animate-pulse font-extrabold" : "text-amber-800"}`}>
            {elapsedStr}
          </div>
          <p className="text-[11px] text-slate-500 mt-2 font-medium">Allotted: {activeBreak.requestedDurationMin} mins</p>
        </div>
      )}

      {/* ⚡ NEW: QUEUE & SCHEDULE COUNTDOWN BOX */}
      {(isInQueue || isSched) && qTargetMs && (
        <div className={`p-6 rounded-2xl border text-center transition-all shadow-sm ${isSched ? "bg-cyan-50/50 border-cyan-200" : "bg-indigo-50/50 border-indigo-200"}`}>
          <div className="flex items-center justify-center gap-1.5 text-xs font-mono uppercase tracking-widest font-bold mb-1 text-slate-600">
            <Clock size={14} className={isSched ? "text-cyan-600" : "text-indigo-600"} />
            <span>Expected Break Time</span>
          </div>
          <div className={`font-mono text-4xl sm:text-5xl font-black tabular-nums tracking-tight ${isSched ? "text-cyan-800" : "text-indigo-800"}`}>
            {qExpectedTimeStr}
          </div>
          <div className="mt-3 flex justify-center">
            <span className={`text-[11px] font-bold font-mono px-3 py-1 rounded-full shadow-inner border ${isSched ? "bg-cyan-100 text-cyan-700 border-cyan-200" : "bg-indigo-100 text-indigo-700 border-indigo-200"}`}>
               ⏳ Starts in: {qCountdownStr === "00:00" ? "Processing slot..." : qCountdownStr}
            </span>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-3 sm:gap-4 font-sans">
        <div className="bg-white/80 border rounded-2xl p-4 space-y-2 shadow-sm">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-slate-500 font-bold font-sans">Meal</span>
            <span className="font-black text-indigo-600">{mealLeft}m Left</span>
          </div>
          <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-600 rounded-full transition-all duration-700" style={{ width: `${((mealTotal-mealLeft)/mealTotal)*100}%` }}/>
          </div>
        </div>
        
        <div className="bg-white/80 border rounded-2xl p-4 space-y-2 shadow-sm">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-slate-500 font-bold font-sans">Short</span>
            <span className={`font-black ${shortLeft <= 0 ? "text-rose-600" : "text-emerald-600"}`}>{shortLeft}m Left</span>
          </div>
          <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${shortLeft <= 0 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${((shortTotal-shortLeft)/shortTotal)*100}%` }}/>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI COMPONENT: CONTROLS & 3-MINUTE SLA ACCEPTANCE
// ─────────────────────────────────────────────────────────────────────────────
function AgentLightControlsWidget({ bm }) {
  const [cat, setCat] = useState("SHORT"); 
  const [mins, setMins] = useState(15); 
  const [mode, setMode] = useState("NOW"); 
  const [schedTime, setSchedTime] = useState("");
  const [firing, setFiring] = useState(false);

  const isLater = bm.activeBreak?.status === "APPROVED_SCHEDULED"; 
  const isNow = bm.activeBreak?.status === "AWAITING_SLOT" || bm.activeBreak?.status === "IN_QUEUE"; 
  const isOn = bm.activeBreak?.status === "ON_BREAK";
  const isPrompted = bm.activeBreak?.status === "NOTIFIED_TO_START";

  const sLeft = bm.budget?.shortRemaining ?? 20; 
  const mLeft = bm.budget?.mealRemaining ?? 40;

  const handleFire = async () => {
    if (cat === "SHORT" && sLeft <= 0) return alert("Short breaks exhausted!");
    if (cat === "MEAL" && mLeft <= 0) return alert("Meal break completed!");
    
    setFiring(true);
    try {
      if (mode === "NOW") {
        const res = await httpsCallable(functions, "requestBreakNow")({ 
          category: cat, 
          minutesNow: cat === "SHORT" ? mins : 40 
        });
        
        if (res.data.status === "AWAITING_SLOT" && res.data.suggestedTime) {
           const timeStr = new Date(res.data.suggestedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
           alert(`Floor is full. You are placed in queue. Expected slot availability around ${timeStr}.`);
        }
      } else {
        if (!schedTime) {
          setFiring(false);
          return alert("Please select a time window.");
        }
        const [h, m] = schedTime.split(":"); 
        const d = new Date(); 
        d.setHours(h, m, 0, 0);
        
        const res = await httpsCallable(functions, "requestBreakLater")({ 
          category: cat, 
          minutesNow: cat === "SHORT" ? mins : 40, 
          scheduledFor: d.getTime() 
        });
        
        if (res.data.status === "SLOT_FULL" && res.data.suggestedTime) {
           const timeStr = new Date(res.data.suggestedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
           if (confirm(`That slot is currently full. The nearest available slot is ${timeStr}. Do you want to book it?`)) {
               await httpsCallable(functions, "requestBreakLater")({ 
                 category: cat, 
                 minutesNow: cat === "SHORT" ? mins : 40, 
                 scheduledFor: res.data.suggestedTime 
               });
               alert("Slot successfully booked!");
           }
        }
      }
    } catch(e) {
      alert(e.message);
    } finally {
      setFiring(false);
    }
  };

  const handleAcceptPrompt = async () => {
    setFiring(true);
    try {
      await httpsCallable(functions, "acceptBreakStart")();
    } catch(e) {
      alert("Failed or slot expired: " + e.message);
    } finally {
      setFiring(false);
    }
  };

  if (isOn) {
    return (
      <div className="glass rounded-[32px] p-8 text-center space-y-4">
        <h3 className="text-lg font-black text-slate-900">Break Ongoing</h3>
        <button type="button" onClick={bm.endBreak} disabled={bm.busy} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase cursor-pointer">
          End Break
        </button>
      </div>
    );
  }
  
  if (isPrompted) {
    return (
      <div className="glass rounded-[32px] p-8 text-center space-y-5 border-2 border-fuchsia-400 bg-fuchsia-50/40">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-100 text-fuchsia-600 animate-bounce shadow-sm">
          <BellRing size={28} />
        </div>
        <div className="space-y-2">
          <h3 className="text-2xl font-black text-fuchsia-900 tracking-tight">Break Slot Ready!</h3>
          <p className="text-xs font-bold text-fuchsia-700/80">
            You have 3 minutes to accept this slot before it automatically passes to the next agent in queue.
          </p>
        </div>
        <div className="pt-2">
          <button onClick={handleAcceptPrompt} disabled={firing || bm.busy} className="bg-fuchsia-600 hover:bg-fuchsia-500 w-full font-black py-4 rounded-2xl text-xs uppercase cursor-pointer text-white shadow-md active:scale-95 transition-all">
            {firing ? "Starting..." : "Accept & Start Break"}
          </button>
        </div>
      </div>
    );
  }
  
  if (isNow || isLater) {
    return (
      <div className="glass rounded-[32px] p-8 text-center space-y-4">
        <h3 className="text-lg font-black text-slate-900">
          {isNow ? "Waiting in Queue" : "Break Scheduled"}
        </h3>
        <div className="flex gap-3 max-w-xs mx-auto">
          {isLater && bm.readyToGo && (
            <button type="button" onClick={bm.goingForBreak} disabled={bm.busy} className="btn-glass flex-1 py-3.5 rounded-xl text-xs uppercase cursor-pointer">
              Go Now
            </button>
          )}
          <button type="button" onClick={bm.cancelScheduledBreak} disabled={bm.busy} className="btn-soft flex-1 py-3.5 rounded-xl text-xs uppercase cursor-pointer text-rose-600 hover:bg-rose-50">
            Cancel Request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-[32px] p-6 sm:p-7 space-y-5 font-sans">
      <div className="border-b border-slate-200/60 pb-3 font-mono text-xs font-bold uppercase text-slate-400">
        Request a Break
      </div>
      
      <div className="grid grid-cols-2 gap-3 font-mono text-xs">
        <button type="button" onClick={() => { setCat("SHORT"); setMins(Math.min(15, sLeft)); }} className={`py-3 rounded-2xl border font-bold transition-all cursor-pointer ${cat === "SHORT" ? "bg-indigo-600 text-white shadow-md border-indigo-600" : "bg-white/60 text-slate-600 border-slate-200/70"}`}>
          ⚡ Short ({sLeft}m)
        </button>
        <button type="button" onClick={() => { setCat("MEAL"); setMins(40); }} className={`py-3 rounded-2xl border font-bold transition-all cursor-pointer ${cat === "MEAL" ? "bg-indigo-600 text-white shadow-md border-indigo-600" : "bg-white/60 text-slate-600 border-slate-200/70"}`}>
          🍱 Meal ({mLeft}m)
        </button>
      </div>

      {cat === "SHORT" && (
        <div className="space-y-1.5 bg-white/60 p-4 rounded-2xl border shadow-sm">
          <div className="flex justify-between text-xs font-mono text-slate-500 mb-2">
            <span>Select Time</span><strong className="text-indigo-600 font-black">{mins} mins</strong>
          </div>
          <input type="range" min={1} max={Math.max(1, sLeft)} value={mins} onChange={e => setMins(Number(e.target.value))} className="w-full accent-indigo-600 cursor-pointer"/>
        </div>
      )}

      <div className="flex gap-2 bg-white/70 p-1.5 rounded-2xl border font-mono text-xs">
        <button type="button" onClick={() => setMode("NOW")} className={`flex-1 py-2 rounded-xl font-bold cursor-pointer ${mode === "NOW" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400"}`}>
          Immediate
        </button>
        <button type="button" onClick={() => setMode("LATER")} className={`flex-1 py-2 rounded-xl font-bold cursor-pointer ${mode === "LATER" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400"}`}>
          Schedule
        </button>
      </div>

      {mode === "LATER" && (
        <div className="bg-white/60 p-4 rounded-2xl border border-slate-200/70">
          <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-mono font-bold text-slate-900 outline-none focus:border-indigo-600"/>
        </div>
      )}

      <button type="button" onClick={handleFire} disabled={firing || bm.busy || (cat === "SHORT" && sLeft <= 0) || (cat === "MEAL" && mLeft <= 0)} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase cursor-pointer disabled:opacity-50 shadow-md active:scale-95">
        {firing || bm.busy ? "Processing..." : `Request Break`}
      </button>
    </div>
  );
}

function ShiftLightFooter({ shift, now, reqMs }) {
  const sMs = toMillis(shift?.shiftStart); 
  const el = sMs ? Math.max(0, now - sMs) : 0; 
  const hrs = Math.floor(el / 3600000); 
  const mins = Math.floor((el % 3600000) / 60000);

  return (
    <div className="glass rounded-[28px] p-6 space-y-3 font-sans">
      <div className="flex justify-between text-xs text-slate-400 font-bold font-mono">
        <span>Login Time</span>
        <span className="text-slate-800">{sMs ? formatClock(sMs) : "—"}</span>
      </div>
      <div className="flex justify-between text-[11px] text-slate-500 font-mono font-semibold">
        <span>Completed: <strong>{hrs}h {mins}m</strong></span>
      </div>
    </div>
  );
}

function AgentChangePasswordModal({ onClose }) {
  const [newPass, setNewPass] = useState(""); 
  const [confirmPass, setConfirmPass] = useState(""); 
  const [busy, setBusy] = useState(false); 
  const [err, setErr] = useState(null);
  
  const handleSubmit = async (e) => { 
    e.preventDefault(); 
    if(newPass !== confirmPass) return setErr("Mismatch"); 
    setBusy(true); 
    try { 
      await httpsCallable(functions, "agentUpdateOwnPassword")({ newPass }); 
      onClose(); 
    } catch(e) { 
      setErr(e.message); 
      setBusy(false); 
    } 
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in font-sans">
      <div className="glass w-full max-w-sm rounded-[32px] p-8 space-y-5 bg-white">
        <div className="flex justify-between border-b pb-3 font-mono font-bold text-xs text-indigo-600">
          <span>🔑 Security</span>
          <button type="button" onClick={onClose}><X size={16}/></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="password" required placeholder="New Pass" value={newPass} onChange={e => setNewPass(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-mono font-bold outline-none"/>
          <input type="password" required placeholder="Confirm" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-mono font-bold outline-none"/>
          {err && <p className="text-xs text-rose-600 font-bold text-center">{err}</p>}
          <button type="submit" disabled={busy} className="btn-glass w-full py-3.5 rounded-xl text-xs font-bold uppercase cursor-pointer">
            Update
          </button>
        </form>
      </div>
    </div>
  );
}

function AgentShiftLogoutModal({ bm, onClose }) {
  const [closingBusy, setClosingBusy] = useState(false);
  const [slaDeficitErr, setSlaDeficitErr] = useState(null);

  const handleSafeLogout = async () => {
    setClosingBusy(true);
    try { await auth.signOut(); } catch(e) {}
    window.location.replace("/");
  };

  const handleEndShiftAndReset = async () => {
    if (!bm.isShiftSlaMet) {
      const deficitMs = bm.shiftReqMillis - bm.shiftElapsedMillis;
      const dHrs = Math.floor(deficitMs / 3600000); 
      const dMins = Math.floor((deficitMs % 3600000) / 60000);
      setSlaDeficitErr(`Warning: Mandatory 9-Hour shift unfulfilled (${dHrs}h ${dMins}m remaining). Shift close rejected.`);
      return;
    }
    setClosingBusy(true); 
    setSlaDeficitErr(null);
    try {
      await httpsCallable(functions, "endShiftLogout")();
      await auth.signOut();
      window.location.replace("/");
    } catch (err) { 
      alert("Shift close failed: " + err.message); 
      setClosingBusy(false); 
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in font-sans">
      <div className="glass w-full max-w-md rounded-[32px] p-8 text-center space-y-6 bg-white/95 shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 border shadow-inner">
          <LogOut size={28} />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-black text-slate-900 tracking-tight">End your shift?</h3>
          <p className="text-xs text-slate-500 font-medium">This records your final hours and resets your break limits.</p>
        </div>
        {slaDeficitErr && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-left shadow-sm">
            <p className="text-xs font-bold text-rose-700">🚨 {slaDeficitErr}</p>
          </div>
        )}
        <div className="space-y-2.5 pt-2">
          <button type="button" onClick={handleEndShiftAndReset} disabled={closingBusy} className="w-full bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-black py-4 rounded-2xl text-xs uppercase shadow-md cursor-pointer disabled:opacity-50 transition-all active:scale-95">
            {closingBusy ? "Processing..." : "Yes, End Shift & Save Data"}
          </button>
          <button type="button" onClick={handleSafeLogout} disabled={closingBusy} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl text-xs uppercase transition-all cursor-pointer disabled:opacity-50">
            No, Just Log Me Out
          </button>
          <button type="button" onClick={onClose} disabled={closingBusy} className="text-xs text-slate-400 hover:text-slate-600 font-semibold pt-2 block mx-auto cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⚡ MASTER TOGGLE EXPORT (NEVER TRUNCATED!)
// ─────────────────────────────────────────────────────────────────────────────
export function WorkModeToggle({ profile }) {
  const [mode, setMode] = useState(profile?.workMode || "WFO");
  const [updating, setUpdating] = useState(false);

  useEffect(() => { 
    if (profile?.workMode) setMode(profile.workMode); 
  }, [profile?.workMode]);

  const toggle = async (newMode) => {
    if (mode === newMode || updating) return;
    const oldMode = mode; 
    setMode(newMode); 
    setUpdating(true);
    
    try {
      const targetUid = profile.uid || profile.id;
      await setDoc(doc(db, "users", targetUid), { workMode: newMode }, { merge: true });
      await setDoc(doc(db, "presence", targetUid), { workMode: newMode }, { merge: true });
    } catch(e) { 
      setMode(oldMode); 
      console.error("Toggle Failed:", e);
    } finally { 
      setUpdating(false); 
    }
  };

  return (
    <div className="flex bg-slate-200/60 p-[3px] rounded-xl border border-slate-200/80 shadow-inner relative items-center w-fit h-fit font-sans shrink-0">
      <div 
        className="absolute top-[3px] bottom-[3px] w-[calc(50%-3px)] bg-white rounded-[9px] shadow border transition-all duration-300 ease-out" 
        style={{ left: mode === 'WFH' ? 'calc(50%)' : '3px' }}
      ></div>
      <button 
        type="button" 
        onClick={() => toggle('WFO')} 
        className={`relative z-10 px-3 py-1 text-[9px] font-black font-mono tracking-widest rounded-lg transition-colors cursor-pointer ${mode === 'WFO' ? 'text-amber-700' : 'text-slate-500'}`}
      >
        WFO
      </button>
      <button 
        type="button" 
        onClick={() => toggle('WFH')} 
        className={`relative z-10 px-3 py-1 text-[9px] font-black font-mono tracking-widest rounded-lg transition-colors cursor-pointer ${mode === 'WFH' ? 'text-indigo-700' : 'text-slate-500'}`}
      >
        WFH
      </button>
    </div>
  );
}