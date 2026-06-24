import React, { useState, useEffect, useMemo } from "react";
import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useHeartbeat, useOnlineRoster } from "../hooks/usePresence";
import { DEFAULT_SETTINGS } from "../utils/constants";
import { 
  UserPlus, LogOut, Copy, Loader2, Settings, Shield, Sliders, Database, CheckCircle2, 
  Users, Search, Trash2, Edit, FolderPlus, Folder, X, Filter 
} from "lucide-react";

export default function AdminConsole() {
  const { profile, logout } = useAuth();
  useHeartbeat(profile?.uid, profile?.name, profile?.role);

  const supervisorsOnline = useOnlineRoster("SUPERVISOR");
  const agentsOnline = useOnlineRoster("AGENT");

  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activePresences, setActivePresences] = useState(new Set());
  
  const [projectsList, setProjectsList] = useState(["GENERAL", "BENTLEY", "FOOTLOCKER"]);
  const [editingUser, setEditingUser] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "presence"), (snap) => {
      const onlineSet = new Set();
      snap.docs.forEach((d) => { if (d.data()?.status === "ONLINE") onlineSet.add(d.id); });
      setActivePresences(onlineSet);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "break_settings", "config"), (snap) => { if (snap.exists()) setSettings(snap.data()); });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "projects"), (snap) => {
      const pArr = snap.docs.map(d => d.id);
      if (!pArr.includes("GENERAL")) pArr.unshift("GENERAL");
      setProjectsList(pArr);
    });
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 pb-24 font-sans selection:bg-indigo-500 selection:text-white relative">
      
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-[#09090b]/90 backdrop-blur-md px-6 py-4 transition-all font-sans">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 border border-zinc-700 text-indigo-400 font-mono font-bold shadow-sm">
              ADM
            </div>
            <div>
              <div className="flex items-center gap-2 font-mono">
                <h1 className="text-base font-bold tracking-wide uppercase text-white font-sans">Admin Headquarters</h1>
                <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-400 border border-indigo-500/20 font-mono">
                  GLOBAL CONTROL
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 font-sans">
                Administrator: <strong className="text-zinc-200">{profile?.name}</strong> ({profile?.employeeId})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono">
            <div className="flex items-center gap-3 bg-zinc-950 px-3.5 py-2 rounded-xl border border-zinc-800 text-xs text-zinc-400 shadow-inner font-sans">
              <span>{supervisorsOnline.length} Sup Online</span>
              <span className="text-zinc-700">|</span>
              <span>{agentsOnline.length} Agt Online</span>
            </div>
            <button onClick={logout} className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all active:scale-95 cursor-pointer font-sans">
              <LogOut size={13} /> Log Out
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-zinc-800/60 bg-zinc-950/60 py-2.5 px-6 font-mono text-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-zinc-400">
          <span>Active Tenants: <strong className="text-amber-400">{projectsList.length} Fences</strong></span>
          <span>Matrix Filter: <strong className="text-emerald-400 font-bold">2-WAY TENANT INTERSECT</strong></span>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 mt-8 font-sans">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          
          <div className="space-y-8 lg:col-span-5 font-sans">
            <ProjectTenantsManagerCard projectsList={projectsList} profile={profile} />
            <OnboardSection projectsList={projectsList} />
            <ConfigSection currentSettings={settings} />
          </div>

          <div className="lg:col-span-7 font-sans">
            <RosterSection users={users} livePresences={activePresences} projectsList={projectsList} onEditEmployee={(u) => setEditingUser(u)} />
          </div>

        </div>
      </main>

      {editingUser && (
        <EditEmployeeModal user={editingUser} projectsList={projectsList} onClose={() => setEditingUser(null)} />
      )}

    </div>
  );
}

