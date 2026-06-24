import React, { useState } from "react";
import { LogOut, WifiOff, Clock, AlertTriangle, Play, Loader2, Shield, UserCheck, Key, Copy, Check, Sparkles, X, Lock } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useBreakManagement } from "../hooks/useBreakManagement";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import AgentBreakWidget from "../components/AgentBreakWidget";
import BreakRequestPanel from "../components/BreakRequestPanel";
import { formatClock, toMillis } from "../utils/timeHelpers";

export default function AgentConsole() {
  const { profile, logout } = useAuth();
  useHeartbeat(profile?.uid, profile?.name, profile?.role);
  
  const supervisorsOnline = useOnlineRoster("SUPERVISOR");
  const bm = useBreakManagement(profile);
  const [syncing, setSyncing] = useState(false);
  
  // ⚡ AGENT DESERVED FEATURES STATE
  const [showPassModal, setShowPassModal] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const missingShift = profile?.role === "AGENT" && !profile?.activeShiftId;
  const myProject = (profile?.project || "GENERAL").trim().toUpperCase();

  // Strictly filter online supervisors to those commanding this Agent's specific Project!
  const projectSupervisors = supervisorsOnline.filter(s => (s.project || "GENERAL").toUpperCase() === "GENERAL" || (s.project || "GENERAL").toUpperCase() === myProject);
  const supCount = projectSupervisors.length;

  const handleClockIn = async () => {
    setSyncing(true);
    try {
      await httpsCallable(functions, "startShift")();
      window.location.reload();
    } catch (e) { alert("Clock-in failed: " + e.message); setSyncing(false); }
  };

  const handleCopyId = () => {
    if (!profile?.employeeId) return;
    navigator.clipboard.writeText(profile.employeeId);
    setCopiedId(true); setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 font-sans pb-24 selection:bg-indigo-500 selection:text-white relative">
      
      {/* ⚡ Transformed Professional Agent Topbar */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-[#09090b]/90 backdrop-blur-md px-6 py-3.5 transition-all font-sans">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white font-mono font-bold text-xs shadow-md">
              WFM
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xs font-bold tracking-wide uppercase text-zinc-100 font-mono">Agent Workspace</h1>
                
                {/* ⚡ PROMINENT PROJECT TENANT BADGE */}
                <span className="rounded bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-mono font-bold text-indigo-400 tracking-wider">
                  PROJECT: {myProject}
                </span>
              </div>
              
              <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5 font-sans">
                <span>{profile?.name}</span>
                <span className="text-zinc-700">·</span>
                <span className="font-mono text-zinc-300 font-bold inline-flex items-center gap-1 bg-zinc-950 px-1.5 py-0.2 rounded border border-zinc-800">
                  {profile?.employeeId}
                  <button onClick={handleCopyId} className="text-zinc-500 hover:text-indigo-400 transition-colors cursor-pointer ml-0.5" title="Copy ID for ServiceNow/Jira">
                    {copiedId ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  </button>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 font-mono">
            
            {/* ⚡ FEATURE #1: SELF PASSPHRASE TRIGGER */}
            <button 
              onClick={() => setShowPassModal(true)} 
              className="flex items-center gap-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-all active:scale-95 cursor-pointer font-sans"
            >
              <Key size={13} className="text-indigo-400" /> <span>Change Password</span>
            </button>

            <button 
              onClick={logout}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/30 transition-all active:scale-95 cursor-pointer font-sans"
            >
              <LogOut size={13} /> Log Out
            </button>
          </div>
        </div>
      </header>

      {/* ⚡ FEATURE #2: THE "WFM FLOOR MEMO" (Operational Zen Banner) */}
      <div className="border-b border-zinc-800/60 bg-zinc-950/60 py-2 px-6 font-sans text-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-zinc-400">
          <span className="flex items-center gap-2 text-[11px]">
            <Sparkles size={13} className="text-amber-400 animate-pulse" />
            <strong className="text-zinc-200">Floor Memo:</strong> Keep non-call statuses accurate. Standard short break limit is 20 mins daily.
          </span>
          <span className="text-[11px] font-mono text-emerald-400 font-medium">● SLA Handshake Secure</span>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 mt-8 font-sans">
        
        {missingShift ? (
          <div className="max-w-md mx-auto overflow-hidden rounded-3xl border border-amber-500/30 bg-amber-950/20 p-8 shadow-2xl text-center space-y-4 font-sans">
            <div className="flex items-center justify-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider font-mono">
              <AlertTriangle size={16} /> <span>Shift Clock Inactive</span>
            </div>
            <p className="text-xs text-amber-200/90 leading-relaxed font-sans font-medium">
              Welcome to the {myProject} floor. Please start your shift attendance timer to unlock your break quotas.
            </p>
            <button
              onClick={handleClockIn} disabled={syncing}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-mono font-bold uppercase tracking-wider py-4 text-xs transition-all active:scale-[0.99] cursor-pointer shadow-lg"
            >
              {syncing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} className="fill-zinc-950" />}
              <span>{syncing ? "Stamping Shift Clock..." : "Clock In Now"}</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 font-sans">
            
            {/* Left Column (8 slots): Break Usage & Spawner Panel */}
            <div className="lg:col-span-8 space-y-6">
              <AgentBreakWidget profile={profile} activeBreak={bm.activeBreak} budget={bm.budget} countdown={bm.countdown} />
              <BreakRequestPanel
                windowStatus={bm.windowStatus} budget={bm.budget} activeBreak={bm.activeBreak} readyToGo={bm.readyToGo} busy={bm.busy}
                requestBreakNow={bm.requestBreakNow} requestBreakLater={bm.requestBreakLater}
                goingForBreak={bm.goingForBreak} endBreak={bm.endBreak} cancelScheduledBreak={bm.cancelScheduledBreak}
              />
              {bm.actionError && (
                <div className="rounded-xl border border-rose-800/50 bg-rose-950/40 p-3.5 text-center font-mono"><p className="text-xs font-bold text-rose-300">{bm.actionError}</p></div>
              )}
            </div>

            {/* Right Column (4 slots): Active Supervisors controlling this Project */}
            <div className="lg:col-span-4 space-y-6 font-sans">
              
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3 font-mono">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Shield size={14} className="text-indigo-400" /> {myProject} Tower Leads
                  </span>
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded-full border border-indigo-800/50 font-mono">
                    {supCount} On Duty
                  </span>
                </div>

                {supCount === 0 ? (
                  <div className="py-8 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/50 space-y-1">
                    <WifiOff size={18} className="mx-auto text-zinc-600" />
                    <p className="text-xs font-bold text-zinc-400 font-sans">No Project Leads Online</p>
                    <p className="text-[10px] text-zinc-600 max-w-[200px] mx-auto font-sans leading-tight">Your tenant is running autonomously on standard FIFO queue rules.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {projectSupervisors.map((sup) => (
                      <div key={sup.id || sup.uid} className="flex items-center justify-between bg-zinc-950 p-3 rounded-2xl border border-zinc-800/80 shadow-inner">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs font-bold text-indigo-300 font-mono">
                            {sup.name ? sup.name.charAt(0).toUpperCase() : "S"}
                          </div>
                          <div className="leading-tight">
                            <p className="text-xs font-bold text-zinc-200 font-sans">{sup.name}</p>
                            <span className="text-[10px] text-zinc-500 font-mono block mt-0.5">{sup.employeeId || "LEAD"}</span>
                          </div>
                        </div>
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40 font-medium font-mono">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" /> On Duty
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {bm.shift && <ShiftFooter shift={bm.shift} now={bm.now} />}

            </div>

          </div>
        )}

      </main>

      {/* ⚡ FEATURE #3: SELF-PASSPHRASE MODAL OVERLAY */}
      {showPassModal && (
        <AgentChangePasswordModal onClose={() => setShowPassModal(false)} />
      )}

    </div>
  );
}

// ⚡ MODAL OVERLAY COMPONENT
function AgentChangePasswordModal({ onClose }) {
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [err, setErr] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPass.length < 6) return setErr("Passphrase must be at least 6 characters.");
    if (newPass !== confirmPass) return setErr("Passphrases do not match.");

    setBusy(true); setErr(null);
    try {
      await httpsCallable(functions, "agentUpdateOwnPassword")({ newPass });
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (error) { setErr(error.message || "Failed to update security credentials."); } 
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl space-y-5">
        
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3.5 font-mono">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
            <Lock size={14} /> <span>Security Credentials</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white cursor-pointer"><X size={15}/></button>
        </div>

        {success ? (
          <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-2xl p-6 text-center space-y-2 font-mono">
            <Check size={28} className="mx-auto text-emerald-400 animate-bounce" />
            <p className="text-xs font-bold text-emerald-300">Passphrase Updated Successfully</p>
            <p className="text-[10px] text-emerald-500 font-sans">Your session remains securely authenticated.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 font-sans">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1 font-mono">New Passphrase</label>
              <input type="password" required value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="At least 6 characters" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500" />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1 font-mono">Confirm Passphrase</label>
              <input type="password" required value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Repeat passphrase" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500" />
            </div>

            {err && <div className="rounded-xl border border-rose-800/50 bg-rose-950/30 p-3 text-center"><p className="text-xs text-rose-400 font-medium">{err}</p></div>}

            <div className="pt-2">
              <button type="submit" disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg cursor-pointer disabled:opacity-50 font-mono">
                {busy ? "Updating IAM Token..." : "Confirm Password Change"}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}

function ShiftFooter({ shift, now }) {
  const startMs = toMillis(shift?.shiftStart);
  const endMs = toMillis(shift?.shiftEnd);
  const elapsed = startMs ? Math.max(0, now - startMs) : 0;
  const total = startMs && endMs ? endMs - startMs : 0;
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  const hrs = Math.floor(elapsed / (1000 * 60 * 60));
  const mins = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-xl space-y-3 font-sans">
      <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
        <span>Shift Horizon</span>
        <span className="text-zinc-200 font-mono font-bold">{startMs ? formatClock(startMs) : "—"} → {endMs ? formatClock(endMs) : "—"}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-950 border border-zinc-800 p-0.5">
        <div className="h-full rounded-full bg-indigo-500 transition-all duration-1000" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <span>Logged: <strong className="text-zinc-200">{hrs}h {mins}m</strong></span>
        <span>Burn: {Math.round(pct)}%</span>
      </div>
    </div>
  );
}