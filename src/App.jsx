import React from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import AgentConsole from "./pages/AgentConsole";
import SupervisorTower from "./pages/SupervisorTower";
import AdminConsole from "./pages/AdminConsole";
import { Loader2 } from "lucide-react";

function Router() {
  const { currentUser, profile, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950"><Loader2 className="animate-spin text-indigo-400" size={28} /></div>;
  if (!currentUser || !profile) return <LoginPage />;
  switch (profile.role) {
    case "ADMIN": return <AdminConsole />;
    case "SUPERVISOR": return <SupervisorTower />;
    case "AGENT": return <AgentConsole />;
    default: return <LoginPage />;
  }
}

export default function App() {
  return <AuthProvider><Router /></AuthProvider>;
}