// ⚡ 1. HYBRID DIRECT-STAMP PROJECT MANAGER (Never fails!)
function ProjectTenantsManagerCard({ projectsList, profile }) {
  const [newProj, setNewProj] = useState(""); const [busy, setBusy] = useState(false);

  const handleAddTenant = async (e) => {
    e.preventDefault(); 
    const code = newProj.trim().toUpperCase();
    if (!code) return; 
    setBusy(true);

    try {
      // ⚡ HYBRID OVERRIDE: Directly stamp Firestore! Bypasses Cloud Run sleep timeouts.
      await setDoc(doc(db, "projects", code), { 
        id: code, name: code, 
        createdAt: serverTimestamp(), createdBy: profile?.uid || "ADMIN" 
      }, { merge: true });

      setNewProj("");
    } catch (err) { alert("Project stamp failed: " + err.message); } finally { setBusy(false); }
  };

  const handleRemoveTenant = async (pName) => {
    if (pName === "GENERAL") return alert("GENERAL tenant is system protected.");
    if (!confirm(`Permanently purge Project Tenant '${pName}'?`)) return;
    setBusy(true);
    try { await deleteDoc(doc(db, "projects", pName)); } 
    catch (err) { alert("Delete failed: " + err.message); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-xl font-sans">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-5 font-mono">
        <div className="flex items-center gap-2"><FolderPlus size={16} className="text-cyan-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-white">Manage Project Tenants</h2></div>
        <span className="text-[10px] text-emerald-400 font-bold uppercase bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">Direct Stamp</span>
      </div>

      <form onSubmit={handleAddTenant} className="flex gap-2 mb-4">
        <input type="text" required value={newProj} onChange={e => setNewProj(e.target.value.toUpperCase())} placeholder="NEW_PROJECT_CODE..." className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-cyan-300 font-mono font-bold outline-none focus:border-indigo-500"/>
        <button type="submit" disabled={busy} className="bg-cyan-500 hover:bg-cyan-400 text-black font-black px-4 py-2.5 rounded-xl text-xs uppercase cursor-pointer transition-all active:scale-95 disabled:opacity-50">
          {busy ? "..." : "Add"}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
        {projectsList.map(p => (
          <span key={p} className="inline-flex items-center gap-1 bg-zinc-950 pl-2.5 pr-2 py-1 rounded-lg border border-zinc-800 text-xs font-bold text-zinc-300 font-mono">
            <Folder size={11} className="text-indigo-400" /> <span>{p}</span>
            {p !== "GENERAL" && (
              <button type="button" onClick={() => handleRemoveTenant(p)} className="text-zinc-500 hover:text-rose-400 ml-1 cursor-pointer"><X size={12} /></button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function OnboardSection({ projectsList }) {
  const [name, setName] = useState(""); const [role, setRole] = useState("AGENT"); 
  const [phone, setPhone] = useState(""); const [project, setProject] = useState("GENERAL");
  const [busy, setBusy] = useState(false); const [spawned, setSpawned] = useState(null); const [err, setErr] = useState(null);

  const handleOnboard = async (e) => {
    e.preventDefault(); if (!name || !phone) return; setBusy(true); setErr(null); setSpawned(null);
    try {
      const res = await httpsCallable(functions, "createUserAccount")({ name: name.trim(), role, phone: phone.trim(), project });
      setSpawned(res.data); setName(""); setPhone("");
    } catch (error) { setErr(error.message || "Failed to create user."); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-6 font-mono"><div className="flex items-center gap-2"><UserPlus size={15} className="text-indigo-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-white">Add Personnel</h2></div><span className="text-[10px] text-zinc-500 uppercase font-medium">Tenant Spawner</span></div>

      <form onSubmit={handleOnboard} className="space-y-4 font-mono">
        <div><label className="block text-[11px] text-zinc-400 mb-1 font-sans">Full Display Name</label><input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tanvi Sharma" className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-sans" /></div>
        <div className="grid grid-cols-2 gap-3.5 font-sans">
          <div><label className="block text-[11px] text-zinc-400 mb-1 font-sans">Clearance Role</label><select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs font-bold text-indigo-300 focus:outline-none focus:border-indigo-500 cursor-pointer font-sans"><option value="AGENT">Shift Agent</option><option value="SUPERVISOR">Supervisor</option><option value="ADMIN" className="text-rose-400 font-bold">Administrator</option></select></div>
          <div><label className="block text-[11px] text-zinc-400 mb-1 font-sans">Assign Project</label><select value={project} onChange={(e) => setProject(e.target.value)} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs font-mono font-bold text-amber-400 focus:outline-none focus:border-indigo-500 cursor-pointer font-sans">{projectsList.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
        </div>
        <div><label className="block text-[11px] text-zinc-400 mb-1 font-sans">WhatsApp Number (E.164)</label><input type="text" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-sans" /></div>
        {err && <div className="rounded-xl border border-rose-800/50 bg-rose-950/30 p-3 text-center"><p className="text-xs text-rose-400 font-sans">{err}</p></div>}
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white transition-all disabled:opacity-50 cursor-pointer shadow-md font-sans">{busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} <span>{busy ? "Provisioning..." : "Onboard User"}</span></button>
      </form>
    </div>
  );
}

function ConfigSection({ currentSettings }) {
  const [form, setForm] = useState(currentSettings); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  useEffect(() => { setForm(currentSettings); }, [currentSettings]);
  const handleSave = async () => { setBusy(true); setSaved(false); try { await setDoc(doc(db, "break_settings", "config"), { ...form, updatedAt: serverTimestamp() }, { merge: true }); setSaved(true); setTimeout(() => setSaved(false), 3500); } finally { setBusy(false); } };
  return (<div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-xl space-y-4 font-mono"><div className="flex items-center justify-between border-b border-zinc-800 pb-4"><div className="flex items-center gap-2"><Sliders size={14} className="text-indigo-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-white font-sans">System Settings</h2></div>{saved ? <span className="text-[10px] font-bold text-emerald-400">✓ SAVED</span> : <span className="text-[10px] text-zinc-500 uppercase">Global</span>}</div><button type="button" disabled={busy} onClick={handleSave} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl text-xs uppercase cursor-pointer">Save Settings</button></div>);
}

// ⚡ 3. THE MATRIX ROSTER SECTION (Role x Tenant Filter!)
function RosterSection({ users, livePresences, projectsList, onEditEmployee }) {
  const [activeTab, setActiveTab] = useState("AGENT"); 
  const [selectedTenant, setSelectedTenant] = useState("ALL"); // "ALL", "GENERAL", "BENTLEY"...
  const [search, setSearch] = useState("");

  const roleCounts = useMemo(() => ({ AGENT: users.filter(u => u.role === "AGENT").length, SUPERVISOR: users.filter(u => u.role === "SUPERVISOR").length, ADMIN: users.filter(u => u.role === "ADMIN").length }), [users]);

  // ⚡ THE 2-WAY MATRIX INTERSECT FILTER
  const displayedUsers = useMemo(() => {
    return users
      .filter(u => u.role === activeTab)
      .filter(u => selectedTenant === "ALL" || (u.project || "GENERAL").toUpperCase() === selectedTenant.toUpperCase())
      .filter(u => {
        if (!search) return true;
        const q = search.toLowerCase();
        return u.name?.toLowerCase().includes(q) || u.employeeId?.toLowerCase().includes(q) || u.project?.toLowerCase().includes(q);
      });
  }, [users, activeTab, selectedTenant, search]);

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-7 shadow-xl font-sans space-y-5">
      
      {/* Top Row: Role Tabs */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-zinc-800 pb-5">
        <div className="flex items-center gap-2.5 font-mono"><Database size={15} className="text-indigo-400" /><h2 className="text-xs font-bold uppercase tracking-wider text-white">Workforce Directory</h2></div>
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 font-mono text-xs">
          <TabButton active={activeTab === "AGENT"} onClick={() => { setActiveTab("AGENT"); }} label={`Agents (${roleCounts.AGENT})`} />
          <TabButton active={activeTab === "SUPERVISOR"} onClick={() => { setActiveTab("SUPERVISOR"); }} label={`Supervisors (${roleCounts.SUPERVISOR})`} />
          <TabButton active={activeTab === "ADMIN"} onClick={() => { setActiveTab("ADMIN"); }} label={`Admins (${roleCounts.ADMIN})`} />
        </div>
      </div>

      {/* ⚡ Second Row: TENANT DROPDOWN + SEARCH BAR */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 font-mono">
        <div className="sm:col-span-5 flex items-center gap-2 bg-zinc-950 px-3 py-2 rounded-xl border border-zinc-800">
          <Filter size={13} className="text-amber-400 shrink-0" />
          <select 
            value={selectedTenant} onChange={e => setSelectedTenant(e.target.value)}
            className="w-full bg-transparent text-xs font-bold text-amber-400 outline-none cursor-pointer"
          >
            <option value="ALL" className="bg-zinc-900 text-zinc-200">🌍 ALL TENANTS</option>
            {projectsList.map(p => <option key={p} value={p} className="bg-zinc-900 text-zinc-200">{p}</option>)}
          </select>
        </div>

        <div className="sm:col-span-7 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
          <input 
            type="text" value={search} onChange={(e) => setSearch(e.target.value)} 
            placeholder={`Search ${selectedTenant === "ALL" ? "" : selectedTenant} ${activeTab.toLowerCase()}s...`}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 pl-9 pr-4 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500 font-sans"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/60 shadow-inner">
        <table className="w-full text-left border-collapse font-sans">
          <thead className="border-b border-zinc-800 bg-zinc-900/60 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            <tr><th className="py-3.5 pl-5 pr-3">Employee</th><th className="py-3.5 px-3">Project Tenant</th><th className="py-3.5 px-3">Live Status</th><th className="py-3.5 pl-3 pr-5 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 text-xs font-medium text-zinc-300">
            {displayedUsers.length === 0 ? (
              <tr><td colSpan={4} className="py-12 text-center text-zinc-600 font-mono">No {selectedTenant === "ALL" ? "" : selectedTenant} {activeTab.toLowerCase()} records found.</td></tr>
            ) : (
              displayedUsers.map((u) => <UserRow key={u.id} user={u} isLiveOnline={livePresences.has(u.uid || u.id)} onEdit={() => onEditEmployee(u)} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label }) {
  const activeCls = active ? "bg-indigo-600 text-white font-bold border-indigo-500 shadow-sm" : "text-zinc-500 hover:text-zinc-300 border-transparent font-normal";
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer font-sans ${activeCls}`}>{label}</button>;
}

function UserRow({ user, isLiveOnline, onEdit }) {
  const [busy, setBusy] = useState(false); const [newPass, setNewPass] = useState(null);
  const handleReset = async () => { if (!confirm(`Reset password for ${user.name}?`)) return; setBusy(true); setNewPass(null); try { const res = await httpsCallable(functions, "resetPassword")({ targetUid: user.uid }); setNewPass(res.data.password); } finally { setBusy(false); } };
  const handleRemove = async () => { if (!confirm(`Permanently delete ${user.name}?`)) return; setBusy(true); try { await httpsCallable(functions, "deleteUserAccount")({ targetUid: user.uid }); } catch (e) { alert("Delete failed: " + e.message); setBusy(false); } };

  let projectedStatus = user.status || "OFFLINE";
  if (isLiveOnline && projectedStatus === "OFFLINE") projectedStatus = user.role === "AGENT" ? "AVAILABLE" : "ONLINE";
  else if (!isLiveOnline) projectedStatus = "OFFLINE";

  return (
    <tr className="hover:bg-zinc-900/50 transition-colors font-sans">
      <td className="py-3.5 pl-5 pr-3"><p className="font-bold text-white text-xs font-sans">{user.name}</p><span className="font-mono text-[11px] text-indigo-400 font-bold block">{user.employeeId} <span className="text-zinc-600 font-sans font-normal">· {user.phone}</span></span></td>
      <td className="py-3.5 px-3 font-mono font-bold text-amber-400">{user.project || "GENERAL"}</td>
      <td className="py-3.5 px-3 font-sans"><UserStatusBadge status={projectedStatus} /></td>
      <td className="py-3.5 pl-3 pr-5 text-right font-sans">
        <div className="flex items-center justify-end gap-1 font-sans">
          <button onClick={onEdit} className="bg-zinc-800 hover:bg-indigo-600 hover:text-white text-zinc-300 p-1.5 rounded cursor-pointer transition-all active:scale-95" title="Edit Profile"><Edit size={13} /></button>
          {newPass ? <span className="bg-zinc-900 px-2 py-1 rounded border border-emerald-500 text-emerald-400 font-mono font-bold text-xs">{newPass}</span> : <button disabled={busy} onClick={handleReset} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2.5 py-1 rounded cursor-pointer text-xs font-medium transition-all active:scale-95 font-sans">Reset</button>}
          {user.role !== "ADMIN" && <button disabled={busy} onClick={handleRemove} className="bg-rose-500/10 hover:bg-rose-600 hover:text-white text-rose-400 border border-rose-500/30 p-1.5 rounded cursor-pointer transition-all active:scale-95 ml-0.5"><Trash2 size={13} /></button>}
        </div>
      </td>
    </tr>
  );
}

function UserStatusBadge({ status }) {
  const map = { ONLINE: { text: "Online", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" }, AVAILABLE: { text: "Available", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-semibold" }, IN_QUEUE: { text: "In Queue", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" }, ON_BREAK: { text: "On Break", cls: "bg-amber-400/15 text-amber-300 border-amber-400/40 animate-pulse font-bold" }, BREAK_EXCEEDED: { text: "Over Limit", cls: "bg-rose-500/20 text-rose-400 border-rose-500/40 animate-bounce font-black" }, OFFLINE: { text: "Offline", cls: "bg-zinc-800/40 text-zinc-500 border-zinc-700/50 font-normal" } };
  const b = map[status] || map.OFFLINE;
  return <span className={`px-2 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider inline-block ${b.cls}`}>{b.text}</span>;
}

function EditEmployeeModal({ user, projectsList, onClose }) {
  const [name, setName] = useState(user?.name || ""); const [phone, setPhone] = useState(user?.phone || "");
  const [role, setRole] = useState(user?.role || "AGENT"); const [project, setProject] = useState(user?.project || "GENERAL");
  const [busy, setBusy] = useState(false);

  const handleSaveChanges = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await httpsCallable(functions, "editUserAccount")({ targetUid: user.uid || user.id, name, phone, role, project }); onClose(); } 
    catch (err) { alert("Profile mutation failed: " + err.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 font-sans animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl space-y-5"><div className="flex items-center justify-between border-b border-zinc-800 pb-3.5 font-mono"><div className="flex items-center gap-2 text-indigo-400 font-bold text-sm"><Edit size={16} /> <span className="font-sans">Edit Profile</span></div><button onClick={onClose} className="text-zinc-500 hover:text-white cursor-pointer"><X size={16}/></button></div><div className="bg-zinc-950 px-3.5 py-2.5 rounded-xl border border-zinc-800 font-mono text-xs flex justify-between text-zinc-400"><span>ID: <strong className="text-indigo-300">{user.employeeId}</strong></span><span>Tenant: <strong className="text-amber-400">{user.project || "GENERAL"}</strong></span></div><form onSubmit={handleSaveChanges} className="space-y-4 font-sans"><div><label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 font-mono">Display Name</label><input type="text" required value={name} onChange={e => setName(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-bold outline-none focus:border-indigo-500 font-sans"/></div><div className="grid grid-cols-2 gap-3.5 font-sans"><div><label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 font-mono">Clearance</label><select value={role} onChange={e => setRole(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-bold text-indigo-300 outline-none focus:border-indigo-500 cursor-pointer font-sans"><option value="AGENT">Shift Agent</option><option value="SUPERVISOR">Supervisor</option><option value="ADMIN">Administrator</option></select></div><div><label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 font-mono">Tenant</label><select value={project} onChange={e => setProject(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-amber-400 outline-none focus:border-indigo-500 cursor-pointer font-sans">{projectsList.map(p => <option key={p} value={p}>{p}</option>)}</select></div></div><div><label className="block text-[10px] font-bold uppercase text-zinc-400 mb-1 font-mono">WhatsApp (E.164)</label><input type="text" required value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-bold outline-none focus:border-indigo-500 font-sans"/></div><div className="pt-2"><button type="submit" disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 font-sans">{busy ? "Updating..." : "Save Profile Changes"}</button></div></form></div>
    </div>
  );
}