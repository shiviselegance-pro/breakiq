import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, serverTimestamp, where } from "firebase/firestore";
import { db } from "../firebase";

const HEARTBEAT_MS = 25_000;
const STALE_AFTER_MS = 70_000;

export function useHeartbeat(uid, name, role) {
  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, "presence", uid);
    const beat = () => setDoc(ref, { uid, name, role, status: "ONLINE", lastHeartbeatAt: serverTimestamp() }, { merge: true });
    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [uid, name, role]);
}

export function useOnlineRoster(role) {
  const [roster, setRoster] = useState([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const q = query(collection(db, "presence"), where("role", "==", role));
    const unsub = onSnapshot(q, (snap) => setRoster(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [role]);
  return roster.map((p) => {
    const lastBeat = p.lastHeartbeatAt?.toMillis ? p.lastHeartbeatAt.toMillis() : 0;
    return { ...p, isOnline: p.status === "ONLINE" && now - lastBeat < STALE_AFTER_MS };
  }).filter((p) => p.isOnline);
}
