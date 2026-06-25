import React, { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import AgentConsole from "./pages/AgentConsole";
import SupervisorTower from "./pages/SupervisorTower";
import AdminConsole from "./pages/AdminConsole";
import { Loader2, Home, Building2 } from "lucide-react";

function PerimeterGate({ profile, todayStr }) {
  const [stamping, setStamping] = useState(false);
  const handleStampPerimeter = async (mode) => {
    setStamping(true);
    try {
      const targetUid = profile.uid || profile.id;
      await setDoc(doc(db, "users", targetUid), { workMode: mode, workModeDate: todayStr }, { merge: true });
      await setDoc(doc(db, "presence", targetUid), { workMode: mode, status: "ONLINE", lastActive: Date.now(), role: profile.role, name: profile.name, project: profile.project || "GENERAL" }, { merge: true });
    } catch (err) { alert("Perimeter stamp failed: " + err.message); setStamping(false); }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-6 font-sans selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      <div className="mesh-bg"><span className="mesh-orb" /></div>
      <div className="glass relative z-10 w-full max-w-md rounded-[32px] p-8 text-center space-y-6 animate-in zoom-in-95 duration-300">
        <div className="inline-flex p-4 bg-amber-50 rounded-2xl text-amber-600 border border-amber-200/80 shadow-inner animate-bounce"><Home size={28} /></div>
        <div className="space-y-2"><span className="text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-200">Step 2 · Security Perimeter</span><h2 className="text-2xl font-black text-slate-900 tracking-tight">Operational Declaration</h2><p className="text-xs text-slate-500 font-medium leading-relaxed max-w-xs mx-auto">Welcome <strong className="text-slate-700">{profile.name}</strong>. Please select your operational base for today ({todayStr}):</p></div>
        <div className="grid grid-cols-2 gap-3 pt-2 font-mono">
          <button onClick={() => handleStampPerimeter("WFH")} disabled={stamping} className="p-5 rounded-2xl border border-indigo-200/80 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 font-black transition-all flex flex-col items-center gap-2.5 cursor-pointer shadow-sm group active:scale-95 disabled:opacity-50"><Home size={22} className="group-hover:scale-110 transition-transform text-indigo-600" /><span>🏠 WFH (Home)</span></button>
          <button onClick={() => handleStampPerimeter("WFO")} disabled={stamping} className="p-5 rounded-2xl border border-slate-200/80 bg-white/80 hover:bg-white text-slate-800 font-black transition-all flex flex-col items-center gap-2.5 cursor-pointer shadow-sm group active:scale-95 disabled:opacity-50"><Building2 size={22} className="group-hover:scale-110 transition-transform text-slate-600" /><span>🏢 WFO (Office)</span></button>
        </div>
        {stamping && <p className="text-xs font-mono font-bold text-indigo-600 animate-pulse flex items-center justify-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Stamping operational perimeter...</p>}
      </div>
    </div>
  );
}

function Router() {
  const { currentUser, profile, loading } = useAuth();
  
  // ⚡ CRASH FIX: Waits until Profile payload strictly arrives from Firestore before routing!
  if (loading || (currentUser && !profile)) {
    return <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>;
  }
  if (!currentUser) return <LoginPage />;

  const todayStr = new Date().toDateString();
  const isOperator = profile.role === "AGENT" || profile.role === "SUPERVISOR";
  const needsPerimeterStamp = isOperator && (!profile.workMode || profile.workModeDate !== todayStr);

  if (needsPerimeterStamp) return <PerimeterGate profile={profile} todayStr={todayStr} />;

  switch (profile.role) {
    case "SUPER_ADMIN":
    case "ADMIN": return <AdminConsole />;
    case "SUPERVISOR": return <SupervisorTower />;
    case "AGENT": return <AgentConsole />;
    default: return <LoginPage />;
  }
}

export default function App() { return <AuthProvider><Router /></AuthProvider>; }