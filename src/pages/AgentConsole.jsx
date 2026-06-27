import React, { useState, useEffect } from "react";
import { doc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useBreakManagement } from "../hooks/useBreakManagement";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import { formatClock, toMillis } from "../utils/timeHelpers";
import { LogOut, WifiOff, AlertTriangle, Play, Loader2, Shield, Key, Copy, Check, Sparkles, X, Lock, ShieldAlert, Clock, Sunset } from "lucide-react";

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
  const projectSupervisors = supervisorsOnline.filter(s => (s.project || "GENERAL").toUpperCase() === myProject || (s.project || "GENERAL").toUpperCase() === "GENERAL");

  const handleClockIn = async () => {
    setSyncing(true);
    try { await httpsCallable(functions, "startShift")(); window.location.reload(); } 
    catch (e) { alert("Clock-in failed: " + e.message); setSyncing(false); }
  };

  const handleCopyId = () => {
    if (!profile?.employeeId) return; navigator.clipboard.writeText(profile.employeeId);
    setCopiedId(true); setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div className="relative min-h-screen text-slate-800 font-sans pb-24 selection:bg-indigo-500 selection:text-white">
      <div className="mesh-bg" />

      <header className="glass-bar sticky top-0 z-30 px-6 py-3.5 font-sans">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white font-black text-xs shadow-md font-mono">IQ</div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xs font-black uppercase text-slate-900">Agent Portal</h1>
                <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 font-mono">{myProject}</span>
                {/* ⚡ THE FIX: Hide Toggle if Shift is NOT Active! */}
                {!missingShift && <WorkModeToggle profile={profile} />}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                <span className="font-bold text-slate-700">{profile?.name}</span>
                <span>·</span>
                <span className="font-mono text-slate-600 font-bold inline-flex items-center gap-1 bg-white/80 px-2 py-0.5 rounded-md border border-slate-200">
                  {profile?.employeeId}
                  <button onClick={handleCopyId} className="text-slate-400 hover:text-indigo-600 ml-0.5 cursor-pointer">
                    {copiedId ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                  </button>
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 font-mono">
            <button onClick={() => setShowPassModal(true)} className="btn-soft flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold cursor-pointer font-sans"><Key size={13} className="text-indigo-600" /> <span>Password</span></button>
            <button onClick={() => setShowLogoutModal(true)} className="btn-soft flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 hover:border-rose-200 cursor-pointer font-sans transition-all"><LogOut size={13} /> <span>Exit / Logout</span></button>
          </div>
        </div>
      </header>

      <div className="relative z-10 border-b border-slate-200/80 bg-white/50 py-2.5 px-6 text-xs text-slate-600 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between font-sans">
          <span className="flex items-center gap-2 font-medium"><Sparkles size={13} className="text-amber-600 animate-pulse" /><strong>Floor Invariant:</strong> Mandatory shift span is {bm.config?.shiftDurationHours || 9} hours. Standard short break budget is {bm.config?.shortBreakMin || 20}m daily.</span>
          <span className="text-[11px] font-mono text-emerald-600 font-bold">● Telemetry Active</span>
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-6xl px-6 mt-8 font-sans">
        {missingShift ? (
          <div className="glass max-w-md mx-auto rounded-[32px] p-8 text-center space-y-4 animate-rise font-sans">
            <div className="flex items-center justify-center gap-2 text-indigo-600 font-black text-xs uppercase tracking-wider font-mono"><AlertTriangle size={16} /> <span>Shift Clock Inactive</span></div>
            <p className="text-xs text-slate-600 font-medium leading-relaxed">Welcome to the {myProject} floor. Please stamp your attendance clock to unlock your break quotas.</p>
            <button onClick={handleClockIn} disabled={syncing} className="btn-glass w-full font-black uppercase tracking-wider py-4 rounded-2xl text-xs cursor-pointer shadow-md font-sans">{syncing ? "Stamping Clock..." : "Clock In Now"}</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8 space-y-6">
              <div className="animate-rise"><AgentLightStatusWidget activeBreak={bm.activeBreak} budget={bm.budget} now={bm.now} /></div>
              
              {bm.windowStatus?.locked ? (
                <div className="glass rounded-[32px] border-rose-200 bg-rose-50/70 p-8 text-center space-y-3 animate-rise">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-md animate-bounce"><ShieldAlert size={24} /></div>
                  <h3 className="text-base font-black uppercase tracking-wider text-rose-900 font-mono">Floor Departures Paused</h3>
                  <p className="text-xs text-slate-600 max-w-md mx-auto font-medium">Command Tower has placed an emergency freeze on breaks:</p>
                  <div className="inline-block bg-white border border-rose-200 rounded-xl px-4 py-2 shadow-sm"><p className="text-xs font-mono font-bold text-rose-700">"{bm.windowStatus?.message || "P1 Outage Volume Spike"}"</p></div>
                </div>
              ) : bm.isStartLocked ? (
                <div className="glass rounded-[32px] border-indigo-200/80 bg-indigo-50/30 p-8 text-center space-y-3 animate-rise">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md animate-spin"><Clock size={24} /></div>
                  <h3 className="text-base font-black uppercase tracking-wider text-indigo-950 font-mono">Shift Horizon Fenced (Start Lock)</h3>
                  <p className="text-xs text-slate-600 max-w-md mx-auto font-medium leading-relaxed">
                    Standard WFM policy disables break requests for the first {bm.config?.lockoutStartMin || 60} minutes of your shift. Fencing unlocks in:
                  </p>
                  <div className="inline-block bg-white border border-indigo-200 rounded-2xl px-6 py-3 shadow-sm font-mono text-3xl font-black text-indigo-900 tabular-nums">
                    {String(Math.floor(bm.startLockoutMillis / 60000)).padStart(2, '0')}:{String(Math.floor((bm.startLockoutMillis % 60000) / 1000)).padStart(2, '0')}
                  </div>
                </div>
              ) : bm.isEndLocked ? (
                <div className="glass rounded-[32px] border-amber-200/80 bg-amber-50/40 p-8 text-center space-y-3 animate-rise">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md"><Sunset size={24} /></div>
                  <h3 className="text-base font-black uppercase tracking-wider text-amber-950 font-mono">Sunset Horizon Reached (End Lock)</h3>
                  <p className="text-xs text-slate-600 max-w-md mx-auto font-medium leading-relaxed">
                    You have entered the final {bm.config?.lockoutEndMin || 60} minutes of your scheduled {bm.config?.shiftDurationHours || 9}-hour shift. Break dispatches are now frozen to prepare for shift handover.
                  </p>
                </div>
              ) : (
                <div className="animate-rise delay-1"><AgentLightControlsWidget bm={bm} /></div>
              )}

              {bm.actionError && <div className="glass rounded-2xl border-rose-200 bg-rose-50/80 p-5 text-center shadow-sm animate-rise font-sans"><p className="text-xs font-bold text-rose-700 font-mono leading-relaxed">{bm.actionError}</p></div>}
            </div>

            <div className="lg:col-span-4 space-y-6 font-sans">
              <div className="glass rounded-[28px] p-6 space-y-4 animate-rise delay-2">
                <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 font-mono">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2"><Shield size={14} className="text-indigo-600" /> Tower Leads</span>
                  <span className="text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200 font-bold">{projectSupervisors.length} Online</span>
                </div>
                {projectSupervisors.length === 0 ? (
                  <div className="py-8 text-center border border-dashed border-slate-200 rounded-2xl bg-white/40 space-y-1"><WifiOff size={18} className="mx-auto text-slate-400" /><p className="text-xs font-bold text-slate-500">No Leads Online</p></div>
                ) : (
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {projectSupervisors.map(sup => (
                      <div key={sup.id || sup.uid} className="flex items-center justify-between bg-white/70 p-3 rounded-2xl border border-slate-200/60 transition-all hover:bg-white">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-xs font-bold text-indigo-600 font-mono shadow-sm">{sup.name?.charAt(0).toUpperCase()}</div>
                          <p className="text-xs font-bold text-slate-900">{sup.name}</p>
                        </div>
                        <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-bold font-mono">● Duty</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {bm.shift && <div className="animate-rise delay-3"><ShiftLightFooter shift={bm.shift} now={bm.now} reqMs={bm.shiftReqMillis} /></div>}
            </div>
          </div>
        )}
      </main>

      {showPassModal && <AgentChangePasswordModal onClose={() => setShowPassModal(false)} />}
      {showLogoutModal && <AgentShiftLogoutModal bm={bm} onClose={() => setShowLogoutModal(false)} />}

      <footer className="relative z-10 py-6 text-center font-sans">
        <p className="text-xs font-bold text-slate-400 tracking-wide">Made with <span className="text-rose-500 inline-block animate-pulse">❤️</span> by <strong className="text-slate-600 font-black">Harshit Sinha</strong></p>
      </footer>
    </div>
  );
}

// ----------------------------------------------------------------------
// ⚡ THE SMOOTH WFO/WFH TOGGLE ENGINE
// ----------------------------------------------------------------------
export function WorkModeToggle({ profile }) {
  const [mode, setMode] = useState(profile?.workMode || "WFO");
  const [updating, setUpdating] = useState(false);

  useEffect(() => { if (profile?.workMode) setMode(profile.workMode); }, [profile?.workMode]);

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
    <div className="flex bg-slate-200/60 p-[3px] rounded-xl border border-slate-200/80 shadow-inner relative items-center w-fit h-fit">
      <div 
        className="absolute top-[3px] bottom-[3px] w-[calc(50%-3px)] bg-white rounded-[9px] shadow border border-slate-200/50 transition-all duration-300 ease-out"
        style={{ left: mode === 'WFH' ? 'calc(50%)' : '3px' }}
      ></div>
      <button 
        onClick={() => toggle('WFO')} 
        className={`relative z-10 px-3 py-1 text-[9px] font-black font-mono tracking-widest rounded-lg transition-colors duration-300 ${mode === 'WFO' ? 'text-amber-700' : 'text-slate-500 hover:text-slate-700'}`}
      >WFO</button>
      <button 
        onClick={() => toggle('WFH')} 
        className={`relative z-10 px-3 py-1 text-[9px] font-black font-mono tracking-widest rounded-lg transition-colors duration-300 ${mode === 'WFH' ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
      >WFH</button>
    </div>
  );
}

// ----------------------------------------------------------------------
// CHILD COMPONENTS
// ----------------------------------------------------------------------

function AgentShiftLogoutModal({ bm, onClose }) {
  const [closingBusy, setClosingBusy] = useState(false);
  const [slaDeficitErr, setSlaDeficitErr] = useState(null);

  const handleSafeLogout = async () => {
    setClosingBusy(true);
    try { await auth.signOut(); } catch(e) {}
    setTimeout(() => { window.location.href = "/"; }, 400);
  };

  const handleEndShiftAndReset = async () => {
    if (!bm.isShiftSlaMet) {
      const deficitMs = bm.shiftReqMillis - bm.shiftElapsedMillis;
      const dHrs = Math.floor(deficitMs / 3600000); const dMins = Math.floor((deficitMs % 3600000) / 60000);
      setSlaDeficitErr(`Mandatory ${bm.config?.shiftDurationHours || 9}-Hour SLA unfulfilled. You still have a deficit of ${dHrs}h ${dMins}m remaining on your shift clock. Shift closure rejected.`);
      return;
    }
    setClosingBusy(true); setSlaDeficitErr(null);
    try {
      await httpsCallable(functions, "endShiftLogout")();
      await auth.signOut();
      setTimeout(() => { window.location.href = "/"; }, 400);
    } catch (err) { alert("Shift close failed: " + err.message); setClosingBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in font-sans">
      <div className="glass w-full max-w-md rounded-[32px] p-8 text-center space-y-6 animate-rise shadow-2xl bg-white/95">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-inner">
          <LogOut size={28} />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-black text-slate-900 tracking-tight">Do you want to end your shift?</h3>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">Ending your shift records your final completed hours to the database and permanently resets your daily break quotas.</p>
        </div>
        {slaDeficitErr && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-left animate-rise shadow-sm">
            <p className="text-xs font-mono font-bold text-rose-700 leading-relaxed">🚨 {slaDeficitErr}</p>
          </div>
        )}
        <div className="space-y-2.5 pt-2 font-sans">
          <button onClick={handleEndShiftAndReset} disabled={closingBusy} className="w-full bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-black py-4 rounded-2xl text-xs uppercase tracking-wider shadow-md cursor-pointer transition-all active:scale-[0.99] disabled:opacity-50">
            {closingBusy ? "Processing Ledger..." : "Yes, End My Shift & Reset Data"}
          </button>
          <button onClick={handleSafeLogout} disabled={closingBusy} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl text-xs uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50">
            No, Keep Shift Active (Just Log Me Out)
          </button>
          <button onClick={onClose} disabled={closingBusy} className="text-xs text-slate-400 hover:text-slate-600 font-semibold pt-2 block mx-auto cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentLightStatusWidget({ activeBreak, budget, now }) {
  const isOnBreak = activeBreak?.status === "ON_BREAK"; const isInQueue = activeBreak?.status === "AWAITING_SLOT" || activeBreak?.status === "IN_QUEUE"; const isSched = activeBreak?.status === "APPROVED_SCHEDULED";
  const mealTotal = budget?.mealTotal ?? 40; const shortTotal = budget?.shortTotal ?? 20; const mealLeft = budget?.mealRemaining ?? mealTotal; const shortLeft = budget?.shortRemaining ?? shortTotal;

  let elapsedStr = "00:00"; let isOverrun = false;
  if (isOnBreak && activeBreak?.breakStartedAt) {
    const startMs = toMillis(activeBreak.breakStartedAt) || now; const diffMs = Math.max(0, now - startMs); const allottedMin = activeBreak.requestedDurationMin || 20;
    if (diffMs > allottedMin * 60000) isOverrun = true;
    const mm = String(Math.floor(diffMs / 60000)).padStart(2, "0"); const ss = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, "0"); elapsedStr = `${mm}:${ss}`;
  }

  let statusBg = "bg-emerald-500"; let statusText = "AVAILABLE (ON CALL)"; let cardBorder = "border-slate-200/80 bg-white/70";
  if (isOnBreak) { statusBg = isOverrun ? "bg-rose-500 animate-ping" : "bg-amber-500 animate-pulse"; statusText = isOverrun ? `SLA OVERRUN (${activeBreak?.breakCategory})` : `ON ${activeBreak?.breakCategory} BREAK`; cardBorder = isOverrun ? "border-rose-300 bg-rose-50/60" : "border-amber-200 bg-amber-50/50"; }
  else if (isInQueue) { statusBg = "bg-indigo-500 animate-bounce"; statusText = "QUEUED IN FIFO PIPELINE"; cardBorder = "border-indigo-200 bg-indigo-50/40"; }
  else if (isSched) { statusBg = "bg-cyan-500"; statusText = "SCHEDULE APPROVED"; }

  return (
    <div className={`glass rounded-[32px] p-7 space-y-6 transition-all ${cardBorder}`}>
      <div className="flex items-center justify-between border-b border-slate-200/60 pb-5 font-mono">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Floor Telemetry</span>
          <div className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${statusBg}`} /><h2 className={`text-sm font-black uppercase tracking-wider ${isOverrun ? "text-rose-700 font-extrabold" : "text-slate-900"}`}>{statusText}</h2></div>
        </div>
        <div className="text-right"><span className="text-xs text-slate-400 block">System Clock</span><span className="text-base font-black text-slate-900 tabular-nums">{formatClock(now)}</span></div>
      </div>
      
      {isOnBreak && (
        <div className={`p-6 rounded-2xl border text-center transition-all shadow-sm ${isOverrun ? "bg-rose-500/15 border-rose-300" : "bg-amber-50 border-amber-200"}`}>
          <div className="flex items-center justify-center gap-1.5 text-xs font-mono uppercase tracking-widest font-bold mb-1 text-slate-600">
            <Clock size={14} className={isOverrun ? "text-rose-600 animate-spin" : "text-amber-600"} />
            <span>{isOverrun ? "🚨 Allotted Limit Exceeded" : "Stopwatch Timer"}</span>
          </div>
          <div className={`font-mono text-5xl font-black tabular-nums tracking-tight ${isOverrun ? "text-rose-600 animate-pulse font-extrabold" : "text-amber-800"}`}>
            {elapsedStr}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 font-sans font-medium">Allotted: {activeBreak.requestedDurationMin} mins</p>
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-4 font-sans">
        <div className="bg-white/80 border border-slate-200/70 rounded-2xl p-4 space-y-2 shadow-sm">
          <div className="flex justify-between text-xs font-mono"><span className="text-slate-500 font-bold font-sans">Meal Entitlement</span><span className="font-black text-indigo-600">{mealLeft}m Left</span></div>
          <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden"><div className="h-full bg-indigo-600 rounded-full transition-all duration-700" style={{ width: `${((mealTotal-mealLeft)/mealTotal)*100}%` }}/></div>
        </div>
        <div className="bg-white/80 border border-slate-200/70 rounded-2xl p-4 space-y-2 shadow-sm">
          <div className="flex justify-between text-xs font-mono"><span className="text-slate-500 font-bold font-sans">Short Break Bank</span><span className={`font-black ${shortLeft <= 0 ? "text-rose-600" : "text-emerald-600"}`}>{shortLeft}m Left</span></div>
          <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${shortLeft <= 0 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${((shortTotal-shortLeft)/shortTotal)*100}%` }}/></div>
        </div>
      </div>
    </div>
  );
}

function AgentLightControlsWidget({ bm }) {
  const [cat, setCat] = useState("SHORT"); const [mins, setMins] = useState(15); const [mode, setMode] = useState("NOW"); const [schedTime, setSchedTime] = useState("");
  const isLater = bm.activeBreak?.status === "APPROVED_SCHEDULED"; const isNow = bm.activeBreak?.status === "AWAITING_SLOT" || bm.activeBreak?.status === "IN_QUEUE"; const isOn = bm.activeBreak?.status === "ON_BREAK";
  const sLeft = bm.budget?.shortRemaining ?? 20; const mLeft = bm.budget?.mealRemaining ?? 40;

  const handleFire = () => {
    if (cat === "SHORT" && sLeft <= 0) return alert("Short breaks exhausted!");
    if (cat === "MEAL" && mLeft <= 0) return alert("Meal break completed!");
    if (mode === "NOW") bm.requestBreakNow({ category: cat, minutesNow: cat === "SHORT" ? mins : 40 });
    else {
      if (!schedTime) return alert("Select window time."); const [h, m] = schedTime.split(":"); const d = new Date(); d.setHours(h, m, 0, 0);
      bm.requestBreakLater({ category: cat, minutesNow: cat === "SHORT" ? mins : 40, scheduledFor: d.getTime() });
    }
  };

  if (isOn) return (<div className="glass rounded-[32px] p-8 text-center space-y-4"><h3 className="text-lg font-black text-slate-900">Session Ongoing</h3><button onClick={bm.endBreak} disabled={bm.busy} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase cursor-pointer">End Break</button></div>);
  if (isNow || isLater) return (<div className="glass rounded-[32px] p-8 text-center space-y-4"><h3 className="text-lg font-black text-slate-900">{isNow ? "Queued in FIFO" : "Slot Locked"}</h3><div className="flex gap-3 max-w-xs mx-auto">{isLater && bm.readyToGo && <button onClick={bm.goingForBreak} disabled={bm.busy} className="btn-glass flex-1 py-3.5 rounded-xl text-xs uppercase cursor-pointer">Go Now</button>}<button onClick={bm.cancelScheduledBreak} disabled={bm.busy} className="btn-soft flex-1 py-3.5 rounded-xl text-xs uppercase cursor-pointer text-rose-600 hover:bg-rose-50">Cancel Request</button></div></div>);

  return (
    <div className="glass rounded-[32px] p-7 space-y-5 font-sans">
      <div className="border-b border-slate-200/60 pb-3 font-mono text-xs font-bold uppercase text-slate-400">Dispatch Break Transaction</div>
      <div className="grid grid-cols-2 gap-3 font-mono text-xs">
        <button type="button" onClick={() => { setCat("SHORT"); setMins(Math.min(15, sLeft)); }} className={`py-3 rounded-2xl border font-bold transition-all cursor-pointer ${cat === "SHORT" ? "bg-indigo-600 text-white shadow-md border-indigo-600" : "bg-white/60 text-slate-600 border-slate-200/70"}`}>⚡ Short ({sLeft}m)</button>
        <button type="button" onClick={() => { setCat("MEAL"); setMins(40); }} className={`py-3 rounded-2xl border font-bold transition-all cursor-pointer ${cat === "MEAL" ? "bg-indigo-600 text-white shadow-md border-indigo-600" : "bg-white/60 text-slate-600 border-slate-200/70"}`}>🍱 Meal ({mLeft}m)</button>
      </div>
      {cat === "SHORT" && (
        <div className="space-y-1.5 bg-white/60 p-4 rounded-2xl border border-slate-200/70 shadow-sm">
          <div className="flex justify-between text-xs font-mono text-slate-500"><span>Withdraw</span><strong className="text-indigo-600 font-black">{mins}m selected</strong></div>
          <input type="range" min={1} max={Math.max(1, sLeft)} value={mins} onChange={e => setMins(Number(e.target.value))} className="w-full accent-indigo-600 cursor-pointer"/>
        </div>
      )}
      <div className="flex gap-2 bg-white/70 p-1.5 rounded-2xl border border-slate-200/80 font-mono text-xs">
        <button type="button" onClick={() => setMode("NOW")} className={`flex-1 py-2 rounded-xl font-bold cursor-pointer ${mode === "NOW" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400"}`}>Immediate</button>
        <button type="button" onClick={() => setMode("LATER")} className={`flex-1 py-2 rounded-xl font-bold cursor-pointer ${mode === "LATER" ? "bg-white text-slate-900 shadow-sm" : "text-slate-400"}`}>Schedule</button>
      </div>
      {mode === "LATER" && (
        <div className="bg-white/60 p-4 rounded-2xl border border-slate-200/70">
          <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-mono font-bold text-slate-900 outline-none focus:border-indigo-600"/>
        </div>
      )}
      <button onClick={handleFire} disabled={bm.busy || (cat === "SHORT" && sLeft <= 0) || (cat === "MEAL" && mLeft <= 0)} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase cursor-pointer disabled:opacity-50">
        {bm.busy ? "..." : `Request ${cat}`}
      </button>
    </div>
  );
}

function ShiftLightFooter({ shift, now, reqMs }) {
  const sMs = toMillis(shift?.shiftStart); const el = sMs ? Math.max(0, now - sMs) : 0; const tot = reqMs || (9 * 3600000); const pct = Math.min(100, (el / tot) * 100); const hrs = Math.floor(el / 3600000); const mins = Math.floor((el % 3600000) / 60000);
  return (
    <div className="glass rounded-[28px] p-6 space-y-3 font-sans">
      <div className="flex justify-between text-xs text-slate-400 font-bold font-mono"><span>Shift Clock</span><span className="text-slate-800">{sMs ? formatClock(sMs) : "—"}</span></div>
      <div className="h-2 w-full bg-slate-200/70 rounded-full overflow-hidden border border-slate-200/80 shadow-inner"><div className="h-full bg-indigo-600 rounded-full transition-all duration-1000" style={{ width: `${pct}%` }}/></div>
      <div className="flex justify-between text-[11px] text-slate-500 font-mono font-semibold"><span>Logged: <strong>{hrs}h {mins}m</strong></span><span>{Math.round(pct)}% Burn</span></div>
    </div>
  );
}

function AgentChangePasswordModal({ onClose }) {
  const [newPass, setNewPass] = useState(""); const [confirmPass, setConfirmPass] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const handleSubmit = async (e) => { e.preventDefault(); if(newPass !== confirmPass) return setErr("Mismatch"); setBusy(true); try { await httpsCallable(functions, "agentUpdateOwnPassword")({ newPass }); onClose(); } catch(e) { setErr(e.message); setBusy(false); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in font-sans">
      <div className="glass w-full max-w-sm rounded-[32px] p-8 space-y-5 bg-white">
        <div className="flex justify-between border-b pb-3 font-mono font-bold text-xs text-indigo-600"><span>🔑 Security</span><button onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="password" required placeholder="New Pass" value={newPass} onChange={e => setNewPass(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-mono font-bold outline-none"/>
          <input type="password" required placeholder="Confirm" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-mono font-bold outline-none"/>
          {err && <p className="text-xs text-rose-600 font-bold text-center">{err}</p>}
          <button type="submit" disabled={busy} className="btn-glass w-full py-3.5 rounded-xl text-xs font-bold uppercase cursor-pointer">Update</button>
        </form>
      </div>
    </div>
  );
}