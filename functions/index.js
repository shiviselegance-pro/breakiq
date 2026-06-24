const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendWhatsAppText } = require("./whatsapp");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN");
const ORG_DOMAIN = "breakapp.internal";

const DEFAULT_SETTINGS = {
  shiftDurationHours: 9, mealBreakMin: 40, shortBreakMin: 20,
  lockoutStartMin: 60, lockoutEndMin: 60, maxConcurrentBreaks: 2,
  alertMode: "INDIVIDUAL", supervisorBroadcastNumbers: [],
  emergencyLockout: false, emergencyReason: null,
};

// ============================================================================
// INTERNAL SYSTEM HELPERS
// ============================================================================

function assertAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Strict IAM sign-in required.");
  return request.auth.uid;
}
async function getSettings() {
  const snap = await db.doc("break_settings/config").get();
  return { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) };
}
async function getUserDoc(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "User directory record missing.");
  return { id: snap.id, ...snap.data() };
}
function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw new HttpsError("permission-denied", `Action restricted. Required clearance: ${roles.join(", ")}`);
}
async function nextSeq(counterPath, field = "value") {
  const ref = db.doc(counterPath);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data()[field] || 0 : 0;
    const next = current + 1;
    tx.set(ref, { [field]: next }, { merge: true });
    return next;
  });
}
function genPassword(length = 10) {
  const charset = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = ""; for (let i = 0; i < length; i++) out += charset[Math.floor(Math.random() * charset.length)];
  return out;
}
function bumpBudget(budget, category, minutes) {
  if (category === "MEAL") return { ...budget, mealUsedMin: budget.mealUsedMin + minutes };
  return { ...budget, shortUsedMin: budget.shortUsedMin + minutes };
}
function windowCheck(shift, settings, atMillis) {
  const opensAt = shift.shiftStart.toMillis() + settings.lockoutStartMin * 60000;
  const closesAt = shift.shiftEnd.toMillis() - settings.lockoutEndMin * 60000;
  if (atMillis < opensAt) return { ok: false, reason: "TOO_EARLY", unlocksAtMillis: opensAt };
  if (atMillis > closesAt) return { ok: false, reason: "TOO_LATE" };
  return { ok: true };
}

// ============================================================================
// 1. MULTI-TENANT WORKFORCE PROVISIONING, EDITING & NUCLEAR PURGE
// ============================================================================

exports.createUserAccount = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  const { name, role, phone, project } = request.data || {};
  
  if (!name || !phone || !["AGENT", "SUPERVISOR", "ADMIN"].includes(role)) {
    throw new HttpsError("invalid-argument", "Malformed onboarding payload.");
  }
  
  let assignedProject = (project || "GENERAL").trim().toUpperCase();

  if (role === "ADMIN") requireRole(caller, ["ADMIN"]);
  else requireRole(caller, ["ADMIN", "SUPERVISOR"]);

  // Zero-Trust Fence: Supervisors force-spawn agents strictly into their own project tenant
  if (caller.role === "SUPERVISOR") {
    if (role !== "AGENT") throw new HttpsError("permission-denied", "Supervisors exclusively onboard Shift Agents.");
    assignedProject = (caller.project || "GENERAL").trim().toUpperCase();
  }

  const prefix = role === "AGENT" ? "AGT" : role === "SUPERVISOR" ? "SUP" : "ADM";
  const seq = await nextSeq("counters/employeeId", prefix);
  const employeeId = `${prefix}-${String(seq).padStart(4, "0")}`;
  const password = genPassword();
  const email = `${employeeId.toLowerCase()}@${ORG_DOMAIN}`;

  const authUser = await admin.auth().createUser({ email, password, displayName: name.trim() });
  await admin.auth().setCustomUserClaims(authUser.uid, { role, project: assignedProject });
  
  await db.doc(`users/${authUser.uid}`).set({
    uid: authUser.uid, employeeId, name: name.trim(), role, phone: phone.trim(),
    project: assignedProject, active: true, status: "OFFLINE",
    activeShiftId: null, activeBreakId: null,
    createdAt: FieldValue.serverTimestamp(), createdBy: callerUid,
  });

  return { uid: authUser.uid, employeeId, password, project: assignedProject };
});

