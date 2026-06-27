import React, { useState, useEffect, useMemo } from "react";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useFloorData } from "../hooks/useFloorData";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import { useBreakManagement } from "../hooks/useBreakManagement";
import { toMillis, formatClock } from "../utils/timeHelpers";
import { downloadMonthlyBreakReport } from "../utils/exportReport";
import { WorkModeToggle } from "./AgentConsole"; 
import { AlertTriangle, LogOut, Download, Loader2, WifiOff, Search, Shield, UserPlus, Trash2 } from "lucide-react";

export default function SupervisorTower() {
  const { profile } = useAuth();
  useHeartbeat(profile?.uid, profile?.name, profile?.role);

  const supervisorsOnline = useOnlineRoster("SUPERVISOR");
  const agentsOnline = useOnlineRoster("AGENT");
  const { settings, agents, activeBreaks, pendingBreaks } = useFloorData();

  const [activeTab, setActiveTab] = useState("MONITORING"); 
  const [now, setNow] = useState(Date.now());
  const [revoking, setRevoking] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [togglingOutage, setTogglingOutage] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [flushing, setFlushing] = useState(false);

  const myProject = (profile?.project || "GENERAL").trim().toUpperCase();
  
  useEffect(() => { 
    const t = setInterval(() => setNow(Date.now()), 1000); 
    return () => clearInterval(t); 
  }, []);

  const max = settings?.maxConcurrentBreaks || 2;
  const onlineAgentIds = new Set(agentsOnline.map(a => a.id || a.uid));
  const isFloorFrozen = settings?.emergencyLockout;

  const handleSafeLogout = async () => {
    try { await auth.signOut(); } catch(e) {}
    window.location.replace("/");
  };

  // ⚡ OUTAGE LIFT FIXED: Bright green when paused!
  const handleToggleLockdown = async () => {
    const action = isFloorFrozen ? "Resume All Breaks (Lift Outage)" : "Pause All Breaks";
    const reason = isFloorFrozen ? null : prompt("Reason for pausing breaks:", "High Volume / Outage");
    if (!isFloorFrozen && !reason) return; 
    if (!confirm(`Are you sure you want to ${action}?`)) return;
    
    setTogglingOutage(true);
    try { 
      await httpsCallable(functions, "toggleEmergencyLockout")({ locked: !isFloorFrozen, reason }); 
    } catch (e) { 
      alert(e.message); 
    } finally { 
      setTogglingOutage(false); 
    }
  };

  const handleRevoke = async (uid) => {
    if (!confirm("Force recall agent from break?")) return; 
    setRevoking(uid);
    try { 
      await httpsCallable(functions, "adminForceEndBreak")({ targetUid: uid }); 
    } catch (e) { 
      alert(e.message); 
    } finally { 
      setRevoking(null); 
    }
  };

  const handleRemoveAgent = async (uid, agentName) => {
    if (!confirm(`Delete ${agentName}'s account entirely?`)) return; 
    setRemoving(uid);
    try { 
      await httpsCallable(functions, "deleteUserAccount")({ targetUid: uid }); 
    } catch (e) { 
      alert(e.message); 
    } finally { 
      setRemoving(null); 
    }
  };

  const handleRejectBreak = async (uid) => {
    if (!confirm("Reject this pending break request?")) return;
    setRevoking(uid);
    try { 
      await httpsCallable(functions, "cancelScheduledBreak")({ targetUid: uid }); 
    } catch (e) { 
      alert(e.message); 
    } finally { 
      setRevoking(null); 
    }
  };

  // ⚡ FLUSH QUEUE FUNCTION RESTORED
  const handleFlushQueue = async () => {
    if (!confirm(`Purge all stuck breaks and reset stuck counters?`)) return;
    setFlushing(true);
    try { 
      await httpsCallable(functions, "flushGhostQueue")({ project: myProject }); 
    } catch (e) { 
      alert(e.message); 
    } finally { 
      setFlushing(false); 
    }
  };

  const myProjectAgents = useMemo(() => agents.filter(a => (a.project || "GENERAL").toUpperCase() === myProject), [agents, myProject]);
  
  // ⚡ GHOST COUNT BUG FIXED: Filters strictly active ON_BREAK sessions belonging to existing staff!
  const validAgentUids = useMemo(() => new Set(myProjectAgents.map(a => a.uid || a.id)), [myProjectAgents]);
  
  const activeProjectBreaks = useMemo(() => {
    return activeBreaks.filter(b => 
      (b.project || "GENERAL").toUpperCase() === myProject && 
      (b.status === "ON_BREAK" || b.status === "BREAK_EXCEEDED") &&
      validAgentUids.has(b.uid)
    );
  }, [activeBreaks, myProject, validAgentUids]);

  const agentsOnBreakCount = activeProjectBreaks.length;
  const exceededProjectBreaks = activeProjectBreaks.filter(b => b.exceeded).length;
  
  // Strict queue count based on actual agent states
  const agentsInQueueCount = myProjectAgents.filter(a => a.status === "IN_QUEUE" || a.status === "AWAITING_SLOT" || a.status === "NOTIFIED_TO_START").length;

  const processedRoster = useMemo(() => {
    return myProjectAgents
      .map(a => ({ ...a, isOnline: onlineAgentIds.has(a.uid || a.id) }))
      .filter(a => {
        const m = a.name?.toLowerCase().includes(searchQuery.toLowerCase()) || a.employeeId?.toLowerCase().includes(searchQuery.toLowerCase());
        if (!m) return false;
        if (statusFilter === "ONLINE") return a.isOnline;
        if (statusFilter === "ON_BREAK") return a.status === "ON_BREAK" || a.status === "BREAK_EXCEEDED";
        if (statusFilter === "AVAILABLE") return a.status === "AVAILABLE" && a.isOnline;
        if (statusFilter === "RISK") return a.status === "BREAK_EXCEEDED";
        if (statusFilter === "QUEUE") return a.status === "IN_QUEUE" || a.status === "AWAITING_SLOT" || a.status === "NOTIFIED_TO_START";
        return true;
      }).sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0));
  }, [myProjectAgents, onlineAgentIds, searchQuery, statusFilter]);

  return (
    <div className="relative min-h-screen text-slate-800 font-sans pb-24 selection:bg-indigo-500 selection:text-white">
      <div className="mesh-bg" />

      {/* ⚡ MOBILE RESPONSIVE HEADER */}
      <header className="glass-bar sticky top-0 z-40 px-4 sm:px-6 py-3.5 font-sans">
        <div className="mx-auto flex flex-wrap max-w-7xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white font-black text-sm shadow-md font-mono">
              TL
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-xs sm:text-sm font-black uppercase text-slate-900">Supervisor Dashboard</h1>
                <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-600 font-mono">
                  {myProject}
                </span>
                <WorkModeToggle profile={profile} />
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 truncate max-w-[200px] sm:max-w-none">
                Lead: <strong className="text-slate-700">{profile?.name}</strong> · Other TLs: <strong className="text-indigo-600">{supervisorsOnline.length}</strong>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono w-full sm:w-auto justify-end">
            
            {/* ⚡ GREEN BUTTON WHEN PAUSED */}
            <button onClick={handleToggleLockdown} disabled={togglingOutage} className={`flex flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-xl px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-black uppercase cursor-pointer transition-all shadow-sm ${isFloorFrozen ? "bg-emerald-600 hover:bg-emerald-500 text-white animate-pulse" : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100"}`}>
              {togglingOutage ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} 
              <span>{isFloorFrozen ? "▶ Resume Breaks (Lift)" : "⏸ Pause Breaks"}</span>
            </button>

            <button onClick={() => { setReportBusy(true); const d = new Date(); downloadMonthlyBreakReport(d.getFullYear(), d.getMonth() + 1).finally(() => setReportBusy(false)); }} disabled={reportBusy} className="btn-soft flex items-center justify-center gap-1.5 rounded-xl px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-bold text-slate-700 cursor-pointer">
              {reportBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} 
              <span className="hidden sm:inline">Export</span> Reports
            </button>
            <button onClick={handleSafeLogout} className="btn-soft flex items-center justify-center gap-1 rounded-xl px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-bold text-rose-600 cursor-pointer">
              <LogOut size={12} /> Exit
            </button>
          </div>
        </div>
      </header>

      <div className="glass-bar relative z-10 py-2.5 px-4 sm:px-6 font-sans">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs font-mono font-bold">
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={() => setActiveTab("MONITORING")} className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl cursor-pointer transition-all font-sans text-center ${activeTab === "MONITORING" ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25" : "btn-soft text-slate-500"}`}>
              ⚡ Active Floor
            </button>
            <button onClick={() => setActiveTab("PROVISIONING")} className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition-all font-sans ${activeTab === "PROVISIONING" ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25" : "btn-soft text-slate-500"}`}>
              <UserPlus size={14} /> Add Agents
            </button>
          </div>
          <span className="text-[11px] sm:text-xs text-slate-400 font-sans hidden md:inline">Project Lock: <strong className="text-emerald-600 font-bold font-mono">{myProject} STRICT</strong></span>
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 mt-6 space-y-6 animate-rise font-sans">
        
        {/* ⚡ RESPONSIVE METRIC CARDS */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 font-mono">
          <div className="glass rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 text-indigo-600">
            <span className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold block mb-1">Agents on Break</span>
            <div className="text-2xl sm:text-3xl font-black text-slate-900">{agentsOnBreakCount}/{max}</div>
          </div>
          <div className="glass rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 text-slate-700">
            <span className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold block mb-1">Total Staff</span>
            <div className="text-2xl sm:text-3xl font-black text-slate-900">{myProjectAgents.length}</div>
          </div>
          
          {/* ⚡ PERMANENT VISIBLE FLUSH BUTTON INSIDE CARD */}
          <div className="glass rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 text-slate-700 flex flex-col justify-between">
            <div>
              <span className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold block mb-1">Breaks in Queue</span>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">{agentsInQueueCount}</div>
            </div>
            {(agentsInQueueCount > 0 || agentsOnBreakCount > max) && (
              <button onClick={handleFlushQueue} disabled={flushing} className="mt-2.5 w-full bg-rose-100 hover:bg-rose-200 text-rose-700 py-1.5 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm active:scale-95 flex items-center justify-center gap-1">
                <Trash2 size={11}/> {flushing ? "Clearing..." : "Clear Stuck Queue"}
              </button>
            )}
          </div>
          
          <div className="glass rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 text-rose-700">
            <span className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold block mb-1">Break Overruns</span>
            <div className="text-2xl sm:text-3xl font-black text-slate-900">{exceededProjectBreaks}</div>
          </div>
        </div>

        {activeTab === "MONITORING" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 font-sans">
            
            <div className="glass lg:col-span-9 rounded-[28px] sm:rounded-[32px] p-4 sm:p-7 space-y-5">
              <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center border-b border-slate-200/80 pb-4 font-mono">
                <div className="relative w-full sm:w-72">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={`Search agents...`} className="input-glass w-full rounded-xl py-2 pl-9 pr-4 text-xs font-bold text-slate-800 outline-none font-sans" />
                </div>
                <div className="flex flex-wrap gap-1 bg-white/50 p-1 rounded-xl border border-white/60 text-xs justify-center sm:justify-end">
                  <button onClick={() => setStatusFilter("ALL")} className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold transition-all ${statusFilter === "ALL" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500"}`}>All</button>
                  <button onClick={() => setStatusFilter("ON_BREAK")} className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold transition-all ${statusFilter === "ON_BREAK" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500"}`}>On Break</button>
                  <button onClick={() => setStatusFilter("QUEUE")} className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold transition-all ${statusFilter === "QUEUE" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500"}`}>In Queue</button>
                  <button onClick={() => setStatusFilter("RISK")} className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold transition-all ${statusFilter === "RISK" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500"}`}>Breached</button>
                </div>
              </div>

              {/* ⚡ MOBILE SCROLLABLE TABLE Container */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200/60 font-sans w-full">
                <table className="w-full text-left border-collapse min-w-[650px]">
                  <thead className="bg-slate-50/70 font-mono text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200/60">
                    <tr>
                      <th className="py-3.5 pl-4 sm:pl-5">Agent</th>
                      <th className="py-3.5 px-3">Login Time</th>
                      <th className="py-3.5 px-3">Break Used</th>
                      <th className="py-3.5 px-3">Status</th>
                      <th className="py-3.5 text-right pr-4 sm:pr-5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                    {processedRoster.map(a => (
                      <SupervisoryLightRow 
                        key={a.id} 
                        agent={a} 
                        now={now} 
                        isRevoking={revoking === a.uid} 
                        onForceEnd={() => handleRevoke(a.uid || a.id)} 
                        onReject={() => handleRejectBreak(a.uid || a.id)} 
                        isRemoving={removing === (a.uid || a.id)} 
                        onRemoveAccount={() => handleRemoveAgent(a.uid || a.id, a.name)} 
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass lg:col-span-3 rounded-[28px] sm:rounded-[32px] p-5 sm:p-6 h-fit space-y-3.5 font-sans">
              <span className="text-xs font-bold text-slate-400 uppercase font-mono border-b border-slate-200/60 pb-2 flex items-center gap-2"><Shield size={13} className="text-indigo-600" /> Supervisors Online</span>
              {supervisorsOnline.map(sup => (
                <div key={sup.id} className="flex justify-between items-center bg-white/50 p-3 rounded-2xl border border-white/60 transition-all hover:bg-white/80 shadow-sm">
                  <span className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{sup.name}</span>
                  <span className="text-[10px] bg-white/90 px-2 py-0.5 rounded border font-mono font-bold text-indigo-700">{sup.workMode || "WFO"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "PROVISIONING" && <div className="max-w-xl mx-auto"><ProjectLightSpawningCard myProject={myProject} /></div>}
      </main>
      <footer className="relative z-10 py-8 text-center font-sans">
        <p className="text-xs font-bold text-slate-400 tracking-wide">
          Made with <span className="text-rose-500 inline-block animate-pulse">❤️</span> by <strong className="text-slate-600 font-black">Harshit Sinha</strong>
        </p>
      </footer>
    </div>
  );
}

function ProjectLightSpawningCard({ myProject }) {
  const [name, setName] = useState(""); 
  const [phone, setPhone] = useState(""); 
  const [busy, setBusy] = useState(false); 
  const [spawned, setSpawned] = useState(null);
  
  const handleOnboardAgent = async (e) => { 
    e.preventDefault(); 
    setBusy(true); 
    try { 
      const res = await httpsCallable(functions, "createUserAccount")({ name: name.trim(), role: "AGENT", phone: phone.trim(), project: myProject }); 
      setSpawned(res.data); 
      setName(""); 
      setPhone(""); 
    } catch(e) { 
      alert(e.message); 
    } finally { 
      setBusy(false); 
    } 
  };

  return (
    <div className="glass rounded-[32px] p-6 sm:p-8 space-y-5 animate-rise font-sans">
      <span className="text-xs font-bold text-indigo-600 uppercase font-mono border-b border-slate-200/60 pb-3 flex items-center gap-2"><UserPlus size={14} /> Add New Agent</span>
      <form onSubmit={handleOnboardAgent} className="space-y-4 font-mono">
        <div>
          <label className="block text-[11px] font-bold text-slate-400 mb-1 font-sans">Full Name</label>
          <input type="text" required value={name} onChange={e => setName(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs text-slate-900 font-bold outline-none font-sans" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-400 mb-1 font-sans">WhatsApp Routing</label>
          <input type="text" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91..." className="input-glass w-full rounded-2xl p-3.5 text-xs text-slate-900 font-bold outline-none font-sans" />
        </div>
        <button type="submit" disabled={busy} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase tracking-wider cursor-pointer font-sans shadow-md active:scale-95">
          {busy ? "Creating..." : "Create Account"}
        </button>
      </form>
      {spawned && (
        <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-2xl font-mono text-xs space-y-1.5 animate-rise shadow-sm">
          <div className="font-bold text-emerald-800 mb-1">✓ Account Created</div>
          <div>ID: <strong className="text-indigo-600">{spawned.employeeId}</strong></div>
          <div>Pass: <strong className="text-emerald-700">{spawned.password}</strong></div>
        </div>
      )}
    </div>
  );
}

function SupervisoryLightRow({ agent, now, isRevoking, onForceEnd, onReject, isRemoving, onRemoveAccount }) {
  const bm = useBreakManagement(agent);
  const isOnline = agent.isOnline; 
  const hasShift = !!agent.activeShiftId; 
  
  const isOnBreak = agent.status === "ON_BREAK"; 
  const isBreached = agent.status === "BREAK_EXCEEDED"; 
  const isPrompted = agent.status === "NOTIFIED_TO_START"; 
  const isInQueue = agent.status === "IN_QUEUE" || agent.status === "AWAITING_SLOT" || bm.activeBreak?.status === "APPROVED_SCHEDULED";
  
  const sMs = toMillis(bm.shift?.shiftStart); 
  const elMs = sMs ? Math.max(0, now - sMs) : 0;
  const sHrs = String(Math.floor(elMs / 3600000)).padStart(2, "0"); 
  const sMins = String(Math.floor((elMs % 3600000) / 60000)).padStart(2, "0"); 
  const sSecs = String(Math.floor((elMs % 60000) / 1000)).padStart(2, "0");
  
  const mTot = bm.budget?.mealTotal ?? 40; 
  const sTot = bm.budget?.shortTotal ?? 20; 
  const mLeft = bm.budget?.mealRemaining ?? mTot; 
  const sLeft = bm.budget?.shortRemaining ?? sTot; 
  const totUsed = mTot - mLeft + (sTot - sLeft);

  const [disp, setDisp] = useState(false);
  const [showForceLogoutModal, setShowForceLogoutModal] = useState(false);

  const handleAssign = async () => { 
    setDisp(true); 
    try { 
      await httpsCallable(functions, "requestBreakNow")({ category: "SHORT", minutesNow: Math.min(15, sLeft || 15), targetUid: agent.uid || agent.id }); 
    } catch (e) { 
      alert(e.message); 
    } finally { 
      setDisp(false); 
    } 
  };
  
  const handleExecuteManualLogout = async () => {
    setDisp(true);
    try {
      await httpsCallable(functions, "supervisorForceEndShift")({ targetUid: agent.uid || agent.id });
      setShowForceLogoutModal(false);
    } catch(e) { 
      alert(e.message); 
    } finally { 
      setDisp(false); 
    }
  };

  // ⚡ DYNAMIC DETAILED BREAK TEXT (Requirements #2 and #3)
  let displayStatus = "Offline"; 
  let badgeColor = "bg-white/50 border-slate-200 text-slate-400"; 
  let brkStr = "—";

  if (isOnBreak || isBreached) {
    displayStatus = isBreached ? "Over Limit" : "On Break";
    badgeColor = isBreached ? "bg-rose-50/90 border-rose-200 text-rose-700 animate-ping font-black" : "bg-amber-50/90 border-amber-200 text-amber-700 animate-pulse font-bold";
    const bStart = toMillis(bm.activeBreak?.breakStartedAt) || now; 
    const bEl = Math.max(0, now - bStart);
    const mm = String(Math.floor(bEl / 60000)).padStart(2, "0"); 
    const ss = String(Math.floor((bEl % 60000) / 1000)).padStart(2, "0"); 
    brkStr = `${bm.activeBreak?.breakCategory || "Break"} · ${mm}:${ss}`;
  } else if (isPrompted) {
    displayStatus = "Ready (3m)"; 
    badgeColor = "bg-fuchsia-50/90 border-fuchsia-200 text-fuchsia-700 font-bold animate-pulse";
    brkStr = `Prompted ${bm.activeBreak?.breakCategory || ""}`;
  } else if (isInQueue) {
    const b = bm.activeBreak;
    if (b?.status === "APPROVED_SCHEDULED" && b.scheduledFor) {
      displayStatus = "Scheduled"; 
      badgeColor = "bg-cyan-50 border-cyan-200 text-cyan-700 font-bold";
      const timeStr = new Date(toMillis(b.scheduledFor)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      brkStr = `${b.breakCategory} @ ${timeStr}`;
    } else if (b) {
      displayStatus = "In Queue"; 
      badgeColor = "bg-indigo-50/90 border-indigo-200 text-indigo-700 font-bold";
      const reqTime = b.requestedAt ? new Date(toMillis(b.requestedAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      brkStr = `Queued ${b.breakCategory} ${reqTime ? '('+reqTime+')' : ''}`;
    } else {
      displayStatus = "In Queue"; 
      badgeColor = "bg-indigo-50/90 border-indigo-200 text-indigo-700 font-bold";
      brkStr = "Queued";
    }
  } else if (isOnline && hasShift) { 
    displayStatus = "Available"; 
    badgeColor = "bg-emerald-50/90 border-emerald-200 text-emerald-700 font-bold"; 
  } else if (isOnline && !hasShift) { 
    displayStatus = "Pre-Shift"; 
    badgeColor = "bg-blue-50 border-blue-200 text-blue-600 font-bold"; 
  }

  return (
    <>
    <tr className={`hover:bg-indigo-50/30 font-sans transition-colors border-b border-slate-100 last:border-0 ${isBreached ? "bg-rose-50/60 font-sans" : ""}`}>
      <td className="py-4 pl-4 sm:pl-5">
        <p className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
          <span>{agent.name}</span> 
          {hasShift && <span className="bg-purple-100 border border-purple-200 text-purple-800 font-mono font-bold text-[9px] px-1.5 py-0.5 rounded shadow-sm">{agent.workMode || "WFO"}</span>}
        </p>
        <span className="font-mono text-[11px] text-slate-400 font-medium block mt-0.5">{agent.employeeId}</span>
      </td>
      <td className="py-4 px-3 font-mono">
        <span className="bg-white/70 border border-slate-200/80 px-2.5 py-1 rounded-md text-xs font-mono font-bold tabular-nums text-slate-800 tracking-tight inline-block shadow-sm">
          {hasShift && sMs ? `${sHrs}:${sMins}:${sSecs}` : "Not Clocked In"}
        </span>
      </td>
      <td className="py-4 px-3 font-sans">
        <span className="text-slate-700 text-xs font-mono font-bold">{totUsed}m Used</span>
      </td>
      <td className="py-4 px-3 font-mono">
        <span className={`px-2 py-0.5 rounded-md border text-[10px] uppercase ${badgeColor}`}>{displayStatus}</span>
        <p className="text-[10px] text-slate-500 mt-1.5 font-mono font-bold">{brkStr}</p>
      </td>
      <td className="py-4 text-right pr-4 sm:pr-5 font-sans">
        <div className="flex items-center justify-end gap-1 sm:gap-1.5">
          {isOnline && hasShift && agent.status === "AVAILABLE" && (
            <button onClick={handleAssign} disabled={disp} className="btn-soft rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer">
              {disp ? "..." : "Assign"}
            </button>
          )}
          {isInQueue && (
            <button onClick={onReject} disabled={isRevoking} className="btn-soft px-2.5 sm:px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer shadow-sm active:scale-95 transition-all">
              {isRevoking ? "..." : "Reject"}
            </button>
          )}
          {(isOnBreak || isBreached) && (
            <button onClick={onForceEnd} disabled={isRevoking} className="btn-glass px-2.5 sm:px-3 py-1.5 text-xs font-black cursor-pointer shadow-sm active:scale-95 transition-all">
              {isRevoking ? "..." : "Recall"}
            </button>
          )}
          {hasShift && (
            <button onClick={() => setShowForceLogoutModal(true)} disabled={disp} className="btn-soft px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer">
              <LogOut size={13}/>
            </button>
          )}
          <button disabled={isRemoving} onClick={onRemoveAccount} className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg transition-colors cursor-pointer">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>

    {/* ⚡ MANUAL LOGOUT WARNING MODAL */}
    {showForceLogoutModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in font-sans">
        <div className="glass w-full max-w-md rounded-[32px] p-8 text-center space-y-6 animate-rise shadow-2xl bg-white/95">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 shadow-inner">
            <LogOut size={28} />
          </div>
          <div className="space-y-2 text-left">
            <h3 className="text-xl font-black text-slate-900 tracking-tight text-center">Logout {agent.name}?</h3>
            {!bm.isShiftSlaMet ? (
              <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 mt-3 shadow-sm animate-pulse">
                <p className="text-xs font-bold text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14}/> Warning: 9 Hours Not Complete</p>
                <p className="text-xs text-rose-600/90 mt-1 leading-relaxed">Agent has not fulfilled their mandatory 9 hours. Do you still want to forcefully logout and save today's captured report?</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500 font-medium text-center">Agent shift SLA completed. Proceed with force sign-out?</p>
            )}
          </div>
          <div className="flex gap-3 pt-2 font-sans">
            <button onClick={handleExecuteManualLogout} disabled={disp} className="flex-1 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-black py-4 rounded-2xl text-xs uppercase shadow-md cursor-pointer transition-all active:scale-95 disabled:opacity-50">
              {disp ? "Processing..." : "Yes, Logout Agent"}
            </button>
            <button onClick={() => setShowForceLogoutModal(false)} disabled={disp} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl text-xs uppercase transition-all cursor-pointer disabled:opacity-50">
              No, Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}