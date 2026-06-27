import React, { useState, useEffect, useMemo } from "react";
import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import { WorkModeToggle } from "./AgentConsole"; // ⚡ Importing the smooth toggle
import { UserPlus, LogOut, Search, Edit, Trash2, X, Building2, FolderPlus, Folder, SlidersHorizontal, Lock } from "lucide-react";

const DEFAULT_SETTINGS = { shiftDurationHours: 9, mealBreakMin: 40, shortBreakMin: 20, lockoutStartMin: 60, lockoutEndMin: 60, maxConcurrentBreaks: 2 };

export default function AdminConsole() {
  const { profile } = useAuth();
  useHeartbeat(profile?.uid, profile?.name, profile?.role);

  const supervisorsOnline = useOnlineRoster("SUPERVISOR");
  const agentsOnline = useOnlineRoster("AGENT");

  const [users, setUsers] = useState([]);
  const [projectsList, setProjectsList] = useState(["GENERAL", "BENTLEY", "FOOTLOCKER"]);
  const [activePresences, setActivePresences] = useState(new Map());

  const [activeTab, setActiveTab] = useState("DIRECTORY");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [editingUser, setEditingUser] = useState(null);
  const [showProvision, setShowProvision] = useState(false);

  const myProject = (profile?.project || "GENERAL").trim().toUpperCase();
  const isSuperAdmin = profile?.role === "SUPER_ADMIN" || (profile?.role === "ADMIN" && ["ROOT", "ALL", "GENERAL"].includes(myProject));

  const handleSafeLogout = async () => {
    try { await auth.signOut(); } catch(e) {}
    setTimeout(() => { window.location.replace("/"); }, 400);
  };

  useEffect(() => { const unsub = onSnapshot(collection(db, "users"), snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))); return () => unsub(); }, []);
  useEffect(() => { const unsub = onSnapshot(collection(db, "projects"), snap => { const pArr = snap.docs.map(d => d.id); if (!pArr.includes("GENERAL")) pArr.unshift("GENERAL"); setProjectsList(pArr); }); return () => unsub(); }, []);
  useEffect(() => { const unsub = onSnapshot(collection(db, "presence"), snap => { const pMap = new Map(); snap.docs.forEach(d => { if (d.data()?.status === "ONLINE") pMap.set(d.id, d.data()); }); setActivePresences(pMap); }); return () => unsub(); }, []);

  const visibleUsers = useMemo(() => isSuperAdmin ? users : users.filter(u => (u.project || "GENERAL").toUpperCase() === myProject), [users, isSuperAdmin, myProject]);

  const processedUsers = useMemo(() => {
    return visibleUsers
      .filter(u => {
        const m = u.name?.toLowerCase().includes(searchQuery.toLowerCase()) || u.employeeId?.toLowerCase().includes(searchQuery.toLowerCase());
        if (!m) return false;
        if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
        if (isSuperAdmin && projectFilter !== "ALL" && (u.project || "GENERAL").toUpperCase() !== projectFilter.toUpperCase()) return false;
        return true;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [visibleUsers, searchQuery, roleFilter, projectFilter, isSuperAdmin]);

  const counts = useMemo(() => ({
    total: visibleUsers.length, admins: visibleUsers.filter(u => u.role === "ADMIN" || u.role === "SUPER_ADMIN").length,
    supervisors: visibleUsers.filter(u => u.role === "SUPERVISOR").length, agents: visibleUsers.filter(u => u.role === "AGENT").length,
  }), [visibleUsers]);

  return (
    <div className="relative min-h-screen text-slate-800 font-sans pb-24 selection:bg-indigo-500 selection:text-white">
      <div className="mesh-bg" />

      <header className="glass-bar sticky top-0 z-40 px-6 py-4 font-sans">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-white font-black text-sm shadow-md font-mono ${isSuperAdmin ? 'bg-gradient-to-br from-slate-900 to-indigo-950' : 'bg-gradient-to-br from-indigo-600 to-violet-600'}`}>
              {isSuperAdmin ? 'SAD' : 'AD'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-black uppercase text-slate-900">{isSuperAdmin ? "Global Headquarters" : "Project Admin Console"}</h1>
                <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold font-mono ${isSuperAdmin ? 'bg-rose-50/80 border-rose-200/80 text-rose-600' : 'bg-indigo-50/80 border-indigo-200 text-indigo-700'}`}>{isSuperAdmin ? "ROOT ACCESS" : `${myProject} TENANT`}</span>
                {/* ⚡ THE TOGGLE FOR ADMIN */}
                <WorkModeToggle profile={profile} />
              </div>
              <p className="text-xs text-slate-500 mt-1 font-sans">Operator: <strong className="text-slate-700">{profile?.name}</strong></p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 font-mono">
            {isSuperAdmin && (
              <div className="flex items-center gap-3 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 shadow-inner font-sans">
                <span className="text-indigo-600">{supervisorsOnline.length} Sup Online</span>
                <span className="text-slate-300">|</span>
                <span className="text-emerald-600">{agentsOnline.length} Agt Online</span>
              </div>
            )}
            <button onClick={() => setShowProvision(true)} className="btn-glass flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider cursor-pointer font-sans">
              <UserPlus size={14} /> <span>Provision User</span>
            </button>
            <button onClick={handleSafeLogout} className="btn-soft flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-rose-600 cursor-pointer font-sans">
              <LogOut size={13} /> Logout
            </button>
          </div>
        </div>
      </header>

      <div className="glass-bar relative z-10 py-3 px-6 font-sans">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs font-mono font-bold">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setActiveTab("DIRECTORY")} className={`px-4 py-2 rounded-xl cursor-pointer transition-all font-sans ${activeTab === "DIRECTORY" ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25" : "btn-soft text-slate-500 hover:text-indigo-600"}`}>
              ⚡ Workforce Directory
            </button>
            {isSuperAdmin && (
              <button onClick={() => setActiveTab("TENANTS")} className={`px-4 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 transition-all font-sans ${activeTab === "TENANTS" ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25" : "btn-soft text-slate-500 hover:text-indigo-600"}`}>
                <FolderPlus size={14} /> Manage Tenants
              </button>
            )}
            <button onClick={() => setActiveTab("SETTINGS")} className={`px-4 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 transition-all font-sans ${activeTab === "SETTINGS" ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25" : "btn-soft text-slate-500 hover:text-indigo-600"}`}>
              <SlidersHorizontal size={14} /> Floor Invariants
            </button>
          </div>
          <span className="text-slate-400 font-sans">
            Scope Filter: <strong className="text-emerald-600 font-bold font-mono">{isSuperAdmin ? "GLOBAL (ALL DATA)" : `${myProject} STRICT`}</strong>
          </span>
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-6 mt-8 font-sans">
        {activeTab === "DIRECTORY" && (
          <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 font-mono">
              <div className="glass rounded-[28px] p-5"><span className="text-[10px] text-slate-400 uppercase font-bold block mb-1 font-sans">{isSuperAdmin ? "Total Workforce" : "Project Workforce"}</span><div className="text-3xl font-black text-slate-900">{counts.total}</div></div>
              <div className="glass rounded-[28px] p-5 text-rose-700"><span className="text-[10px] text-slate-400 uppercase font-bold block mb-1 font-sans">Admins</span><div className="text-3xl font-black text-slate-900">{counts.admins}</div></div>
              <div className="glass rounded-[28px] p-5 text-indigo-700"><span className="text-[10px] text-slate-400 uppercase font-bold block mb-1 font-sans">Supervisors</span><div className="text-3xl font-black text-slate-900">{counts.supervisors}</div></div>
              <div className="glass rounded-[28px] p-5 text-emerald-700"><span className="text-[10px] text-slate-400 uppercase font-bold block mb-1 font-sans">Agents</span><div className="text-3xl font-black text-slate-900">{counts.agents}</div></div>
            </div>

            <div className="glass rounded-[32px] p-7 space-y-6 font-sans">
              <div className="flex flex-wrap gap-3 justify-between items-center border-b border-slate-200/80 pb-5 font-mono">
                <div className="relative w-80">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={`Search ${isSuperAdmin ? "global directory" : myProject + " directory"}...`} className="input-glass w-full rounded-xl py-2 pl-9 pr-4 text-xs font-bold text-slate-800 outline-none font-sans" />
                </div>
                
                <div className="flex gap-2 font-mono">
                  <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input-glass rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer">
                    <option value="ALL">All Roles</option>
                    <option value="ADMIN">Admin</option>
                    <option value="SUPERVISOR">Supervisor</option>
                    <option value="AGENT">Agent</option>
                  </select>
                  
                  {isSuperAdmin ? (
                    <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="input-glass rounded-xl px-3 py-2 text-xs font-bold text-indigo-600 outline-none cursor-pointer">
                      <option value="ALL">All Tenants</option>
                      {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  ) : (
                    <span className="input-glass rounded-xl px-4 py-2 text-xs font-bold text-indigo-700 bg-white shadow-sm flex items-center gap-1.5">
                      <Lock size={12}/> {myProject} Tenant
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200/60 font-sans">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50/50 font-mono text-[10px] font-bold uppercase text-slate-500">
                    <tr>
                      <th className="py-4 pl-5">User</th>
                      <th className="py-4 px-3">Role</th>
                      <th className="py-4 px-3">Tenant</th>
                      <th className="py-4 px-3">Status</th>
                      <th className="py-4 text-right pr-5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700 font-sans">
                    {processedUsers.map(u => (
                      <AdminUserRow key={u.uid || u.id} user={u} livePresence={activePresences.get(u.uid || u.id)} onEdit={() => setEditingUser(u)} isSuperAdmin={isSuperAdmin} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "TENANTS" && isSuperAdmin && (
          <div className="max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-300 mt-12">
            <ProjectTenantsManagerCard projectsList={projectsList} profile={profile} />
          </div>
        )}

        {activeTab === "SETTINGS" && (
          <div className="max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-300 mt-12">
            <ConfigSettingsCard isSuperAdmin={isSuperAdmin} myProject={myProject} projectsList={projectsList} />
          </div>
        )}

      </main>

      {editingUser && <EditEmployeeModal user={editingUser} projectsList={projectsList} onClose={() => setEditingUser(null)} isSuperAdmin={isSuperAdmin} myProject={myProject} />}
      {showProvision && <AdminProvisionModal projectsList={projectsList} onClose={() => setShowProvision(false)} isSuperAdmin={isSuperAdmin} myProject={myProject} />}

      <footer className="relative z-10 py-8 text-center font-sans">
        <p className="text-xs font-bold text-slate-400 tracking-wide">
          Made with <span className="text-rose-500 inline-block animate-bounce">❤️</span> by <strong className="text-slate-600 font-black">Harshit Sinha</strong>
        </p>
      </footer>
    </div>
  );
}

// -------------------------------------------------------------
// CHILD COMPONENTS
// -------------------------------------------------------------

function ProjectTenantsManagerCard({ projectsList, profile }) {
  const [newProj, setNewProj] = useState(""); 
  const [busy, setBusy] = useState(false);
  
  const handleAddTenant = async (e) => { 
    e.preventDefault(); 
    const code = newProj.trim().toUpperCase(); 
    if (!code) return; 
    setBusy(true); 
    try { 
      await setDoc(doc(db, "projects", code), { 
        id: code, name: code, createdAt: serverTimestamp(), createdBy: profile?.uid || "ADMIN" 
      }, { merge: true }); 
      setNewProj(""); 
    } catch(e) { alert(e.message); } finally { setBusy(false); } 
  };

  const handleRemoveTenant = async (pName) => { 
    if (pName === "GENERAL") return alert("GENERAL is a protected global tenant."); 
    if (!confirm(`Purge project tenant '${pName}' entirely?`)) return; 
    setBusy(true); 
    try { await deleteDoc(doc(db, "projects", pName)); } 
    catch(e) { alert(e.message); } finally { setBusy(false); } 
  };

  return (
    <div className="glass rounded-[32px] p-8 space-y-6 font-sans">
      <div className="flex justify-between border-b border-slate-200/80 pb-4 font-mono font-bold text-xs text-indigo-600">
        <span className="flex items-center gap-2"><FolderPlus size={16}/> Manage Project Tenants</span>
        <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full font-mono font-bold shadow-sm">Global Stamp</span>
      </div>
      
      <form onSubmit={handleAddTenant} className="flex gap-3">
        <input type="text" required value={newProj} onChange={e => setNewProj(e.target.value.toUpperCase())} placeholder="e.g., ADIDAS_UK..." className="input-glass flex-1 rounded-2xl px-5 py-4 text-sm font-mono font-bold text-slate-900 outline-none focus:border-indigo-600"/>
        <button type="submit" disabled={busy} className="btn-glass font-bold px-6 py-4 rounded-2xl text-xs uppercase tracking-widest cursor-pointer shadow-md active:scale-95 font-sans">Add Tenant</button>
      </form>
      
      <div className="flex flex-wrap gap-2 pt-2 max-h-48 overflow-y-auto pr-1">
        {projectsList.map(p => (
          <span key={p} className="inline-flex items-center gap-1.5 bg-white/80 px-4 py-2 rounded-xl border border-slate-200/80 text-xs font-bold text-slate-700 font-mono transition-all hover:bg-white hover:shadow-md hover:-translate-y-0.5">
            <Folder size={12} className="text-indigo-600"/> <span>{p}</span>
            {p !== "GENERAL" && <button type="button" onClick={() => handleRemoveTenant(p)} className="text-slate-400 hover:text-rose-600 ml-1.5 cursor-pointer"><X size={14}/></button>}
          </span>
        ))}
      </div>
    </div>
  );
}

function ConfigSettingsCard({ isSuperAdmin, myProject, projectsList }) {
  const [targetTenant, setTargetTenant] = useState(isSuperAdmin ? (projectsList[0] || "GENERAL") : myProject);
  const [form, setForm] = useState(DEFAULT_SETTINGS); 
  const [busy, setBusy] = useState(false); 
  const [saved, setSaved] = useState(false);
  
  useEffect(() => { 
    const unsub = onSnapshot(doc(db, "project_settings", targetTenant), snap => { 
      if (snap.exists()) setForm(snap.data()); else setForm(DEFAULT_SETTINGS);
    }); 
    return () => unsub(); 
  }, [targetTenant]);
  
  const handleSaveConfig = async (e) => { 
    e.preventDefault(); setBusy(true); 
    try { 
      await setDoc(doc(db, "project_settings", targetTenant), { ...form, updatedAt: serverTimestamp() }, { merge: true }); 
      setSaved(true); setTimeout(() => setSaved(false), 2500); 
    } catch (err) { alert(err.message); } finally { setBusy(false); } 
  };

  return (
    <div className="glass rounded-[32px] p-8 space-y-6 font-sans">
      <div className="flex justify-between items-center border-b border-slate-200/80 pb-4 font-mono font-bold text-xs text-indigo-600">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={16} /> 
          {isSuperAdmin ? (
            <select value={targetTenant} onChange={e => setTargetTenant(e.target.value)} className="bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg text-indigo-700 outline-none cursor-pointer">
              {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
             <span>{myProject} WFM Timings</span>
          )}
        </div>
        {saved ? <span className="text-emerald-700 font-black bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 shadow-sm">✓ LEDGER SAVED</span> : <span className="text-[10px] text-slate-400 uppercase tracking-widest bg-slate-50 px-3 py-1 rounded-full border border-slate-200">Invariants</span>}
      </div>
      
      <form onSubmit={handleSaveConfig} className="space-y-5 text-xs">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/60 p-4 rounded-2xl border border-slate-200/60 shadow-sm">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono mb-2">Meal Break Limit</label>
            <div className="flex items-center gap-2"><input type="number" min={1} required value={form?.mealBreakMin ?? 40} onChange={e => setForm({...form, mealBreakMin: Number(e.target.value)})} className="w-full bg-transparent font-black text-slate-900 font-mono text-lg outline-none" /><span className="text-slate-400 font-mono font-bold">Mins</span></div>
          </div>
          <div className="bg-white/60 p-4 rounded-2xl border border-slate-200/60 shadow-sm">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono mb-2">Short Break Limit</label>
            <div className="flex items-center gap-2"><input type="number" min={1} required value={form?.shortBreakMin ?? 20} onChange={e => setForm({...form, shortBreakMin: Number(e.target.value)})} className="w-full bg-transparent font-black text-slate-900 font-mono text-lg outline-none" /><span className="text-slate-400 font-mono font-bold">Mins</span></div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-indigo-50/40 p-4 rounded-2xl border border-indigo-100 shadow-sm">
            <label className="block text-[10px] font-bold text-indigo-500 uppercase tracking-widest font-mono mb-2">Shift Start Delay Lock</label>
            <div className="flex items-center gap-2"><input type="number" min={0} required value={form?.lockoutStartMin ?? 60} onChange={e => setForm({...form, lockoutStartMin: Number(e.target.value)})} className="w-full bg-transparent font-black text-indigo-700 font-mono text-lg outline-none" /><span className="text-indigo-400 font-mono font-bold">Mins</span></div>
            <span className="text-[10px] text-slate-500 block mt-2 font-medium">Freezes breaks right after clock-in</span>
          </div>
          <div className="bg-rose-50/40 p-4 rounded-2xl border border-rose-100 shadow-sm">
            <label className="block text-[10px] font-bold text-rose-500 uppercase tracking-widest font-mono mb-2">Shift End Margin Lock</label>
            <div className="flex items-center gap-2"><input type="number" min={0} required value={form?.lockoutEndMin ?? 60} onChange={e => setForm({...form, lockoutEndMin: Number(e.target.value)})} className="w-full bg-transparent font-black text-rose-700 font-mono text-lg outline-none" /><span className="text-rose-400 font-mono font-bold">Mins</span></div>
            <span className="text-[10px] text-slate-500 block mt-2 font-medium">Freezes breaks before shift handover</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/60 p-4 rounded-2xl border border-slate-200/60 shadow-sm">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono mb-2">Max Floor Concurrency</label>
            <div className="flex items-center gap-2"><input type="number" min={1} required value={form?.maxConcurrentBreaks ?? 2} onChange={e => setForm({...form, maxConcurrentBreaks: Number(e.target.value)})} className="w-full bg-transparent font-black text-slate-900 font-mono text-lg outline-none" /><span className="text-slate-400 font-mono font-bold">Agents</span></div>
          </div>
          <div className="bg-white/60 p-4 rounded-2xl border border-slate-200/60 shadow-sm">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono mb-2">Standard Shift Span</label>
            <div className="flex items-center gap-2"><input type="number" min={1} required value={form?.shiftDurationHours ?? 9} onChange={e => setForm({...form, shiftDurationHours: Number(e.target.value)})} className="w-full bg-transparent font-black text-slate-900 font-mono text-lg outline-none" /><span className="text-slate-400 font-mono font-bold">Hours</span></div>
          </div>
        </div>
        
        <button type="submit" disabled={busy} className="btn-glass w-full font-black py-4 mt-2 rounded-2xl text-xs uppercase tracking-widest cursor-pointer shadow-md active:scale-[0.99] disabled:opacity-50">
          Deploy Ledger Configurations
        </button>
      </form>
    </div>
  );
}

function AdminUserRow({ user, livePresence, onEdit, isSuperAdmin }) {
  const [busy, setBusy] = useState(false); 
  const [newPass, setNewPass] = useState(null);
  
  let projectedStatus = "OFFLINE"; 
  let effWorkMode = user.workMode || "WFO";
  
  if (livePresence && livePresence.status === "ONLINE") {
    if (user.role === "AGENT") projectedStatus = user.activeShiftId ? "AVAILABLE" : "PRE_SHIFT";
    else projectedStatus = "ONLINE";
    if (livePresence.workMode) effWorkMode = livePresence.workMode;
  } else if (livePresence && livePresence.status !== "OFFLINE") {
    projectedStatus = livePresence.status;
    if (livePresence.workMode) effWorkMode = livePresence.workMode;
  }

  const isTargetSuperAdmin = user.role === "SUPER_ADMIN" || (user.role === "ADMIN" && ["ROOT", "ALL", "GENERAL"].includes((user.project || "GENERAL").toUpperCase()));
  const canEdit = isSuperAdmin || !isTargetSuperAdmin;

  const handleReset = async () => { 
    setBusy(true); 
    try { 
      const res = await httpsCallable(functions, "resetPassword")({ targetUid: user.uid || user.id }); 
      setNewPass(res.data?.password); 
    } catch(e) { alert(e.message); } finally { setBusy(false); } 
  };
  
  const handleRemove = async () => { 
    if (!confirm(`Permanently remove ${user.name}?`)) return; 
    setBusy(true); 
    try { 
      await httpsCallable(functions, "deleteUserAccount")({ targetUid: user.uid || user.id }); 
    } catch(e) { alert(e.message); } finally { setBusy(false); } 
  };

  return (
    <tr className="hover:bg-slate-50/80 transition-colors font-sans border-b border-slate-100 last:border-0">
      <td className="py-3.5 pl-5">
        <p className="font-bold text-slate-900 text-xs flex items-center gap-2">
          <span>{user.name}</span> 
          <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-mono font-bold text-[9px] px-1.5 py-0.5 rounded shadow-sm">{effWorkMode}</span>
        </p>
        <span className="font-mono text-[11px] text-slate-400 font-medium block mt-1">{user.employeeId}</span>
      </td>
      <td className="py-3.5 px-3 font-mono">
        <span className={`px-2.5 py-1 rounded-md border text-[10px] uppercase font-black tracking-wider ${user.role === "SUPER_ADMIN" || user.role === "ADMIN" ? "bg-rose-50 border-rose-200 text-rose-700" : user.role === "SUPERVISOR" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
          {user.role === "SUPER_ADMIN" ? "SUPER ADM" : user.role}
        </span>
      </td>
      <td className="py-3.5 px-3 font-mono font-bold text-indigo-600">{user.project || "GENERAL"}</td>
      <td className="py-3.5 px-3"><UserStatusBadge status={projectedStatus} /></td>
      
      <td className="py-3.5 text-right pr-5">
        {canEdit ? (
          <div className="flex items-center justify-end gap-1.5">
            <button onClick={onEdit} className="btn-soft text-slate-600 hover:text-indigo-600 p-2 rounded-xl cursor-pointer">
              <Edit size={14} />
            </button>
            {newPass ? (
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl font-mono font-bold text-xs shadow-sm">{newPass}</span>
            ) : (
              <button disabled={busy} onClick={handleReset} className="btn-soft px-3 py-1.5 rounded-xl font-bold text-xs cursor-pointer">Reset</button>
            )}
            {user.role !== "SUPER_ADMIN" && (
              <button disabled={busy} onClick={handleRemove} className="text-slate-400 hover:text-rose-600 p-2 rounded-xl hover:bg-rose-50 transition-colors cursor-pointer">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ) : (
          <span className="text-[9px] font-black text-slate-400 font-mono tracking-widest px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md">RESTRICTED</span>
        )}
      </td>
    </tr>
  );
}

function UserStatusBadge({ status }) {
  const map = { 
    ONLINE: { text: "Online", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }, 
    AVAILABLE: { text: "Available", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 font-bold" }, 
    PRE_SHIFT: { text: "Pre-Shift", cls: "bg-blue-50 text-blue-600 border-blue-200 font-bold" },
    IN_QUEUE: { text: "In Queue", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" }, 
    ON_BREAK: { text: "On Break", cls: "bg-amber-50 text-amber-700 border-amber-200 font-bold animate-pulse" }, 
    BREAK_EXCEEDED: { text: "Over Limit", cls: "bg-rose-50 text-rose-700 border-rose-200 font-black animate-ping" }, 
    OFFLINE: { text: "Offline", cls: "bg-slate-100 text-slate-400 border-slate-200 font-medium" } 
  };
  const b = map[status] || map.OFFLINE; 
  return <span className={`px-2.5 py-1 rounded-full text-[9px] font-black font-mono border uppercase tracking-wider inline-block ${b.cls}`}>{b.text}</span>;
}

function AdminProvisionModal({ projectsList, onClose, isSuperAdmin, myProject }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [role, setRole] = useState("AGENT"); 
  const [project, setProject] = useState(isSuperAdmin ? (projectsList[0] || "GENERAL") : myProject); 
  const [busy, setBusy] = useState(false); const [spawned, setSpawned] = useState(null);
  
  const submit = async (e) => { 
    e.preventDefault(); setBusy(true); 
    try { 
      const res = await httpsCallable(functions, "createUserAccount")({ name: name.trim(), role, phone: phone.trim(), project }); 
      setSpawned(res.data); setName(""); setPhone(""); 
    } catch(e) { alert(e.message); } finally { setBusy(false); } 
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in font-sans">
      <div className="glass w-full max-w-md rounded-[32px] p-8 space-y-6 animate-rise shadow-2xl bg-white/95">
        <div className="flex justify-between items-center border-b border-slate-200/80 pb-4 font-mono font-bold text-xs text-indigo-600">
          <span className="flex items-center gap-2"><UserPlus size={16} /> Provision New {isSuperAdmin ? "Global User" : "Tenant Member"}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X size={18} /></button>
        </div>
        
        {spawned ? (
          <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl font-mono text-xs space-y-3 animate-rise shadow-inner">
            <div className="font-black text-emerald-800 text-base mb-3 border-b border-emerald-200/60 pb-3">✓ Account Deployed</div>
            <div className="flex justify-between text-emerald-900 text-sm"><span className="text-emerald-700/80">ID:</span> <strong className="bg-white px-2 py-0.5 rounded shadow-sm">{spawned.employeeId}</strong></div>
            <div className="flex justify-between text-emerald-900 text-sm"><span className="text-emerald-700/80">Pass:</span> <strong className="bg-white px-2 py-0.5 rounded shadow-sm">{spawned.password}</strong></div>
            <button onClick={onClose} className="btn-glass mt-5 w-full py-4 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer font-sans shadow-md">Acknowledge & Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">Display Name</label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} className="input-glass w-full rounded-2xl p-4 text-sm text-slate-900 font-bold outline-none font-sans" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">Role Clearance</label>
                <select value={role} onChange={e => setRole(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs font-bold text-indigo-600 outline-none cursor-pointer font-mono">
                  <option value="AGENT">Agent</option>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="ADMIN">Project Admin</option>
                  {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">Project Tenant</label>
                {isSuperAdmin ? (
                  <select value={project} onChange={e => setProject(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs font-mono font-bold text-amber-600 outline-none cursor-pointer">
                    {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <div className="w-full rounded-2xl p-3.5 text-xs font-mono font-bold text-slate-500 bg-slate-50 border border-slate-200 flex items-center justify-between"><Building2 size={14}/>{myProject}</div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">WhatsApp Number</label>
              <input type="text" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91..." className="input-glass w-full rounded-2xl p-4 text-sm text-slate-900 font-bold outline-none font-sans" />
            </div>
            <button type="submit" disabled={busy} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 font-sans mt-3">
              {busy ? "Provisioning..." : "Create Workforce Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function EditEmployeeModal({ user, projectsList, onClose, isSuperAdmin, myProject }) {
  const [name, setName] = useState(user?.name || ""); 
  const [phone, setPhone] = useState(user?.phone || ""); 
  const [role, setRole] = useState(user?.role || "AGENT"); 
  const [project, setProject] = useState(user?.project || "GENERAL"); 
  const [busy, setBusy] = useState(false);
  
  const handleSaveChanges = async (e) => { 
    e.preventDefault(); setBusy(true); 
    try { await httpsCallable(functions, "editUserAccount")({ targetUid: user.uid || user.id, name, phone, role, project }); onClose(); } 
    catch (err) { alert(err.message); setBusy(false); } 
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in font-sans">
      <div className="glass w-full max-w-md rounded-[32px] p-8 space-y-6 animate-rise shadow-2xl bg-white/95">
        <div className="flex justify-between items-center border-b border-slate-200/80 pb-4 font-mono font-bold text-xs text-indigo-600">
          <span className="flex items-center gap-2"><Edit size={16} /> Edit Workforce Profile</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X size={18} /></button>
        </div>
        
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 font-mono text-xs flex justify-between text-slate-500 shadow-inner">
          <span className="flex items-center gap-1.5">ID: <strong className="text-indigo-600 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-100">{user.employeeId}</strong></span>
          <span className="flex items-center gap-1.5"><Building2 size={13} /> Tenant: <strong className="text-slate-800">{user.project || "GENERAL"}</strong></span>
        </div>
        
        <form onSubmit={handleSaveChanges} className="space-y-5">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">Display Name</label>
            <input type="text" required value={name} onChange={e => setName(e.target.value)} className="input-glass w-full rounded-2xl p-4 text-sm text-slate-900 font-bold outline-none font-sans" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">Role Clearance</label>
              <select value={role} onChange={e => setRole(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs font-bold text-indigo-600 outline-none cursor-pointer font-mono">
                <option value="AGENT">Agent</option>
                <option value="SUPERVISOR">Supervisor</option>
                <option value="ADMIN">Project Admin</option>
                {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">Project Tenant</label>
              {isSuperAdmin ? (
                <select value={project} onChange={e => setProject(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs font-mono font-bold text-amber-600 outline-none cursor-pointer">
                  {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <div className="w-full rounded-2xl p-3.5 text-xs font-mono font-bold text-slate-500 bg-slate-50 border border-slate-200 flex items-center justify-between"><Lock size={14}/>{myProject}</div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">WhatsApp Number</label>
            <input type="text" required value={phone} onChange={e => setPhone(e.target.value)} className="input-glass w-full rounded-2xl p-4 text-sm text-slate-900 font-bold outline-none font-sans" />
          </div>
          
          <button type="submit" disabled={busy} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase tracking-wider cursor-pointer font-sans mt-3">
            {busy ? "Saving..." : "Commit Profile Changes"}
          </button>
        </form>
      </div>
    </div>
  );
}