exports.editUserAccount = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN"]); 

  const { targetUid, name, role, phone, project } = request.data || {};
  if (!targetUid) throw new HttpsError("invalid-argument", "Missing target identifier.");

  const target = await getUserDoc(targetUid);
  const assignedProject = project ? project.trim().toUpperCase() : target.project;
  const assignedRole = role || target.role;

  if (name) await admin.auth().updateUser(targetUid, { displayName: name.trim() });
  
  if (role || project) {
    await admin.auth().setCustomUserClaims(targetUid, {
      role: assignedRole, project: assignedProject
    });
  }

  const updates = { updatedAt: FieldValue.serverTimestamp(), updatedBy: callerUid };
  if (name) updates.name = name.trim();
  if (phone) updates.phone = phone.trim();
  if (role) updates.role = assignedRole;
  if (project) updates.project = assignedProject;

  await db.doc(`users/${targetUid}`).set(updates, { merge: true });
  return { ok: true, updatedId: targetUid };
});

exports.deleteUserAccount = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPERVISOR"]);

  const { targetUid } = request.data || {};
  if (!targetUid) throw new HttpsError("invalid-argument", "Target identifier required.");
  
  const target = await getUserDoc(targetUid);
  if (target.role === "ADMIN") throw new HttpsError("permission-denied", "Root Administrators cannot be deleted remotely.");

  if (caller.role === "SUPERVISOR") {
    if (target.role !== "AGENT" || target.project !== caller.project) {
      throw new HttpsError("permission-denied", "Clearance strictly fenced inside your project tenant.");
    }
  }

  await admin.auth().deleteUser(targetUid);
  await db.doc(`users/${targetUid}`).delete();
  await db.doc(`presence/${targetUid}`).delete().catch(() => {});

  return { ok: true, removedId: target.employeeId };
});

exports.mutateProjectTenant = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN"]);

  const { action, projectName } = request.data || {};
  const pName = (projectName || "").trim().toUpperCase();
  if (!pName) throw new HttpsError("invalid-argument", "Project tenant name required.");

  if (action === "ADD") {
    await db.doc(`projects/${pName}`).set({ id: pName, name: pName, createdAt: FieldValue.serverTimestamp(), createdBy: callerUid });
  } else if (action === "REMOVE") {
    if (pName === "GENERAL") throw new HttpsError("permission-denied", "Default GENERAL tenant is protected.");
    await db.doc(`projects/${pName}`).delete();
  }
  return { ok: true, tenant: pName };
});

exports.resetPassword = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPERVISOR"]);
  const { targetUid } = request.data || {};
  const target = await getUserDoc(targetUid);
  if (caller.role === "SUPERVISOR" && (target.role !== "AGENT" || target.project !== caller.project)) {
    throw new HttpsError("permission-denied", "Restricted strictly to your project tenant.");
  }
  const password = genPassword();
  await admin.auth().updateUser(targetUid, { password });
  return { password };
});

// ⚡ AGENT SELF-PASSPHRASE MUTATOR (Bypasses 'recent-login-required' challenge)
exports.agentUpdateOwnPassword = onCall(async (request) => {
  const uid = assertAuth(request);
  const { newPass } = request.data || {};
  if (!newPass || newPass.length < 6) throw new HttpsError("invalid-argument", "Passphrase must be at least 6 characters.");
  
  await admin.auth().updateUser(uid, { password: newPass });
  return { ok: true };
});

exports.setUserActive = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN"]);
  const { targetUid, active } = request.data || {};
  await admin.auth().updateUser(targetUid, { disabled: !active });
  await db.doc(`users/${targetUid}`).set({ active: !!active }, { merge: true });
  return { ok: true };
});

// ============================================================================
// 2. SHIFT ATTENDANCE & OUTAGE PAUSE MODE
// ============================================================================

