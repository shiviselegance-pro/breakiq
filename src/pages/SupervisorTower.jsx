import React, { useState, useEffect, useMemo } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useFloorData } from "../hooks/useFloorData";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import { useBreakManagement } from "../hooks/useBreakManagement";
import { toMillis, formatClock } from "../utils/timeHelpers";
import { downloadMonthlyBreakReport } from "../utils/exportReport";
import { Activity, Users, AlertTriangle, LogOut, Download, Loader2, WifiOff, Search, Shield, UserPlus, Trash2 } from "lucide-react";

export default function SupervisorTower() {
  const { profile, logout } = useAuth();
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
  
  // ⚡ NUCLEAR FLUSH STATE
  const [flushing, setFlushing] = useState(false);

  const myProject = (profile?.project || "GENERAL").trim().toUpperCase();
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const max = settings.maxConcurrentBreaks || 2;
  const onlineAgentIds = new Set(agentsOnline.map(a => a.id || a.uid));
  const isFloorFrozen = settings?.emergencyLockout;

  const handleToggleLockdown = async () => {
    const action = isFloorFrozen ? "Lift Outage Lockdown" : "Trigger Emergency Floor Pause";
    const reason = isFloorFrozen ? null : prompt("Enter Outage Memo:", "P1 Server Down - Hold SLA Lines");
    if (!isFloorFrozen && !reason) return; if (!confirm(`Are you sure you want to ${action}?`)) return;
    setTogglingOutage(true);
    try { await httpsCallable(functions, "toggleEmergencyLockout")({ locked: !isFloorFrozen, reason }); } 
    catch (e) { alert(e.message); } finally { setTogglingOutage(false); }
  };

  const handleRevoke = async (uid) => {
    if (!confirm("Force recall agent and release slot?")) return; setRevoking(uid);
    try { await httpsCallable(functions, "adminForceEndBreak")({ targetUid: uid }); } 
    catch (e) { alert(e.message); } finally { setRevoking(null); }
  };

  const handleRemoveAgent = async (uid, agentName) => {
    if (!confirm(`Permanently deprovision ${agentName}?`)) return; setRemoving(uid);
    try { await httpsCallable(functions, "deleteUserAccount")({ targetUid: uid }); } 
    catch (e) { alert(e.message); } finally { setRemoving(null); }
  };

  // ⚡ INDIVIDUAL REJECT FUNCTION
  const handleRejectBreak = async (uid) => {
    if (!confirm("Reject this pending break request?")) return;
    setRevoking(uid);
    try { await httpsCallable(functions, "cancelScheduledBreak")({ targetUid: uid }); }
    catch (e) { alert(e.message); } finally { setRevoking(null); }
  };

  // ⚡ FLUSH GHOST QUEUE
  const handleFlushQueue = async () => {
    if (!confirm(`NUCLEAR OPTION: Clear all ${pendingBreaks.length} pending/ghost breaks from the pipeline?`)) return;
    setFlushing(true);
    try { await httpsCallable(functions, "flushGhostQueue")({ project: myProject }); }
    catch (e) { alert(e.message); } finally { setFlushing(false); }
  };

  const myProjectAgents = useMemo(() => agents.filter(a => (a.project || "GENERAL").toUpperCase() === myProject), [agents, myProject]);
  const activeProjectBreaks = useMemo(() => activeBreaks.filter(b => (b.project || "GENERAL").toUpperCase() === myProject), [activeBreaks, myProject]);
  const exceededProjectBreaks = useMemo(() => activeProjectBreaks.filter(b => b.exceeded), [activeProjectBreaks]);

  const processedRoster = useMemo(() => {
    return myProjectAgents
      .map(a => ({ ...a, isOnline: onlineAgentIds.has(a.uid || a.id) }))
      .filter(a => {
        const m = a.name?.toLowerCase().includes(searchQuery.toLowerCase()) || a.employeeId?.toLowerCase().includes(searchQuery.toLowerCase());
        if (!m) return false;
        if (statusFilter === "ONLINE") return a.isOnline;
        if (statusFilter === "ON_BREAK") return a.status === "ON_BREAK";
        if (statusFilter === "AVAILABLE") return a.status === "AVAILABLE" && a.isOnline;
        if (statusFilter === "RISK") return a.status === "BREAK_EXCEEDED" || a.status === "ON_BREAK";
        if (statusFilter === "QUEUE") return a.status === "IN_QUEUE" || a.status === "AWAITING_SLOT";
        return true;
      }).sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0));
  }, [myProjectAgents, onlineAgentIds, searchQuery, statusFilter]);

  return (
    <div className="relative min-h-screen text-slate-800 font-sans pb-24 selection:bg-indigo-500 selection:text-white">
      <div className="mesh-bg" />

      <header className="glass-bar sticky top-0 z-40 px-6 py-4 font-sans">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white font-black text-sm shadow-md font-mono">TL</div><div><div className="flex items-center gap-2"><h1 className="text-sm font-black uppercase text-slate-900">Supervisor Tower</h1><span className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-600 font-mono">{myProject}</span><span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[9px] font-mono font-bold text-amber-700">{profile?.workMode || "WFO"}</span></div><p className="text-xs text-slate-500 mt-0.5">Commander: <strong className="text-slate-700">{profile?.name}</strong> · Peer Leads Online: <strong className="text-indigo-600">{supervisorsOnline.length}</strong></p></div></div>
          <div className="flex items-center gap-2.5 font-mono"><button onClick={handleToggleLockdown} disabled={togglingOutage} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold uppercase cursor-pointer transition-all ${isFloorFrozen ? "bg-rose-600 text-white shadow-lg font-sans animate-pulse" : "btn-soft text-amber-700 font-sans"}`}>{togglingOutage ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />} <span>{isFloorFrozen ? "🚨 Outage Active (Lift)" : "Pause Breaks (Outage)"}</span></button><button onClick={() => { setReportBusy(true); const d = new Date(); downloadMonthlyBreakReport(d.getFullYear(), d.getMonth() + 1).finally(() => setReportBusy(false)); }} disabled={reportBusy} className="btn-soft flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 cursor-pointer font-sans">{reportBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} <span>Export Reports</span></button><button onClick={logout} className="btn-soft flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-rose-600 cursor-pointer font-sans"><LogOut size={13} /> Logout</button></div>
        </div>
      </header>

      <div className="glass-bar relative z-10 py-3 px-6 font-sans">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs font-mono font-bold">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setActiveTab("MONITORING")} className={`px-4 py-2 rounded-xl cursor-pointer transition-all font-sans ${activeTab === "MONITORING" ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25" : "btn-soft text-slate-500"}`}>⚡ Floor Command ({myProjectAgents.length})</button>
            <button onClick={() => setActiveTab("PROVISIONING")} className={`px-4 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 transition-all font-sans ${activeTab === "PROVISIONING" ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25" : "btn-soft text-slate-500"}`}><UserPlus size={14} /> Onboard Agents</button>
          </div>
          <span className="text-slate-400 font-sans">Tenant Lock: <strong className="text-emerald-600 font-bold font-mono">{myProject} ONLY</strong></span>
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-6 mt-8 space-y-8 animate-rise font-sans">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 font-mono">
          <div className="glass rounded-[28px] p-5 text-indigo-600"><span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Fenced Departures</span><div className="font-mono text-3xl font-black text-slate-900">{activeProjectBreaks.length}/{max}</div></div>
          <div className="glass rounded-[28px] p-5 text-slate-700"><span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Enrolled Staff</span><div className="font-mono text-3xl font-black text-slate-900">{myProjectAgents.length}</div></div>
          
          {/* ⚡ THE FLUSHABLE FIFO PIPELINE CARD */}
          <div className="glass rounded-[28px] p-5 text-slate-700 relative group transition-all">
            <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">FIFO Pipeline</span>
            <div className="font-mono text-3xl font-black text-slate-900">{pendingBreaks.length}</div>
            {pendingBreaks.length > 0 && (
              <button onClick={handleFlushQueue} disabled={flushing} className="absolute top-4 right-4 bg-rose-100 text-rose-700 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest shadow-sm hover:bg-rose-200 opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                {flushing ? "..." : "Flush Queue"}
              </button>
            )}
          </div>
          
          <div className="glass rounded-[28px] p-5 text-rose-700"><span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">SLA Breaches</span><div className="font-mono text-3xl font-black text-slate-900">{exceededProjectBreaks.length}</div></div>
        </div>

        {activeTab === "MONITORING" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 font-sans">
            <div className="glass lg:col-span-9 rounded-[32px] p-7 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-200/80 pb-5 font-mono">
                <div className="relative w-80"><Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={`Search ${myProject} agents...`} className="input-glass w-full rounded-xl py-2 pl-9 pr-4 text-xs font-bold text-slate-800 outline-none font-sans" /></div>
                <div className="flex gap-1 bg-white/40 p-1 rounded-xl border border-white/60 text-xs">
                  <button onClick={() => setStatusFilter("ALL")} className={`px-3 py-1 rounded-lg font-bold transition-all ${statusFilter === "ALL" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>All</button>
                  <button onClick={() => setStatusFilter("ON_BREAK")} className={`px-3 py-1 rounded-lg font-bold transition-all ${statusFilter === "ON_BREAK" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>On Break</button>
                  <button onClick={() => setStatusFilter("QUEUE")} className={`px-3 py-1 rounded-lg font-bold transition-all ${statusFilter === "QUEUE" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>In Queue</button>
                  <button onClick={() => setStatusFilter("RISK")} className={`px-3 py-1 rounded-lg font-bold transition-all ${statusFilter === "RISK" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>Breached</button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200/60 font-sans">
                <table className="w-full text-left border-collapse"><thead className="bg-slate-50/50 font-mono text-[10px] font-bold uppercase text-slate-500"><tr><th className="py-4 pl-5">Agent</th><th className="py-4 px-3">Stopwatch</th><th className="py-4 px-3">Burn Quota</th><th className="py-4 px-3">Status</th><th className="py-4 text-right pr-5">Overrides</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                    {processedRoster.map(a => <SupervisoryLightRow key={a.id} agent={a} now={now} isRevoking={revoking === a.uid} onForceEnd={() => handleRevoke(a.uid || a.id)} onReject={() => handleRejectBreak(a.uid || a.id)} isRemoving={removing === (a.uid || a.id)} onRemoveAccount={() => handleRemoveAgent(a.uid || a.id, a.name)} />)}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass lg:col-span-3 rounded-[32px] p-6 h-fit space-y-4 font-sans">
              <span className="text-xs font-bold text-slate-400 uppercase font-mono block border-b border-slate-200/60 pb-2 flex items-center gap-2"><Shield size={13} className="text-indigo-600" /> TLs on Duty</span>
              {supervisorsOnline.map(sup => (
                <div key={sup.id} className="flex justify-between items-center bg-white/40 p-3 rounded-2xl border border-white/60 transition-all hover:bg-white/80"><span className="text-xs font-bold text-slate-900">{sup.name}</span><span className="text-[10px] bg-white/80 px-2 py-0.5 rounded border font-mono font-bold text-indigo-700">{sup.workMode || "WFO"}</span></div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "PROVISIONING" && <div className="max-w-xl mx-auto"><ProjectLightSpawningCard myProject={myProject} /></div>}
      </main>
      <footer className="relative z-10 py-6 text-center font-sans"><p className="text-xs font-bold text-slate-400 tracking-wide">Made with <span className="text-rose-500 inline-block animate-pulse">❤️</span> by <strong className="text-slate-600 font-black">Harshit Sinha</strong></p></footer>
    </div>
  );
}

function ProjectLightSpawningCard({ myProject }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [busy, setBusy] = useState(false); const [spawned, setSpawned] = useState(null);
  const handleOnboardAgent = async (e) => { e.preventDefault(); setBusy(true); try { const res = await httpsCallable(functions, "createUserAccount")({ name: name.trim(), role: "AGENT", phone: phone.trim(), project: myProject }); setSpawned(res.data); setName(""); setPhone(""); } catch(e) { alert(e.message); } finally { setBusy(false); } };

  return (
    <div className="glass rounded-[32px] p-8 space-y-5 animate-rise font-sans">
      <span className="text-xs font-bold text-indigo-600 uppercase font-mono block border-b border-slate-200/60 pb-3 flex items-center gap-2"><UserPlus size={14} /> Onboard Shift Agent</span>
      <form onSubmit={handleOnboardAgent} className="space-y-4 font-mono"><div><label className="block text-[11px] font-bold text-slate-400 mb-1 font-sans">Full Display Name</label><input type="text" required value={name} onChange={e => setName(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs text-slate-900 font-bold outline-none font-sans" /></div><div><label className="block text-[11px] font-bold text-slate-400 mb-1 font-sans">WhatsApp Routing</label><input type="text" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91..." className="input-glass w-full rounded-2xl p-3.5 text-xs text-slate-900 font-bold outline-none font-sans" /></div><button type="submit" disabled={busy} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase tracking-wider cursor-pointer font-sans">{busy ? "Deploying..." : "Provision Agent Account"}</button></form>
      {spawned && <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl font-mono text-xs space-y-1.5 animate-rise"><div className="font-bold text-emerald-800 mb-1">✓ Account Created</div><div>ID: <strong className="text-indigo-600">{spawned.employeeId}</strong></div><div>Password: <strong className="text-emerald-700">{spawned.password}</strong></div></div>}
    </div>
  );
}

function SupervisoryLightRow({ agent, now, isRevoking, onForceEnd, onReject, isRemoving, onRemoveAccount }) {
  const bm = useBreakManagement(agent);
  const isOnline = agent.isOnline; const isOnBreak = agent.status === "ON_BREAK"; const isBreached = agent.status === "BREAK_EXCEEDED"; const isInQueue = agent.status === "IN_QUEUE" || agent.status === "AWAITING_SLOT" || bm.activeBreak?.status === "APPROVED_SCHEDULED";
  const sMs = toMillis(bm.shift?.shiftStart); const elMs = sMs ? Math.max(0, now - sMs) : 0;
  const sHrs = String(Math.floor(elMs / 3600000)).padStart(2, "0"); const sMins = String(Math.floor((elMs % 3600000) / 60000)).padStart(2, "0"); const sSecs = String(Math.floor((elMs % 60000) / 1000)).padStart(2, "0");
  const mTot = bm.budget?.mealTotal ?? 40; const sTot = bm.budget?.shortTotal ?? 20; const mLeft = bm.budget?.mealRemaining ?? mTot; const sLeft = bm.budget?.shortRemaining ?? sTot; const totUsed = mTot - mLeft + (sTot - sLeft);

  let brkStr = "—";
  if (isOnBreak || isBreached) {
    const bStart = toMillis(bm.activeBreak?.breakStartedAt) || now; const bEl = Math.max(0, now - bStart);
    const mm = String(Math.floor(bEl / 60000)).padStart(2, "0"); const ss = String(Math.floor((bEl % 60000) / 1000)).padStart(2, "0"); brkStr = `${bm.activeBreak?.breakCategory || "Break"} · ${mm}:${ss}`;
  } else if (isInQueue) brkStr = "Queued in FIFO";

  const [disp, setDisp] = useState(false);
  const handleAssign = async () => { setDisp(true); try { await httpsCallable(functions, "requestBreakNow")({ category: "SHORT", minutesNow: Math.min(15, sLeft || 15), targetUid: agent.uid || agent.id }); } catch (e) { alert(e.message); } finally { setDisp(false); } };

  return (
    <tr className={`hover:bg-indigo-50/30 font-sans transition-colors border-b border-slate-100 last:border-0 ${isBreached ? "bg-rose-50/60 font-sans" : ""}`}>
      <td className="py-4 pl-5"><p className="font-bold text-slate-900 text-xs flex items-center gap-1.5"><span>{agent.name}</span> <span className="bg-purple-100 border border-purple-200 text-purple-800 font-mono font-bold text-[9px] px-1.5 py-0.5 rounded shadow-sm">{agent.workMode || "WFO"}</span></p><span className="font-mono text-[11px] text-slate-400 font-medium block mt-0.5">{agent.employeeId}</span></td>
      <td className="py-4 px-3 font-mono"><span className="bg-white/60 border border-slate-200/70 px-2.5 py-1 rounded-md text-xs font-mono font-bold tabular-nums text-slate-800 tracking-tight inline-block">{sMs ? `${sHrs}:${sMins}:${sSecs}` : "OFFLINE"}</span></td>
      <td className="py-4 px-3 font-sans"><span className="text-slate-700 text-xs font-mono font-bold">{totUsed}m Used</span></td>
      <td className="py-4 px-3 font-mono"><span className={`px-2 py-0.5 rounded-md border text-[10px] uppercase font-bold ${isOnBreak ? "bg-amber-50/80 border-amber-200 text-amber-700 animate-pulse" : isBreached ? "bg-rose-50/80 border-rose-200 text-rose-700 animate-ping" : isInQueue ? "bg-indigo-50/80 border-indigo-200 text-indigo-700" : isOnline ? "bg-emerald-50/80 border-emerald-200 text-emerald-700" : "bg-white/50 border-slate-200 text-slate-400"}`}>{isOnBreak ? "On Break" : isBreached ? "Over Limit" : isInQueue ? "In Queue" : isOnline ? "Available" : "Offline"}</span><p className="text-[10px] text-slate-400 mt-1 font-mono">{brkStr}</p></td>
      <td className="py-4 text-right pr-5 font-sans">
        <div className="flex items-center justify-end gap-1.5">
          {isOnline && agent.status === "AVAILABLE" && <button onClick={handleAssign} disabled={disp} className="btn-soft rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 cursor-pointer font-sans">{disp ? "..." : "Assign"}</button>}
          
          {/* ⚡ NEW: Reject Queued Break */}
          {isInQueue && <button onClick={onReject} disabled={isRevoking} className="btn-soft px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer shadow-sm active:scale-95 transition-all font-sans">{isRevoking ? "..." : "Reject"}</button>}
          
          {(isOnBreak || isBreached) && <button onClick={onForceEnd} disabled={isRevoking} className="btn-glass px-3 py-1.5 text-xs font-black cursor-pointer shadow-sm active:scale-95 transition-all font-sans">{isRevoking ? "..." : "Recall"}</button>}
          <button disabled={isRemoving} onClick={onRemoveAccount} className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg transition-colors cursor-pointer font-sans"><Trash2 size={13} /></button>
        </div>
      </td>
    </tr>
  );
}