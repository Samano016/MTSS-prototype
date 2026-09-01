import { db } from "./firebase-config.js";
import { requireRole, initSidebarWho } from "./auth.js";
import {
  collection, doc, updateDoc, onSnapshot, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

requireRole(["admin"], (user, profile) => {
  initSidebarWho(profile);
  listenToConcerns();
  loadUsers();
});

function listenToConcerns() {
  onSnapshot(collection(db, "concerns"), (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStats(docs);
    renderPyramid(docs);
    renderAreaChart(docs);
    renderOutcomeChart(docs);
    renderTrendChart(docs);
  });
}

function renderStats(docs) {
  const total = docs.length;
  const open = docs.filter(c => c.status !== "closed").length;
  const referred = docs.filter(c => c.status === "referred_speced").length;
  const tier3 = docs.filter(c => c.tier === 3).length;

  document.getElementById("stat-grid").innerHTML = [
    ["Total concerns", total],
    ["Currently open", open],
    ["Referred to special ed", referred],
    ["Tier 3 concerns", tier3],
  ].map(([label, n]) => `
    <div class="stat-card"><div class="n">${n}</div><div class="label">${label}</div></div>
  `).join("");
}

function renderPyramid(docs) {
  const counts = { 1: 0, 2: 0, 3: 0 };
  docs.forEach(c => { if (counts[c.tier] !== undefined) counts[c.tier]++; });
  const max = Math.max(counts[1], counts[2], counts[3], 1);
  const rows = [
    { tier: 3, cls: "t3", label: "Tier 3" },
    { tier: 2, cls: "t2", label: "Tier 2" },
    { tier: 1, cls: "t1", label: "Tier 1" },
  ];
  const el = document.getElementById("pyramid");
  el.innerHTML = rows.map(r => {
    const n = counts[r.tier];
    const pct = Math.max((n / max) * 100, 14);
    return `<div class="tier-bar ${r.cls}" style="width:${pct}%">${r.label} · ${n}</div>`;
  }).join("");
}

let areaChart, outcomeChart, trendChart;

function renderAreaChart(docs) {
  const counts = {};
  docs.forEach(c => (c.areasOfConcern || []).forEach(a => counts[a] = (counts[a] || 0) + 1));
  const labels = Object.keys(counts);
  const values = Object.values(counts);
  const ctx = document.getElementById("area-chart");
  if (areaChart) areaChart.destroy();
  areaChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Concerns", data: values, backgroundColor: "#35618C", borderRadius: 4 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

function renderOutcomeChart(docs) {
  const counts = { effective: 0, partial: 0, not_effective: 0, in_progress: 0 };
  docs.forEach(c => (c.interventions || []).forEach(iv => {
    if (counts[iv.effectiveness] !== undefined) counts[iv.effectiveness]++;
  }));
  const ctx = document.getElementById("outcome-chart");
  if (outcomeChart) outcomeChart.destroy();
  outcomeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Working", "Partially working", "Not working", "In progress"],
      datasets: [{
        label: "Interventions",
        data: [counts.effective, counts.partial, counts.not_effective, counts.in_progress],
        backgroundColor: ["#2F6B4F", "#A9762E", "#8C3B3B", "#8892A0"],
        borderRadius: 4,
      }],
    },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

function renderTrendChart(docs) {
  const byMonth = {};
  docs.forEach(c => {
    const ms = c.dateSubmitted?.toMillis?.();
    if (!ms) return;
    const d = new Date(ms);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  });
  const labels = Object.keys(byMonth).sort();
  const values = labels.map(k => byMonth[k]);
  const ctx = document.getElementById("trend-chart");
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Concerns submitted", data: values, borderColor: "#2F6B4F", backgroundColor: "#2F6B4F22", fill: true, tension: 0.25 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

// ── User role management ────────────────────────────────────
async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  const tbody = document.querySelector("#user-table tbody");
  tbody.innerHTML = "";
  snap.forEach(d => {
    const u = d.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(u.displayName || "—")}</td>
      <td>${escapeHtml(u.email || "—")}</td>
      <td></td>
    `;
    const select = document.createElement("select");
    ["teacher", "mtss_team", "admin"].forEach(r => {
      const opt = document.createElement("option");
      opt.value = r; opt.textContent = r === "mtss_team" ? "MTSS Team" : r[0].toUpperCase() + r.slice(1);
      if (r === u.role) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", async () => {
      await updateDoc(doc(db, "users", d.id), { role: select.value });
    });
    tr.children[2].appendChild(select);
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const el = document.createElement("div");
  el.textContent = str ?? "";
  return el.innerHTML;
}