exports.startShift = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (user.role !== "AGENT") throw new HttpsError("failed-precondition", "Exclusively agents hold active shift horizons.");
  if (!user.active) throw new HttpsError("permission-denied", "Account disabled.");

  const settings = await getSettings();
  const now = Timestamp.now();

  if (user.activeShiftId) {
    const existing = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
    if (existing.exists && existing.data().status === "ON_SHIFT" && existing.data().shiftEnd.toMillis() > now.toMillis()) {
      await db.doc(`users/${uid}`).set({ status: "AVAILABLE" }, { merge: true });
      return { shiftId: user.activeShiftId, resumed: true };
    }
  }

  const shiftId = `${uid}_${now.toMillis()}`;
  const shiftEnd = Timestamp.fromMillis(now.toMillis() + settings.shiftDurationHours * 3600 * 1000);
  await db.doc(`shift_sessions/${shiftId}`).set({
    uid, employeeId: user.employeeId, name: user.name, project: user.project || "GENERAL",
    shiftStart: now, shiftEnd, loginAt: now, logoutAt: null, status: "ON_SHIFT",
    breakBudget: { mealUsedMin: 0, shortUsedMin: 0, mealTotalMin: settings.mealBreakMin, shortTotalMin: settings.shortBreakMin },
  });
  await db.doc(`users/${uid}`).set({ activeShiftId: shiftId, status: "AVAILABLE" }, { merge: true });
  return { shiftId, resumed: false };
});

exports.endShiftLogout = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (user.activeShiftId) await db.doc(`shift_sessions/${user.activeShiftId}`).set({ status: "OFF_SHIFT", logoutAt: Timestamp.now() }, { merge: true });
  await db.doc(`users/${uid}`).set({ status: "OFFLINE", activeBreakId: null }, { merge: true });
  return { ok: true };
});

exports.toggleEmergencyLockout = onCall(async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPERVISOR"]);
  const { locked, reason } = request.data || {};
  await db.doc("break_settings/config").set({ emergencyLockout: !!locked, emergencyReason: locked ? (reason || "P1 Outage Active - Breaks Paused") : null }, { merge: true });
  return { ok: true };
});

// ============================================================================
// 3. FIFO QUEUE ENGINE & BREAK MUTATORS (STRICT RAM READ-FIRST ORDERING)
// ============================================================================

