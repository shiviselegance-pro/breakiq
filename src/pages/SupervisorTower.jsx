// src/pages/SupervisorTower.jsx
import React, { useState, useEffect, useMemo } from "react";
import { 
  Activity, Users, AlertTriangle, LogOut, Download, Ban, 
  Loader2, Zap, Clock, WifiOff, Search, Shield, UserCheck, UserPlus, Copy, CheckCircle2, Trash2 
} from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useFloorData } from "../hooks/useFloorData";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import { useBreakManagement } from "../hooks/useBreakManagement";
import { toMillis, formatClock } from "../utils/timeHelpers";
import { downloadMonthlyBreakReport } from "../utils/exportReport";

export default function SupervisorTower() {
  const { profile, logout } = useAuth();
  useHeartbeat(profile?.uid, profile?.name, profile?.role);

  const supervisorsOnline = useOnlineRoster("SUPERVISOR");
  const agentsOnline = useOnlineRoster("AGENT");
  const { settings, agents, activeBreaks, pendingBreaks } = useFloorData();

  // ⚡ 2-IN-1 VIEW STATE: "MONITORING" (Floor Command) vs "PROVISIONING" (Add Agents)
  const [activeTab, setActiveTab] = useState("MONITORING");

  const [now, setNow] = useState(Date.now());
  const [revoking, setRevoking] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [togglingOutage, setTogglingOutage] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const myProject = (profile?.project || "GENERAL").trim().toUpperCase();

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const max = settings.maxConcurrentBreaks;
  const onlineAgentIds = new Set(agentsOnline.map((a) => a.id));
  const isFloorFrozen = settings?.emergencyLockout;

  const handleToggleLockdown = async () => {
    const action = isFloorFrozen ? "Resume all floor breaks" : "Pause all break requests for an Outage";
    const reason = isFloorFrozen ? null : prompt("Enter Outage Reason (e.g., 'P1 Server Down - Keep agents on line'):", "P1 Server Down - Keep agents on line");
    if (!isFloorFrozen && !reason) return; if (!confirm(`Are you sure you want to ${action}?`)) return;

    setTogglingOutage(true);
    try { await httpsCallable(functions, "toggleEmergencyLockout")({ locked: !isFloorFrozen, reason }); } 
    catch (e) { alert("Action rejected: " + e.message); } finally { setTogglingOutage(false); }
  };

  const handleRevoke = async (uid) => {
    if (!confirm("End this agent's break and mark them available?")) return;
    setRevoking(uid);
    try { await httpsCallable(functions, "adminForceEndBreak")({ targetUid: uid }); }
    catch (e) { alert("Failed: " + e.message); } finally { setRevoking(null); }
  };

  const handleRemoveAgent = async (uid, agentName) => {
    if (!confirm(`🚨 NUCLEAR REMOVAL: Permanently purge ${agentName} from ${myProject} Project Directory? This cannot be undone.`)) return;
    setRemoving(uid);
    try { await httpsCallable(functions, "deleteUserAccount")({ targetUid: uid }); } 
    catch (e) { alert("Removal rejected: " + e.message); } finally { setRemoving(null); }
  };

  const handleReport = async () => {
    setReportBusy(true);
    try { const d = new Date(); await downloadMonthlyBreakReport(d.getFullYear(), d.getMonth() + 1); }
    finally { setReportBusy(false); }
  };

  // ⚡ HARD FENCING: Strictly filter roster for agents matching Supervisor's assigned project!
  const myProjectAgents = useMemo(() => {
    return agents.filter(a => (a.project || "GENERAL").trim().toUpperCase() === myProject);
  }, [agents, myProject]);

  const activeProjectBreaks = useMemo(() => {
    return activeBreaks.filter(b => (b.project || "GENERAL").trim().toUpperCase() === myProject);
  }, [activeBreaks, myProject]);

  const exceededProjectBreaks = useMemo(() => activeProjectBreaks.filter(b => b.exceeded), [activeProjectBreaks]);

  const processedRoster = useMemo(() => {
    return myProjectAgents
      .map((a) => ({ ...a, isOnline: onlineAgentIds.has(a.uid || a.id) }))
      .filter((a) => {
        const match = a.name?.toLowerCase().includes(searchQuery.toLowerCase()) || a.employeeId?.toLowerCase().includes(searchQuery.toLowerCase());
        if (!match) return false;
        if (statusFilter === "ONLINE") return a.isOnline;
        if (statusFilter === "ON_BREAK") return a.status === "ON_BREAK";
        if (statusFilter === "AVAILABLE") return a.status === "AVAILABLE" && a.isOnline;
        if (statusFilter === "RISK") return a.status === "BREAK_EXCEEDED" || a.status === "ON_BREAK";
        return true;
      })
      .sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0));
  }, [myProjectAgents, onlineAgentIds, searchQuery, statusFilter]);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 font-sans pb-24 selection:bg-indigo-500 selection:text-white">
      
      {/* Professional Project-Fenced Topbar */}
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-[#09090b]/90 backdrop-blur-md px-6 py-4 transition-all">
        <div className="mx-auto flex max-w-7xl items-center justify-between font-sans">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold text-sm shadow-md font-mono">
              TL
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-wide uppercase text-white font-sans">Supervisor Portal</h1>
                <span className="rounded bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-400/20 font-mono tracking-wider">
                  PROJECT: {myProject}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 font-sans">
                Team Lead: <strong className="text-zinc-200">{profile?.name}</strong> · Peer Leads Online: <strong className="text-indigo-400">{supervisorsOnline.length}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 font-mono">
            <button 
              onClick={() => handleToggleLockdown()} disabled={togglingOutage}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer font-sans ${
                isFloorFrozen ? "bg-rose-600 hover:bg-rose-500 text-white animate-pulse ring-2 ring-rose-400" : "bg-amber-500/10 hover:bg-amber-500 hover:text-zinc-950 text-amber-400 border border-amber-500/30 font-mono"
              }`}
            >
              {togglingOutage ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
              <span>{isFloorFrozen ? "🚨 Outage Active (Resume)" : "Pause Breaks (Outage)"}</span>
            </button>

            <button 
              onClick={() => handleReport()} disabled={reportBusy}
              className="flex items-center gap-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-200 transition-all active:scale-95 disabled:opacity-50 cursor-pointer font-sans"
            >
              {reportBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>{reportBusy ? "Exporting..." : "Download Reports"}</span>
            </button>

            <button 
              onClick={() => logout()}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all active:scale-95 cursor-pointer font-sans"
            >
              <LogOut size={13} /> Log Out
            </button>
          </div>
        </div>
      </header>

      {/* ⚡ 2-IN-1 VIEW SWITCHER TABS */}
      <div className="border-b border-zinc-800/60 bg-zinc-950/60 py-3 px-6 font-sans">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-xs">
            <button 
              onClick={() => setActiveTab("MONITORING")} 
              className={`px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                activeTab === "MONITORING" ? "bg-indigo-600 text-white shadow-md" : "text-zinc-400 hover:text-white bg-zinc-900/60 border border-zinc-800"
              }`}
            >
              ⚡ Floor Command ({myProjectAgents.length} Staff)
            </button>
            <button 
              onClick={() => setActiveTab("PROVISIONING")} 
              className={`px-4 py-2 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "PROVISIONING" ? "bg-indigo-600 text-white shadow-md" : "text-zinc-400 hover:text-white bg-zinc-900/60 border border-zinc-800"
              }`}
            >
              <UserPlus size={14} /> Add {myProject} Agents
            </button>
          </div>

          <span className="text-xs font-mono text-zinc-400">Strict Tenant Fence: <strong className="text-emerald-400 font-bold">LOCKED TO {myProject}</strong></span>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 mt-8 space-y-8 font-sans">
        
        {/* Metric Cards Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 font-mono">
          <TowerMetricCard Icon={Activity} label={`${myProject} Breaks`} value={`${activeProjectBreaks.length}/${max}`} sub={`Floor Limit: ${max} concurrent`} tone={activeProjectBreaks.length >= max ? "rose" : "indigo"} />
          <TowerMetricCard Icon={Users} label={`${myProject} Enrolled Staff`} value={myProjectAgents.length} sub="Inside Project Fence" tone="zinc" />
          <TowerMetricCard Icon={Clock} label="Global Waiters" value={pendingBreaks.length} sub="Queued across BPO" tone={pendingBreaks.length > 0 ? "amber" : "zinc"} />
          <TowerMetricCard Icon={AlertTriangle} label={`${myProject} Overruns`} value={exceededProjectBreaks.length} sub="Requires recall action" tone={exceededProjectBreaks.length > 0 ? "rose" : "zinc"} />
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: FLOOR COMMAND (MONITORING) */}
        {/* ========================================================================= */}
        {activeTab === "MONITORING" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 font-sans animate-in fade-in duration-300">
            
            {/* Left Column (9 slots): Fenced Agent Roster Table */}
            <div className="lg:col-span-9 space-y-6">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-7 shadow-xl space-y-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-zinc-800 pb-6">
                  <div className="relative flex-1 sm:w-80 font-mono">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={`Search ${myProject} agents...`}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pl-9 pr-4 text-xs font-medium text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-sans"
                    />
                  </div>

                  <div className="flex items-center gap-1 overflow-x-auto bg-zinc-950 p-1.5 rounded-xl border border-zinc-800 font-mono text-xs">
                    <FilterPill active={statusFilter === "ALL"} onClick={() => setStatusFilter("ALL")} label={`All (${myProjectAgents.length})`} />
                    <FilterPill active={statusFilter === "ONLINE"} onClick={() => setStatusFilter("ONLINE")} label="Online" color="indigo" />
                    <FilterPill active={statusFilter === "ON_BREAK"} onClick={() => setStatusFilter("ON_BREAK")} label={`On Break (${activeProjectBreaks.length})`} color="amber" />
                    <FilterPill active={statusFilter === "RISK"} onClick={() => setStatusFilter("RISK")} label={`Over Limit (${exceededProjectBreaks.length})`} color="rose" />
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/60 shadow-inner font-sans">
                  <table className="w-full text-left border-collapse">
                    <thead className="border-b border-zinc-800 bg-zinc-900/60 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      <tr>
                        <th className="py-4 pl-5 pr-3">Shift Agent</th>
                        <th className="py-4 px-3">Shift Elapsed</th>
                        <th className="py-4 px-3">Break Usage</th>
                        <th className="py-4 px-3">Status</th>
                        <th className="py-4 pl-3 pr-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 text-xs font-medium text-zinc-300">
                      {processedRoster.length === 0 ? (
                        <tr><td colSpan={5} className="py-16 text-center font-mono text-zinc-600">No project agents match your active search filters.</td></tr>
                      ) : (
                        processedRoster.map((agent) => (
                          <SupervisoryAgentRow 
                            key={agent.id} agent={agent} settings={settings} now={now} 
                            isRevoking={revoking === agent.uid} onForceEnd={() => handleRevoke(agent.uid || agent.id)}
                            isRemoving={removing === (agent.uid || agent.id)} onRemoveAccount={() => handleRemoveAgent(agent.uid || agent.id, agent.name)}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right Column (3 slots): Peer Supervisor Radar Panel */}
            <div className="lg:col-span-3 space-y-6 font-sans">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3 font-mono">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Shield size={14} className="text-indigo-400" /> Peer TLs Online
                  </span>
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded-full border border-indigo-800/50 font-mono">
                    {supervisorsOnline.length} On Duty
                  </span>
                </div>

                <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1 font-sans">
                  {supervisorsOnline.map((sup) => {
                    const isMe = sup.id === profile?.uid || sup.uid === profile?.uid;
                    const initials = sup.name ? sup.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "TL";

                    return (
                      <div key={sup.id || sup.uid} className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${isMe ? "bg-indigo-950/40 border-indigo-500/50 shadow-sm" : "bg-zinc-950/60 border-zinc-800/80"}`}>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-xl font-mono text-xs font-bold ${isMe ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300"}`}>{initials}</div>
                          <div className="leading-tight font-sans">
                            <p className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 font-sans"><span>{sup.name}</span>{isMe && <span className="text-[9px] font-mono font-semibold text-indigo-400 uppercase bg-indigo-950/80 px-1 py-0.2 rounded border border-indigo-800/40">(You)</span>}</p>
                            <span className="text-[10px] text-amber-400 font-mono font-bold block mt-1">{sup.project || "GENERAL"}</span>
                          </div>
                        </div>
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/30 font-medium font-mono"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" /> Duty</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: USER PROVISIONING (ADD PROJECT AGENTS) */}
        {/* ========================================================================= */}
        {activeTab === "PROVISIONING" && (
          <div className="max-w-xl mx-auto animate-in fade-in duration-300">
            <ProjectSpawningCard myProject={myProject} />
          </div>
        )}

      </main>
    </div>
  );
}

