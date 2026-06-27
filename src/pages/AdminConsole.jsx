import React, { useState, useEffect, useMemo } from "react";
import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import { WorkModeToggle } from "./AgentConsole"; 
import { UserPlus, LogOut, Search, Edit, Trash2, X, Building2, FolderPlus, Folder, SlidersHorizontal, Lock } from "lucide-react";

const DEFAULT_SETTINGS = { 
  shiftDurationHours: 9, 
  mealBreakMin: 40, 
  shortBreakMin: 20, 
  lockoutStartMin: 60, 
  lockoutEndMin: 60, 
  maxConcurrentBreaks: 2 
};

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
    try { 
      await auth.signOut(); 
    } catch(e) {}
    window.location.replace("/");
  };

  useEffect(() => { 
    const unsub = onSnapshot(collection(db, "users"), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }); 
    return () => unsub(); 
  }, []);

  useEffect(() => { 
    const unsub = onSnapshot(collection(db, "projects"), snap => { 
      const pArr = snap.docs.map(d => d.id); 
      if (!pArr.includes("GENERAL")) pArr.unshift("GENERAL"); 
      setProjectsList(pArr); 
    }); 
    return () => unsub(); 
  }, []);

  useEffect(() => { 
    const unsub = onSnapshot(collection(db, "presence"), snap => { 
      const pMap = new Map(); 
      snap.docs.forEach(d => { 
        if (d.data()?.status === "ONLINE") pMap.set(d.id, d.data()); 
      }); 
      setActivePresences(pMap); 
    }); 
    return () => unsub(); 
  }, []);

  const visibleUsers = useMemo(() => {
    return isSuperAdmin 
      ? users 
      : users.filter(u => (u.project || "GENERAL").toUpperCase() === myProject);
  }, [users, isSuperAdmin, myProject]);

  const processedUsers = useMemo(() => {
    return visibleUsers
      .filter(u => {
        const m = u.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                  u.employeeId?.toLowerCase().includes(searchQuery.toLowerCase());
        if (!m) return false;
        if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
        if (isSuperAdmin && projectFilter !== "ALL" && (u.project || "GENERAL").toUpperCase() !== projectFilter.toUpperCase()) return false;
        return true;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [visibleUsers, searchQuery, roleFilter, projectFilter, isSuperAdmin]);

  const counts = useMemo(() => ({
    total: visibleUsers.length, 
    admins: visibleUsers.filter(u => u.role === "ADMIN" || u.role === "SUPER_ADMIN").length,
    supervisors: visibleUsers.filter(u => u.role === "SUPERVISOR").length, 
    agents: visibleUsers.filter(u => u.role === "AGENT").length,
  }), [visibleUsers]);

  return (
    <div className="relative min-h-screen text-slate-800 font-sans pb-24 selection:bg-indigo-500 selection:text-white">
      <div className="mesh-bg" />

      {/* ⚡ MOBILE RESPONSIVE HEADER */}
      <header className="glass-bar sticky top-0 z-40 px-4 sm:px-6 py-4 font-sans">
        <div className="mx-auto flex flex-wrap max-w-7xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white font-black text-sm shadow-md font-mono">
              AD
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xs sm:text-sm font-black uppercase text-slate-900">Admin Console</h1>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold font-mono ${isSuperAdmin ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}>
                  {isSuperAdmin ? "ROOT" : `${myProject}`}
                </span>
                <WorkModeToggle profile={profile} />
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                Admin: <strong className="text-slate-700">{profile?.name}</strong>
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 font-mono ml-auto sm:ml-0">
            <button onClick={() => setShowProvision(true)} className="btn-glass flex items-center gap-1.5 rounded-xl px-3 sm:px-4 py-2 text-xs font-black uppercase cursor-pointer">
              <UserPlus size={14} /> 
              <span className="hidden sm:inline">Add User</span>
            </button>
            <button onClick={handleSafeLogout} className="btn-soft flex items-center gap-1 rounded-xl px-3 sm:px-4 py-2 text-xs font-bold text-rose-600 cursor-pointer">
              <LogOut size={13} /> Exit
            </button>
          </div>
        </div>
      </header>

      <div className="glass-bar relative z-10 py-2.5 px-4 sm:px-6 font-sans">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs font-mono font-bold">
          <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            <button onClick={() => setActiveTab("DIRECTORY")} className={`px-3.5 py-2 rounded-xl cursor-pointer shrink-0 ${activeTab === "DIRECTORY" ? "bg-indigo-600 text-white shadow-md" : "btn-soft text-slate-500"}`}>
              ⚡ Staff List
            </button>
            {isSuperAdmin && (
              <button onClick={() => setActiveTab("TENANTS")} className={`px-3.5 py-2 rounded-xl cursor-pointer flex items-center gap-1 shrink-0 ${activeTab === "TENANTS" ? "bg-indigo-600 text-white shadow-md" : "btn-soft text-slate-500"}`}>
                <FolderPlus size={13} /> Manage Projects
              </button>
            )}
            <button onClick={() => setActiveTab("SETTINGS")} className={`px-3.5 py-2 rounded-xl cursor-pointer flex items-center gap-1 shrink-0 ${activeTab === "SETTINGS" ? "bg-indigo-600 text-white shadow-md" : "btn-soft text-slate-500"}`}>
              <SlidersHorizontal size={13} /> Break Settings
            </button>
          </div>
          <span className="text-[11px] text-slate-400 font-sans hidden md:inline">
            Project: <strong className="text-emerald-600 font-bold font-mono">{isSuperAdmin ? "ALL DATA" : `${myProject} STRICT`}</strong>
          </span>
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 mt-6 space-y-6 animate-rise font-sans">
        {activeTab === "DIRECTORY" && (
          <div className="space-y-6 sm:space-y-8 animate-in fade-in zoom-in-95 duration-300">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 font-mono">
              <div className="glass rounded-[24px] sm:rounded-[28px] p-4 sm:p-5">
                <span className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold block mb-1 font-sans">Total Staff</span>
                <div className="text-2xl sm:text-3xl font-black text-slate-900">{counts.total}</div>
              </div>
              <div className="glass rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 text-rose-700">
                <span className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold block mb-1 font-sans">Admins</span>
                <div className="text-2xl sm:text-3xl font-black text-slate-900">{counts.admins}</div>
              </div>
              <div className="glass rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 text-indigo-700">
                <span className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold block mb-1 font-sans">Supervisors</span>
                <div className="text-2xl sm:text-3xl font-black text-slate-900">{counts.supervisors}</div>
              </div>
              <div className="glass rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 text-emerald-700">
                <span className="text-[9px] sm:text-[10px] text-slate-400 uppercase font-bold block mb-1 font-sans">Agents</span>
                <div className="text-2xl sm:text-3xl font-black text-slate-900">{counts.agents}</div>
              </div>
            </div>

            <div className="glass rounded-[28px] sm:rounded-[32px] p-4 sm:p-7 space-y-5">
              <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center border-b border-slate-200/80 pb-4 font-mono">
                <div className="relative w-full sm:w-72">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={`Search staff...`} className="input-glass w-full rounded-xl py-2 pl-9 pr-4 text-xs font-bold text-slate-800 outline-none font-sans" />
                </div>
                <div className="flex gap-2 font-mono">
                  <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input-glass rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer flex-1 sm:flex-initial">
                    <option value="ALL">All Roles</option>
                    <option value="ADMIN">Admin</option>
                    <option value="SUPERVISOR">Supervisor</option>
                    <option value="AGENT">Agent</option>
                  </select>
                  
                  {isSuperAdmin && (
                    <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="input-glass rounded-xl px-3 py-2 text-xs font-bold text-indigo-600 outline-none cursor-pointer flex-1 sm:flex-initial">
                      <option value="ALL">All Projects</option>
                      {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                </div>
              </div>

              {/* ⚡ MOBILE RESPONSIVE SCROLLABLE TABLE */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200/60 font-sans w-full">
                <table className="w-full text-left border-collapse min-w-[650px]">
                  <thead className="bg-slate-50/70 font-mono text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200/60">
                    <tr>
                      <th className="py-3.5 pl-5">User</th>
                      <th className="py-3.5 px-3">Role</th>
                      <th className="py-3.5 px-3">Project</th>
                      <th className="py-3.5 px-3">Status</th>
                      <th className="py-3.5 text-right pr-5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                    {processedUsers.map(u => (
                      <AdminUserRow 
                        key={u.uid || u.id} 
                        user={u} 
                        livePresence={activePresences.get(u.uid || u.id)} 
                        onEdit={() => setEditingUser(u)} 
                        isSuperAdmin={isSuperAdmin} 
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "TENANTS" && isSuperAdmin && (
          <div className="max-w-2xl mx-auto mt-6 animate-in fade-in zoom-in-95 duration-300">
            <ProjectTenantsManagerCard projectsList={projectsList} profile={profile} />
          </div>
        )}
        
        {activeTab === "SETTINGS" && (
          <div className="max-w-2xl mx-auto mt-6 animate-in fade-in zoom-in-95 duration-300">
            <ConfigSettingsCard isSuperAdmin={isSuperAdmin} myProject={myProject} projectsList={projectsList} />
          </div>
        )}
      </main>

      {editingUser && (
        <EditEmployeeModal 
          user={editingUser} 
          projectsList={projectsList} 
          onClose={() => setEditingUser(null)} 
          isSuperAdmin={isSuperAdmin} 
          myProject={myProject} 
        />
      )}
      
      {showProvision && (
        <AdminProvisionModal 
          projectsList={projectsList} 
          onClose={() => setShowProvision(false)} 
          isSuperAdmin={isSuperAdmin} 
          myProject={myProject} 
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// CHILD COMPONENTS FOR ADMIN
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
        id: code, 
        name: code, 
        createdAt: serverTimestamp(), 
        createdBy: profile?.uid || "ADMIN" 
      }, { merge: true }); 
      setNewProj(""); 
    } catch(e) { 
      alert(e.message); 
    } finally { 
      setBusy(false); 
    } 
  };

  const handleRemoveTenant = async (pName) => { 
    if (pName === "GENERAL") return alert("GENERAL protected."); 
    if (!confirm(`Delete project '${pName}'?`)) return; 
    
    setBusy(true); 
    try { 
      await deleteDoc(doc(db, "projects", pName)); 
    } catch(e) { 
      alert(e.message); 
    } finally { 
      setBusy(false); 
    } 
  };

  return (
    <div className="glass rounded-[32px] p-6 sm:p-8 space-y-6 font-sans">
      <div className="border-b border-slate-200/80 pb-3 font-mono font-bold text-xs text-indigo-600">
        <span className="flex items-center gap-2"><FolderPlus size={16}/> Manage Projects</span>
      </div>
      <form onSubmit={handleAddTenant} className="flex gap-2.5">
        <input 
          type="text" 
          required 
          value={newProj} 
          onChange={e => setNewProj(e.target.value.toUpperCase())} 
          placeholder="NEW_PROJECT..." 
          className="input-glass flex-1 rounded-2xl px-4 py-3 text-xs font-mono font-bold text-slate-900 outline-none"
        />
        <button type="submit" disabled={busy} className="btn-glass font-bold px-5 py-3 rounded-2xl text-xs uppercase cursor-pointer">
          Add
        </button>
      </form>
      <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
        {projectsList.map(p => (
          <span key={p} className="inline-flex items-center gap-1.5 bg-white/80 px-3.5 py-1.5 rounded-xl border text-xs font-bold text-slate-700 font-mono">
            <Folder size={12} className="text-indigo-600"/> 
            <span>{p}</span>
            {p !== "GENERAL" && (
              <button type="button" onClick={() => handleRemoveTenant(p)} className="text-slate-400 hover:text-rose-600 ml-1 cursor-pointer">
                <X size={13}/>
              </button>
            )}
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
      if (snap.exists()) setForm(snap.data()); 
      else setForm(DEFAULT_SETTINGS); 
    }); 
    return () => unsub(); 
  }, [targetTenant]);
  
  const handleSaveConfig = async (e) => { 
    e.preventDefault(); 
    setBusy(true); 
    try { 
      await setDoc(doc(db, "project_settings", targetTenant), { 
        ...form, 
        updatedAt: serverTimestamp() 
      }, { merge: true }); 
      setSaved(true); 
      setTimeout(() => setSaved(false), 2500); 
    } catch (err) { 
      alert(err.message); 
    } finally { 
      setBusy(false); 
    } 
  };

  return (
    <div className="glass rounded-[32px] p-6 sm:p-8 space-y-6 font-sans">
      <div className="flex justify-between items-center border-b border-slate-200/80 pb-3 font-mono font-bold text-xs text-indigo-600">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} /> 
          {isSuperAdmin ? (
            <select value={targetTenant} onChange={e => setTargetTenant(e.target.value)} className="bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded text-indigo-700 outline-none cursor-pointer">
              {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <span>{myProject} Rules</span>
          )}
        </div>
        {saved && <span className="text-emerald-700 font-black bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">✓ SAVED</span>}
      </div>
      
      <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-white/60 p-3.5 rounded-2xl border">
            <label className="block text-[10px] font-bold text-slate-400 uppercase font-mono mb-1">Meal Break Min</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} required value={form?.mealBreakMin ?? 40} onChange={e => setForm({...form, mealBreakMin: Number(e.target.value)})} className="w-full bg-transparent font-black text-slate-900 font-mono text-base outline-none" />
            </div>
          </div>
          <div className="bg-white/60 p-3.5 rounded-2xl border">
            <label className="block text-[10px] font-bold text-slate-400 uppercase font-mono mb-1">Short Break Min</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} required value={form?.shortBreakMin ?? 20} onChange={e => setForm({...form, shortBreakMin: Number(e.target.value)})} className="w-full bg-transparent font-black text-slate-900 font-mono text-base outline-none" />
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-indigo-50/50 p-3.5 rounded-2xl border border-indigo-100">
            <label className="block text-[10px] font-bold text-indigo-500 uppercase font-mono mb-1">Start Delay Lock</label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} required value={form?.lockoutStartMin ?? 60} onChange={e => setForm({...form, lockoutStartMin: Number(e.target.value)})} className="w-full bg-transparent font-black text-indigo-700 font-mono text-base outline-none" />
            </div>
            <span className="text-[9px] text-slate-500 block mt-1 font-medium">Blocks breaks after login</span>
          </div>
          <div className="bg-rose-50/50 p-3.5 rounded-2xl border border-rose-100">
            <label className="block text-[10px] font-bold text-rose-500 uppercase font-mono mb-1">End Margin Lock</label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} required value={form?.lockoutEndMin ?? 60} onChange={e => setForm({...form, lockoutEndMin: Number(e.target.value)})} className="w-full bg-transparent font-black text-rose-700 font-mono text-base outline-none" />
            </div>
            <span className="text-[9px] text-slate-500 block mt-1 font-medium">Blocks breaks before logout</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-white/60 p-3.5 rounded-2xl border">
            <label className="block text-[10px] font-bold text-slate-400 uppercase font-mono mb-1">Max Concurrency</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} required value={form?.maxConcurrentBreaks ?? 2} onChange={e => setForm({...form, maxConcurrentBreaks: Number(e.target.value)})} className="w-full bg-transparent font-black text-slate-900 font-mono text-base outline-none" />
            </div>
          </div>
          <div className="bg-white/60 p-3.5 rounded-2xl border">
            <label className="block text-[10px] font-bold text-slate-400 uppercase font-mono mb-1">Shift Span (Hrs)</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} required value={form?.shiftDurationHours ?? 9} onChange={e => setForm({...form, shiftDurationHours: Number(e.target.value)})} className="w-full bg-transparent font-black text-slate-900 font-mono text-base outline-none" />
            </div>
          </div>
        </div>
        
        <button type="submit" disabled={busy} className="btn-glass w-full font-black py-3.5 mt-2 rounded-xl text-xs uppercase cursor-pointer shadow-md active:scale-95">
          Save Settings
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
  const hasShift = !!user.activeShiftId;

  if (livePresence && livePresence.status === "ONLINE") {
    if (user.role === "AGENT") {
      projectedStatus = hasShift ? "AVAILABLE" : "PRE_SHIFT";
    } else {
      projectedStatus = "ONLINE";
    }
    if (livePresence.workMode) effWorkMode = livePresence.workMode;
  } else if (livePresence && livePresence.status !== "OFFLINE") { 
    projectedStatus = livePresence.status; 
    if (livePresence.workMode) effWorkMode = livePresence.workMode; 
  }

  const isActiveDuty = user.role === "AGENT" ? hasShift : (livePresence && livePresence.status !== "OFFLINE");
  const isTargetSuperAdmin = user.role === "SUPER_ADMIN" || (user.role === "ADMIN" && ["ROOT", "ALL", "GENERAL"].includes((user.project || "GENERAL").toUpperCase()));
  const canEdit = isSuperAdmin || !isTargetSuperAdmin;

  const handleReset = async () => { 
    setBusy(true); 
    try { 
      const res = await httpsCallable(functions, "resetPassword")({ targetUid: user.uid || user.id }); 
      setNewPass(res.data?.password); 
    } catch(e) { 
      alert(e.message); 
    } finally { 
      setBusy(false); 
    } 
  };
  
  const handleRemove = async () => { 
    if (!confirm(`Delete ${user.name}?`)) return; 
    setBusy(true); 
    try { 
      await httpsCallable(functions, "deleteUserAccount")({ targetUid: user.uid || user.id }); 
    } catch(e) { 
      alert(e.message); 
    } finally { 
      setBusy(false); 
    } 
  };

  return (
    <tr className="hover:bg-slate-50/80 transition-colors font-sans border-b border-slate-100 last:border-0">
      <td className="py-3.5 pl-5">
        <p className="font-bold text-slate-900 text-xs flex items-center gap-2">
          <span>{user.name}</span> 
          {isActiveDuty && <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-mono font-bold text-[9px] px-1.5 py-0.5 rounded shadow-sm">{effWorkMode}</span>}
        </p>
        <span className="font-mono text-[11px] text-slate-400 font-medium block mt-1">{user.employeeId}</span>
      </td>
      <td className="py-3.5 px-3 font-mono">
        <span className={`px-2.5 py-1 rounded-md border text-[10px] uppercase font-black ${user.role === "SUPER_ADMIN" || user.role === "ADMIN" ? "bg-rose-50 border-rose-200 text-rose-700" : user.role === "SUPERVISOR" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
          {user.role === "SUPER_ADMIN" ? "SUPER ADM" : user.role}
        </span>
      </td>
      <td className="py-3.5 px-3 font-mono font-bold text-indigo-600">{user.project || "GENERAL"}</td>
      <td className="py-3.5 px-3">
        <UserStatusBadge status={projectedStatus} />
      </td>
      <td className="py-3.5 text-right pr-5">
        {canEdit ? (
          <div className="flex items-center justify-end gap-1.5">
            <button onClick={onEdit} className="btn-soft text-slate-600 hover:text-indigo-600 p-2 rounded-xl cursor-pointer">
              <Edit size={14} />
            </button>
            {newPass ? (
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded font-mono font-bold text-xs">{newPass}</span>
            ) : (
              <button disabled={busy} onClick={handleReset} className="btn-soft px-2.5 py-1 rounded-xl font-bold text-xs cursor-pointer">Reset</button>
            )}
            {user.role !== "SUPER_ADMIN" && (
              <button disabled={busy} onClick={handleRemove} className="text-slate-400 hover:text-rose-600 p-2 rounded-xl transition-colors cursor-pointer">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ) : (
          <span className="text-[9px] font-black text-slate-400 font-mono px-2 py-1 bg-slate-50 border rounded">RESTRICTED</span>
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
  const [name, setName] = useState(""); 
  const [phone, setPhone] = useState(""); 
  const [role, setRole] = useState("AGENT"); 
  const [project, setProject] = useState(isSuperAdmin ? (projectsList[0] || "GENERAL") : myProject); 
  const [busy, setBusy] = useState(false); 
  const [spawned, setSpawned] = useState(null);
  
  const submit = async (e) => { 
    e.preventDefault(); 
    setBusy(true); 
    try { 
      const res = await httpsCallable(functions, "createUserAccount")({ 
        name: name.trim(), 
        role, 
        phone: phone.trim(), 
        project 
      }); 
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="glass w-full max-w-md rounded-[32px] p-8 space-y-6 bg-white/95">
        <div className="flex justify-between items-center border-b pb-3 font-mono font-bold text-xs text-indigo-600">
          <span className="flex items-center gap-2"><UserPlus size={16} /> Add New User</span>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        
        {spawned ? (
          <div className="p-6 bg-emerald-50 border rounded-2xl font-mono text-xs space-y-2">
            <div className="font-black text-emerald-800 text-base mb-2">✓ Account Deployed</div>
            <div>ID: <strong>{spawned.employeeId}</strong></div>
            <div>Pass: <strong>{spawned.password}</strong></div>
            <button onClick={onClose} className="btn-glass mt-4 w-full py-3 rounded-xl text-xs font-black uppercase">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-1 font-mono">Full Name</label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs font-bold outline-none font-sans" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1 font-mono">Role</label>
                <select value={role} onChange={e => setRole(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-bold text-indigo-600 outline-none">
                  <option value="AGENT">Agent</option>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="ADMIN">Project Admin</option>
                  {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1 font-mono">Project</label>
                {isSuperAdmin ? (
                  <select value={project} onChange={e => setProject(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-bold text-amber-600 outline-none">
                    {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <div className="w-full rounded-xl p-3 text-xs font-bold text-slate-500 bg-slate-50 border flex items-center justify-between">
                    <Building2 size={12}/>{myProject}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-1 font-mono">WhatsApp Routing</label>
              <input type="text" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91..." className="input-glass w-full rounded-2xl p-3.5 text-xs font-bold outline-none font-sans" />
            </div>
            <button type="submit" disabled={busy} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase cursor-pointer mt-2">
              {busy ? "Creating..." : "Create Account"}
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
    e.preventDefault(); 
    setBusy(true); 
    try { 
      await httpsCallable(functions, "editUserAccount")({ 
        targetUid: user.uid || user.id, 
        name, 
        phone, 
        role, 
        project 
      }); 
      onClose(); 
    } catch (err) { 
      alert(err.message); 
      setBusy(false); 
    } 
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="glass w-full max-w-md rounded-[32px] p-8 space-y-6 bg-white/95">
        <div className="flex justify-between items-center border-b pb-3 font-mono font-bold text-xs text-indigo-600">
          <span className="flex items-center gap-2"><Edit size={16} /> Edit Profile</span>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSaveChanges} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 mb-1 font-mono">Full Name</label>
            <input type="text" required value={name} onChange={e => setName(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs font-bold outline-none font-sans" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-1 font-mono">Role</label>
              <select value={role} onChange={e => setRole(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-bold text-indigo-600 outline-none">
                <option value="AGENT">Agent</option>
                <option value="SUPERVISOR">Supervisor</option>
                <option value="ADMIN">Project Admin</option>
                {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-1 font-mono">Project</label>
              {isSuperAdmin ? (
                <select value={project} onChange={e => setProject(e.target.value)} className="input-glass w-full rounded-xl p-3 text-xs font-bold text-amber-600 outline-none">
                  {projectsList.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <div className="w-full rounded-xl p-3 text-xs font-bold text-slate-500 bg-slate-50 border flex items-center justify-between">
                  <Lock size={12}/>{myProject}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 mb-1 font-mono">WhatsApp Routing</label>
            <input type="text" required value={phone} onChange={e => setPhone(e.target.value)} className="input-glass w-full rounded-2xl p-3.5 text-xs font-bold outline-none font-sans" />
          </div>
          <button type="submit" disabled={busy} className="btn-glass w-full font-black py-4 rounded-2xl text-xs uppercase cursor-pointer mt-2">
            Save Changes
          </button>
        </form>
      </div>
    </div>
  );
}