exports.requestBreakNow = onCall(async (request) => {
  const uid = assertAuth(request);
  const { category, minutesNow, targetUid } = request.data || {};
  const effectiveUid = targetUid || uid;
  if (!["MEAL", "SHORT"].includes(category)) throw new HttpsError("invalid-argument", "Invalid category.");

  const settings = await getSettings();
  if (settings.emergencyLockout) throw new HttpsError("failed-precondition", `🚨 FLOOR FROZEN: ${settings.emergencyReason}.`);

  const user = await getUserDoc(effectiveUid);
  if (!user.activeShiftId) throw new HttpsError("failed-precondition", "Shift inactive.");
  const shiftSnap = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
  const shift = { id: shiftSnap.id, ...shiftSnap.data() };

  if (user.activeBreakId) throw new HttpsError("already-exists", "Active break session ongoing.");
  const now = Timestamp.now();
  const w = windowCheck(shift, settings, now.toMillis());
  if (!w.ok) throw new HttpsError("failed-precondition", "Break window closed by standard WFM policy.");

  const budget = shift.breakBudget;
  let minutesToUse;
  if (category === "MEAL") {
    if (budget.mealUsedMin > 0) throw new HttpsError("already-exists", "Meal break already completed.");
    minutesToUse = budget.mealTotalMin;
  } else {
    const shortRemaining = budget.shortTotalMin - budget.shortUsedMin;
    if (shortRemaining <= 0) throw new HttpsError("failed-precondition", "Short break bank exhausted.");
    minutesToUse = Math.min(Math.max(1, Math.round(minutesNow || shortRemaining)), shortRemaining);
  }

  let suggestedTimeMillis = null;
  const activeSnap = await db.collection("break_sessions").where("status", "==", "ON_BREAK").orderBy("expectedEndAt", "asc").limit(1).get();
  if (!activeSnap.empty) suggestedTimeMillis = activeSnap.docs[0].data().expectedEndAt.toMillis();

  const breakRef = db.collection("break_sessions").doc();
  const aggRef = db.doc("break_aggregates/live");
  const shiftRef = db.doc(`shift_sessions/${shift.id}`);
  const userRef = db.doc(`users/${effectiveUid}`);

  const res = await db.runTransaction(async (tx) => {
    const [aggSnap, sSnap] = await Promise.all([tx.get(aggRef), tx.get(shiftRef)]);
    const agg = aggSnap.exists ? aggSnap.data() : { activeCount: 0, queueLength: 0 };
    const base = {
      uid: effectiveUid, employeeId: user.employeeId, agentName: user.name, project: user.project || "GENERAL", shiftId: shift.id,
      breakCategory: category, requestedDurationMin: minutesToUse, mode: "NOW", requestedAt: now, scheduledFor: null,
      notifiedReady: false, readyToStart: false, breakEndedAt: null, actualMinutesUsed: null, exceeded: false, wasForceEnded: false, forceEndedBy: null,
    };

    if (agg.activeCount < settings.maxConcurrentBreaks) {
      tx.set(breakRef, { ...base, status: "ON_BREAK", breakStartedAt: now, expectedEndAt: Timestamp.fromMillis(now.toMillis() + minutesToUse * 60000), queueSeq: null, suggestedTime: null });
      tx.set(aggRef, { activeCount: (Number(agg.activeCount) || 0) + 1, queueLength: Number(agg.queueLength) || 0 });
      tx.set(shiftRef, { breakBudget: bumpBudget(sSnap.data().breakBudget, category, minutesToUse) }, { merge: true });
      tx.set(userRef, { status: "ON_BREAK", activeBreakId: breakRef.id }, { merge: true });
      return { status: "ON_BREAK" };
    }
    return { status: "QUEUE" };
  });

  if (res.status === "ON_BREAK") return { status: "ON_BREAK", breakId: breakRef.id };

  const seq = await nextSeq("counters/queueSeq", "value");
  await db.runTransaction(async (tx) => {
    const indexRef = db.doc("break_aggregates/queueIndex");
    const [indexSnap, aggSnap2, sSnap2] = await Promise.all([tx.get(indexRef), tx.get(aggRef), tx.get(shiftRef)]);
    const order = (indexSnap.exists ? indexSnap.data().order : []) || [];

    tx.set(breakRef, {
      uid: effectiveUid, employeeId: user.employeeId, agentName: user.name, project: user.project || "GENERAL", shiftId: shift.id,
      breakCategory: category, requestedDurationMin: minutesToUse, mode: "NOW", status: "AWAITING_SLOT", requestedAt: now,
      scheduledFor: null, notifiedReady: false, readyToStart: false, queueSeq: seq,
      suggestedTime: suggestedTimeMillis ? Timestamp.fromMillis(suggestedTimeMillis) : null,
      breakStartedAt: null, expectedEndAt: null, breakEndedAt: null, actualMinutesUsed: null, exceeded: false, wasForceEnded: false, forceEndedBy: null,
    });
    tx.set(indexRef, { order: [...order, { uid: effectiveUid, breakId: breakRef.id, queueSeq: seq }] });
    tx.set(aggRef, { activeCount: aggSnap2.data()?.activeCount || 0, queueLength: (Number(aggSnap2.data()?.queueLength) || 0) + 1 });
    tx.set(shiftRef, { breakBudget: bumpBudget(sSnap2.data().breakBudget, category, minutesToUse) }, { merge: true });
    tx.set(userRef, { status: "IN_QUEUE", activeBreakId: breakRef.id }, { merge: true });
  });

  return { status: "AWAITING_SLOT", breakId: breakRef.id, suggestedTime: suggestedTimeMillis };
});