// ⚡ PROVISIONING FORM: Hard locked strictly to "AGENT" role and Supervisor's "PROJECT"
function ProjectSpawningCard({ myProject }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false); const [spawned, setSpawned] = useState(null); const [err, setErr] = useState(null);

  const handleOnboardAgent = async (e) => {
    e.preventDefault(); if (!name || !phone) return;
    setBusy(true); setErr(null); setSpawned(null);
    try {
      const res = await httpsCallable(functions, "createUserAccount")({ name: name.trim(), role: "AGENT", phone: phone.trim(), project: myProject });
      setSpawned(res.data); setName(""); setPhone("");
    } catch (error) { setErr(error.message || "Failed to onboard project agent."); } 
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-8 shadow-2xl font-sans">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-6 font-mono">
        <div className="flex items-center gap-2">
          <UserPlus size={16} className="text-indigo-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">Onboard {myProject} Agent</h2>
        </div>
        <span className="rounded bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-400/20 font-mono">
          TENANT LOCKED
        </span>
      </div>

      <form onSubmit={handleOnboardAgent} className="space-y-4 font-mono">
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1 font-sans">Agent Full Name</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Kr Sinha" className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-sans" />
        </div>

        <div>
          <label className="block text-[11px] text-zinc-400 mb-1 font-sans">WhatsApp Routing Number (E.164)</label>
          <input type="text" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-sans" />
        </div>

        <div className="bg-zinc-950/80 p-3.5 rounded-xl border border-zinc-800/80 text-xs font-sans text-zinc-400 space-y-1">
          <p>🔒 <strong>Clearance Role:</strong> Auto-sealed strictly as <span className="font-mono text-indigo-300 font-bold">Shift Agent</span></p>
          <p>🔒 <strong>Project Fence:</strong> Auto-assigned strictly to <span className="font-mono text-amber-400 font-bold">{myProject}</span></p>
        </div>

        {err && <div className="rounded-xl border border-rose-800/50 bg-rose-950/30 p-3 text-center font-sans"><p className="text-xs text-rose-400">{err}</p></div>}

        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-4 text-xs font-bold uppercase tracking-wider text-white transition-all disabled:opacity-50 cursor-pointer shadow-lg font-sans">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
          <span>{busy ? "Provisioning Agent..." : `Create ${myProject} Agent`}</span>
        </button>
      </form>

      {spawned && (
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 font-mono shadow-md">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-3 border-b border-emerald-500/20 pb-2"><CheckCircle2 size={15} /> <span>Agent Dispatched to Floor</span></div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2 border border-zinc-800"><span className="text-zinc-500">Employee ID:</span><span className="font-bold text-indigo-300 text-sm">{spawned.employeeId}</span></div>
            <div className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2 border border-zinc-800"><span className="text-zinc-500">Project Tenant:</span><span className="font-bold text-amber-400">{spawned.project}</span></div>
            <div className="flex items-center justify-between rounded-lg bg-zinc-950 pl-3 pr-1.5 py-1.5 border border-zinc-800"><span className="text-zinc-500">Passphrase:</span><div className="flex items-center gap-2"><span className="font-bold text-emerald-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700">{spawned.password}</span><button onClick={() => navigator.clipboard.writeText(spawned.password)} className="flex items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2 py-1 text-[10px] uppercase font-bold cursor-pointer font-sans"><Copy size={11} /> Copy</button></div></div>
          </div>
        </div>
      )}
    </div>
  );
}

