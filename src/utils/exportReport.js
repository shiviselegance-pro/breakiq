import * as XLSX from "xlsx";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function downloadMonthlyBreakReport(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const q = query(
    collection(db, "break_sessions"),
    where("requestedAt", ">=", Timestamp.fromDate(start)),
    where("requestedAt", "<", Timestamp.fromDate(end))
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => d.data());

  const perAgent = {};
  rows.forEach((r) => {
    const key = r.employeeId || r.uid;
    if (!perAgent[key]) perAgent[key] = { employeeId: key, agentName: r.agentName, breaks: 0, mealMin: 0, shortMin: 0, exceedCount: 0 };
    const a = perAgent[key];
    a.breaks += 1;
    if (r.status === "COMPLETED" || r.status === "ON_BREAK") {
      const used = r.actualMinutesUsed ?? r.requestedDurationMin ?? 0;
      if (r.breakCategory === "MEAL") a.mealMin += used; else a.shortMin += used;
    }
    if (r.exceeded) a.exceedCount += 1;
  });

  const summarySheet = XLSX.utils.json_to_sheet(
    Object.values(perAgent).map((a) => ({
      "Employee ID": a.employeeId, Agent: a.agentName, "Total Breaks": a.breaks,
      "Meal Minutes Used": a.mealMin, "Short Minutes Used": a.shortMin, "Times Exceeded": a.exceedCount,
    }))
  );
  const detailSheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      "Employee ID": r.employeeId, Agent: r.agentName, Category: r.breakCategory, Mode: r.mode, Status: r.status,
      "Requested Min": r.requestedDurationMin, "Actual Min": r.actualMinutesUsed ?? "",
      Exceeded: r.exceeded ? "YES" : "NO", "Force Ended": r.wasForceEnded ? "YES" : "NO",
      "Requested At": r.requestedAt?.toDate ? r.requestedAt.toDate().toLocaleString() : "",
      "Started At": r.breakStartedAt?.toDate ? r.breakStartedAt.toDate().toLocaleString() : "",
      "Ended At": r.breakEndedAt?.toDate ? r.breakEndedAt.toDate().toLocaleString() : "",
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(wb, detailSheet, "Detailed Log");
  XLSX.writeFile(wb, `break-report-${year}-${String(month).padStart(2, "0")}.xlsx`);
}