exports.requestBreakLater = onCall(async (request) => {
  const uid = assertAuth(request);
  const { category, minutesNow, scheduledFor } = request.data || {};
  if (!["MEAL", "SHORT"].includes(category)) throw new HttpsError("invalid-argument", "Invalid category.");
  if (!scheduledFor) throw new HttpsError("invalid-argument", "scheduledFor required.");

  const settings = await getSettings();
  if (settings.emergencyLockout) throw new HttpsError("failed-precondition", `🚨 FLOOR FROZEN: ${settings.emergencyReason}.`);

  const user = await getUserDoc(uid);
  if (!user.activeShiftId) throw new HttpsError("failed-precondition", "Shift inactive.");
  const shiftSnap = await db.doc(`shift_sessions/${user.activeShiftId}`).get();
  const shift = { id: shiftSnap.id, ...shiftSnap.data() };
  if (user.activeBreakId) throw new HttpsError("already-exists", "Active break request in progress.");

  const schedMs = Number(scheduledFor);
  const w = windowCheck(shift, settings, schedMs);
  if (!w.ok) throw new HttpsError("invalid-argument", "Schedule falls outside shift window.");
  if (schedMs <= Date.now()) throw new HttpsError("invalid-argument", "Must schedule in the future.");

  const budget = shift.breakBudget;
  let minutesToUse = category === "MEAL" ? budget.mealTotalMin : Math.min(minutesNow || 15, budget.shortTotalMin - budget.shortUsedMin);

  const intervalStart = schedMs;
  const intervalEnd = schedMs + minutesToUse * 60000;

  const [scheduledSnap, activeSnap] = await Promise.all([
    db.collection("break_sessions").where("status", "==", "APPROVED_SCHEDULED").get(),
    db.collection("break_sessions").where("status", "==", "ON_BREAK").get(),
  ]);
  const blockers = [...scheduledSnap.docs, ...activeSnap.docs];
  const overlapCount = blockers.filter((d) => {
    const data = d.data();
    const s = (data.scheduledFor || data.breakStartedAt).toMillis();
    const e = data.expectedEndAt.toMillis();
    return s < intervalEnd && e > intervalStart;
  }).length;

  if (overlapCount >= settings.maxConcurrentBreaks) {
    const ends = blockers.map((d) => d.data().expectedEndAt.toMillis()).filter((t) => t > intervalStart).sort((a, b) => a - b);
    return { ok: false, suggestedTime: ends[0] || intervalStart + 15 * 60000 };
  }

  const breakRef = db.collection("break_sessions").doc();
  await db.runTransaction(async (tx) => {
    const shiftRef = db.doc(`shift_sessions/${shift.id}`);
    const sSnap = await tx.get(shiftRef);
    tx.set(breakRef, {
      uid, employeeId: user.employeeId, agentName: user.name, project: user.project || "GENERAL", shiftId: shift.id,
      breakCategory: category, requestedDurationMin: minutesToUse, mode: "LATER", status: "APPROVED_SCHEDULED",
      requestedAt: Timestamp.now(), scheduledFor: Timestamp.fromMillis(intervalStart), notifiedReady: false, readyToStart: false,
      queueSeq: null, suggestedTime: null, breakStartedAt: null, expectedEndAt: Timestamp.fromMillis(intervalEnd),
      breakEndedAt: null, actualMinutesUsed: null, exceeded: false, wasForceEnded: false, forceEndedBy: null,
    });
    tx.set(shiftRef, { breakBudget: bumpBudget(sSnap.data().breakBudget, category, minutesToUse) }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { status: "IN_QUEUE", activeBreakId: breakRef.id }, { merge: true });
  });

  return { ok: true, breakId: breakRef.id, scheduledFor: intervalStart };
});

exports.goingForBreak = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (!user.activeBreakId) throw new HttpsError("failed-precondition", "No pending session.");
  const breakRef = db.doc(`break_sessions/${user.activeBreakId}`);
  const settings = await getSettings();
  if (settings.emergencyLockout) throw new HttpsError("failed-precondition", `🚨 FLOOR FROZEN: ${settings.emergencyReason}.`);

  return db.runTransaction(async (tx) => {
    const [bSnap, aggSnap] = await Promise.all([tx.get(breakRef), tx.get(db.doc("break_aggregates/live"))]);
    if (!bSnap.exists || bSnap.data().status !== "APPROVED_SCHEDULED") throw new HttpsError("failed-precondition", "Unstartable state.");
    const b = bSnap.data();
    const now = Timestamp.now();
    if (now.toMillis() < b.scheduledFor.toMillis() - 30000) throw new HttpsError("failed-precondition", "Not time yet.");

    const agg = aggSnap.exists ? aggSnap.data() : { activeCount: 0, queueLength: 0 };
    if (agg.activeCount < settings.maxConcurrentBreaks) {
      tx.set(breakRef, { status: "ON_BREAK", breakStartedAt: now, expectedEndAt: Timestamp.fromMillis(now.toMillis() + b.requestedDurationMin * 60000) }, { merge: true });
      tx.set(db.doc("break_aggregates/live"), { activeCount: (Number(agg.activeCount) || 0) + 1 }, { merge: true });
      tx.set(db.doc(`users/${uid}`), { status: "ON_BREAK" }, { merge: true });
      return { status: "ON_BREAK" };
    }
    tx.set(breakRef, { status: "AWAITING_SLOT" }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { status: "IN_QUEUE" }, { merge: true });
    return { status: "AWAITING_SLOT" };
  });
});