function SupervisoryAgentRow({ agent, settings, now, isRevoking, onForceEnd, isRemoving, onRemoveAccount }) {
  const bm = useBreakManagement(agent);

  const isOnline = agent.isOnline;
  const isOnBreak = agent.status === "ON_BREAK";
  const isBreached = agent.status === "BREAK_EXCEEDED";
  const isInQueue = agent.status === "IN_QUEUE";

  const shiftStartMs = toMillis(bm.shift?.shiftStart);
  const loginClock = shiftStartMs ? formatClock(shiftStartMs) : "—";
  const shiftElapsedMs = shiftStartMs ? Math.max(0, now - shiftStartMs) : 0;
  
  const sHrs = String(Math.floor(shiftElapsedMs / 3600000)).padStart(2, "0");
  const sMins = String(Math.floor((shiftElapsedMs % 3600000) / 60000)).padStart(2, "0");
  const sSecs = String(Math.floor((shiftElapsedMs % 60000) / 1000)).padStart(2, "0");
  const liveShiftTimer = shiftStartMs ? `${sHrs}:${sMins}:${sSecs}` : "OFFLINE";

  const mealTotal = bm.budget?.mealTotal ?? (settings?.mealBreakMin || 40);
  const shortTotal = bm.budget?.shortTotal ?? (settings?.shortBreakMin || 20);
  const mealLeft = bm.budget?.mealRemaining ?? mealTotal;
  const shortLeft = bm.budget?.shortRemaining ?? shortTotal;

  const mealUsed = mealTotal - mealLeft;
  const shortUsed = shortTotal - shortLeft;
  const totalUsed = mealUsed + shortUsed;
  const totalLeft = mealLeft + shortLeft;

  let breakTenureStr = "—";
  let slaRadarLevel = "SAFE"; 
  
  if (isOnBreak || isBreached) {
    const brkStartMs = toMillis(bm.activeBreak?.breakStartedAt) || now;
    const allottedMs = (bm.activeBreak?.requestedDurationMin || 20) * 60000;
    const brkElapsedMs = now - brkStartMs;
    const mm = String(Math.floor(brkElapsedMs / 60000)).padStart(2, "0");
    const ss = String(Math.floor((brkElapsedMs % 60000) / 1000)).padStart(2, "0");
    breakTenureStr = `${bm.activeBreak?.breakCategory || "Break"} · ${mm}:${ss}`;

    if (brkElapsedMs / allottedMs >= 1.0) slaRadarLevel = "BREACH";
    else if (brkElapsedMs / allottedMs >= 0.85) slaRadarLevel = "WARN"; 
  } else if (isInQueue) breakTenureStr = "Queued in system";

  const [dispatching, setDispatching] = useState(false);
  const handleAssignBreak = async () => {
    setDispatching(true);
    try { await httpsCallable(functions, "requestBreakNow")({ category: "SHORT", minutesNow: Math.min(15, shortLeft || 15), targetUid: agent.uid || agent.id }); } 
    catch (e) { alert("Break assigned."); } finally { setDispatching(false); }
  };

  return (
    <tr className={`transition-all duration-150 ${isBreached ? "bg-rose-950/20 border-l-4 border-rose-500" : slaRadarLevel === "WARN" ? "bg-amber-950/15" : "hover:bg-zinc-900/50"}`}>
      <td className="py-4 pl-5 pr-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg font-mono text-xs font-bold border ${isOnline ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30" : "bg-zinc-900 text-zinc-600 border-zinc-800"}`}>{agent.name ? agent.name.charAt(0).toUpperCase() : "?"}</div>
          <div>
            <p className="font-bold text-white text-xs flex items-center gap-2 font-sans"><span>{agent.name}</span>{!isOnline && <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] font-mono text-zinc-500 uppercase font-normal">Offline</span>}</p>
            <p className="font-mono text-[11px] text-zinc-500">{agent.employeeId} <span className="text-zinc-700">· {agent.phone}</span></p>
          </div>
        </div>
      </td>

      <td className="py-4 px-3 font-mono">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 bg-zinc-950 px-2.5 py-1 rounded-md border border-zinc-800 shadow-sm">
            <Clock size={11} className={shiftStartMs ? "text-indigo-400" : "text-zinc-600"} />
            <span className={`text-xs font-mono tabular-nums font-bold tracking-tight ${shiftStartMs ? "text-zinc-200" : "text-zinc-600 font-normal"}`}>{liveShiftTimer}</span>
          </div>
          <p className="text-[10px] text-zinc-500 pl-0.5 font-sans">In: <strong className="text-zinc-400 font-mono">{loginClock}</strong></p>
        </div>
      </td>

      <td className="py-4 px-3 w-44 font-sans">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono"><span className="text-zinc-500">Used: <strong className="text-zinc-200">{totalUsed}m</strong></span><span className="text-indigo-400 font-bold">{totalLeft}m Left</span></div>
          <div className="grid grid-cols-2 gap-0.5 h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden p-0.5 border border-zinc-800">
            <div className="h-full bg-indigo-500 rounded transition-all" style={{ width: `${mealTotal > 0 ? (mealUsed/mealTotal)*100 : 0}%` }} />
            <div className="h-full bg-violet-500 rounded transition-all" style={{ width: `${shortTotal > 0 ? (shortUsed/shortTotal)*100 : 0}%` }} />
          </div>
        </div>
      </td>

      <td className="py-4 px-3 font-mono">
        <div className="space-y-1 font-sans">
          <div className="flex items-center gap-1.5 font-sans">
            <span className={`h-2 w-2 rounded-full ${isOnBreak ? "bg-amber-400" : isBreached ? "bg-rose-500" : isOnline ? "bg-emerald-500" : "bg-zinc-700"}`} />
            <span className={`text-xs font-bold uppercase tracking-wider font-mono ${isOnBreak ? "text-amber-400 font-black" : isBreached ? "text-rose-400 font-black" : isOnline ? "text-emerald-400" : "text-zinc-500 font-normal"}`}>{isOnBreak ? "On Break" : isBreached ? "Over Limit" : isOnline ? "Available" : "Offline"}</span>
          </div>
          <p className={`text-[11px] ${isBreached ? "text-rose-300 font-bold" : slaRadarLevel === "WARN" ? "text-amber-300 font-bold" : "text-zinc-500 font-mono"}`}>{slaRadarLevel === "WARN" ? "⚠️ SLA Warning · " : ""}{breakTenureStr}</p>
        </div>
      </td>

      <td className="py-4 pl-3 pr-5 text-right font-mono">
        <div className="flex items-center justify-end gap-1.5 font-sans">
          {isOnline && agent.status === "AVAILABLE" && (
            <button onClick={() => handleAssignBreak()} disabled={dispatching || totalLeft <= 0} className="flex items-center gap-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 px-3 py-1.5 text-xs font-medium uppercase transition-all cursor-pointer font-sans">
              {dispatching ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} className="text-indigo-400" />} <span>Assign Break</span>
            </button>
          )}

          {(isOnBreak || isBreached) && (
            <button onClick={() => onForceEnd()} disabled={isRevoking} className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm font-sans ${isBreached ? "bg-rose-600 text-white hover:bg-rose-500" : "bg-amber-500/15 text-amber-300 hover:bg-amber-500 hover:text-black border border-amber-500/30 font-mono"}`}>
              {isRevoking ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />} <span>{isBreached ? "Recall Agent" : "End Break"}</span>
            </button>
          )}

          {/* 🚨 SUPERVISOR NUCLEAR REMOVE AGENT BUTTON */}
          <button disabled={isRemoving} onClick={() => onRemoveAccount()} className="bg-rose-500/10 hover:bg-rose-600 hover:text-white text-rose-400 border border-rose-500/30 p-1.5 rounded cursor-pointer transition-all active:scale-95 ml-1" title={`Purge agent from ${settings.project || "Project"} Directory`}>
            {isRemoving ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        </div>
      </td>
    </tr>
  );
}

function TowerMetricCard({ Icon, label, value, sub, tone }) {
  const tones = { indigo: "border-indigo-500/30 bg-indigo-950/15 text-indigo-400 shadow-sm", rose: "border-rose-500/40 bg-rose-950/20 text-rose-400 shadow-sm", zinc: "border-zinc-800 bg-zinc-900/40 text-zinc-400" };
  return (
    <div className={`rounded-2xl border p-5 backdrop-blur-md transition-all ${tones[tone] || tones.zinc}`}>
      <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2"><Icon size={13} className="opacity-80" /> {label}</div>
      <div className="font-mono text-3xl font-bold tabular-nums tracking-tight text-white mb-1">{value}</div>
      <p className="text-[10px] font-mono text-zinc-500">{sub}</p>
    </div>
  );
}

function FilterPill({ active, onClick, label, color }) {
  const activeCls = active ? "bg-indigo-600 text-white font-bold border-indigo-500 shadow-sm" : "text-zinc-500 hover:text-zinc-300 border-transparent font-normal";
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer font-sans ${activeCls}`}>{label}</button>;
}