async function endAndPromote(breakId, forcedBy) {
  const breakRef = db.doc(`break_sessions/${breakId}`);
  const aggRef = db.doc("break_aggregates/live");
  const indexRef = db.doc("break_aggregates/queueIndex");

  const summary = await db.runTransaction(async (tx) => {
    // STRICT RAM ORDERING: Fetch all Master reads upfront
    const [breakSnap, aggSnap, indexSnap] = await Promise.all([tx.get(breakRef), tx.get(aggRef), tx.get(indexRef)]);
    if (!breakSnap.exists || breakSnap.data().status !== "ON_BREAK") throw new HttpsError("failed-precondition", "Agent not on active break.");
    const b = breakSnap.data();
    const shiftRef = db.doc(`shift_sessions/${b.shiftId}`);

    const order = (indexSnap.exists ? indexSnap.data().order : []) || [];
    const head = order[0];
    const promoteRef = head ? db.doc(`break_sessions/${head.breakId}`) : null;

    // Fetch secondary reads upfront
    const [shiftSnap, promoteSnap] = await Promise.all([tx.get(shiftRef), promoteRef ? tx.get(promoteRef) : Promise.resolve(null)]);
    const now = Timestamp.now();
    const elapsedMin = Math.round((now.toMillis() - b.breakStartedAt.toMillis()) / 60000);
    const refundMin = Math.max(0, b.requestedDurationMin - elapsedMin);

    let newActive = Math.max(0, (Number(aggSnap.data()?.activeCount) || 1) - 1);
    let newQueueLen = Number(aggSnap.data()?.queueLength) || 0;
    let newOrder = order;
    let promoted = null;

    tx.set(breakRef, { status: "COMPLETED", breakEndedAt: now, actualMinutesUsed: elapsedMin, forceEndedBy: forcedBy || null, wasForceEnded: !!forcedBy }, { merge: true });
    tx.set(db.doc(`users/${b.uid}`), { status: "AVAILABLE", activeBreakId: null }, { merge: true });
    if (refundMin > 0 && shiftSnap.exists) tx.set(shiftRef, { breakBudget: bumpBudget(shiftSnap.data().breakBudget, b.breakCategory, -refundMin) }, { merge: true });

    if (promoteSnap && promoteSnap.exists) {
      const pData = promoteSnap.data();
      tx.set(promoteRef, { status: "ON_BREAK", breakStartedAt: now, expectedEndAt: Timestamp.fromMillis(now.toMillis() + (Number(pData.requestedDurationMin) || 20) * 60000) }, { merge: true });
      tx.set(db.doc(`users/${pData.uid}`), { status: "ON_BREAK" }, { merge: true });
      newActive += 1; newQueueLen = Math.max(0, newQueueLen - 1); newOrder = order.slice(1);
      promoted = { uid: pData.uid };
    }
    tx.set(aggRef, { activeCount: newActive, queueLength: newQueueLen });
    tx.set(indexRef, { order: newOrder });
    return { endedAgentUid: b.uid, promoted };
  });

  if (summary.promoted) {
    const pUser = await getUserDoc(summary.promoted.uid).catch(() => null);
    if (pUser?.phone) await sendWhatsAppText({ token: WHATSAPP_TOKEN.value(), to: pUser.phone, body: `Hi ${pUser.name}, a break slot opened up. Your break starts now.` });
  }
  return summary;
}

exports.endBreak = onCall({ secrets: [WHATSAPP_TOKEN] }, async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (!user.activeBreakId) throw new HttpsError("failed-precondition", "No active break.");
  return endAndPromote(user.activeBreakId, null);
});

exports.adminForceEndBreak = onCall({ secrets: [WHATSAPP_TOKEN] }, async (request) => {
  const callerUid = assertAuth(request);
  const caller = await getUserDoc(callerUid);
  requireRole(caller, ["ADMIN", "SUPERVISOR"]);
  const { targetUid } = request.data || {};
  const target = await getUserDoc(targetUid);
  if (!target.activeBreakId) throw new HttpsError("failed-precondition", "Target not on break.");
  return endAndPromote(target.activeBreakId, callerUid);
});

exports.cancelScheduledBreak = onCall(async (request) => {
  const uid = assertAuth(request);
  const user = await getUserDoc(uid);
  if (!user.activeBreakId) throw new HttpsError("failed-precondition", "No pending request.");
  const breakRef = db.doc(`break_sessions/${user.activeBreakId}`);
  const shiftRef = db.doc(`shift_sessions/${user.activeShiftId}`);
  const indexRef = db.doc("break_aggregates/queueIndex");
  const aggRef = db.doc("break_aggregates/live");

  await db.runTransaction(async (tx) => {
    const [breakSnap, shiftSnap, indexSnap, aggSnap] = await Promise.all([tx.get(breakRef), tx.get(shiftRef), tx.get(indexRef), tx.get(aggRef)]);
    if (!breakSnap.exists) throw new HttpsError("not-found", "Break missing.");
    const b = breakSnap.data();
    if (!["AWAITING_SLOT", "APPROVED_SCHEDULED"].includes(b.status)) throw new HttpsError("failed-precondition", "Cannot cancel active session.");

    const refundMin = Number(b.requestedDurationMin) || 0;
    if (shiftSnap.exists && refundMin > 0) tx.set(shiftRef, { breakBudget: bumpBudget(shiftSnap.data().breakBudget, b.breakCategory, -refundMin) }, { merge: true });
    tx.set(breakRef, { status: "CANCELLED" }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { status: "AVAILABLE", activeBreakId: null }, { merge: true });

    if (b.status === "AWAITING_SLOT") {
      const order = (indexSnap.exists ? indexSnap.data().order : []) || [];
      tx.set(indexRef, { order: order.filter((o) => o.breakId !== breakRef.id) }, { merge: true });
      tx.set(aggRef, { queueLength: Math.max(0, (Number(aggSnap.data()?.queueLength) || 1) - 1) }, { merge: true });
    }
  });
  return { ok: true };
});

// ============================================================================
// 4. AUTOMATED TELEMETRY (CRON SCHEDULES)
// ============================================================================

exports.notifyApprovedScheduledBreaks = onSchedule({ schedule: "every 1 minutes", secrets: [WHATSAPP_TOKEN] }, async () => {
  const now = Timestamp.now();
  const snap = await db.collection("break_sessions").where("status", "==", "APPROVED_SCHEDULED").where("notifiedReady", "==", false).where("scheduledFor", "<=", now).get();
  for (const docSnap of snap.docs) {
    const b = docSnap.data();
    await docSnap.ref.set({ notifiedReady: true, readyToStart: true }, { merge: true });
    const user = await getUserDoc(b.uid).catch(() => null);
    if (user?.phone) await sendWhatsAppText({ token: WHATSAPP_TOKEN.value(), to: user.phone, body: `Hi ${user.name}, your break is approved. You may go now.` });
  }
});

exports.checkBreakOverruns = onSchedule({ schedule: "every 1 minutes", secrets: [WHATSAPP_TOKEN] }, async () => {
  const now = Timestamp.now();
  const snap = await db.collection("break_sessions").where("status", "==", "ON_BREAK").where("exceeded", "==", false).where("expectedEndAt", "<=", now).get();
  if (snap.empty) return;

  for (const docSnap of snap.docs) {
    const b = docSnap.data();
    await docSnap.ref.set({ exceeded: true }, { merge: true });
    const user = await getUserDoc(b.uid).catch(() => null);
    if (!user) continue;
    await db.doc(`users/${b.uid}`).set({ status: "BREAK_EXCEEDED" }, { merge: true });

    if (user.phone) await sendWhatsAppText({ token: WHATSAPP_TOKEN.value(), to: user.phone, body: "Your break time has exceeded the limit. Please return immediately." });

    const supervisorMessage = `Alert: ${user.name} (${user.employeeId}) has exceeded their ${b.breakCategory} break.`;
    const presenceSnap = await db.collection("presence").where("role", "==", "SUPERVISOR").where("status", "==", "ONLINE").get();
    for (const d of presenceSnap.docs) {
      const sup = await getUserDoc(d.id).catch(() => null);
      if (sup?.phone && (sup.project === "GENERAL" || sup.project === user.project)) {
        await sendWhatsAppText({ token: WHATSAPP_TOKEN.value(), to: sup.phone, body: supervisorMessage });
      }
    }
  }
});