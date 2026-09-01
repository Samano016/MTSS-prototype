import { db } from "./firebase-config.js";
import { requireRole, initSidebarWho } from "./auth.js";
import {
  collection, doc, updateDoc, arrayUnion,
  onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let allDocs = [];
let currentProfile = null;

requireRole(["mtss_team", "admin"], (user, profile) => {
  currentProfile = profile;
  initSidebarWho(profile);
  if (profile.role === "admin") document.getElementById("nav-reports").style.display = "block";
  listenToAll();
});

function listenToAll() {
  onSnapshot(collection(db, "concerns"), (snap) => {
    allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allDocs.sort((a, b) => (b.dateSubmitted?.toMillis?.() || 0) - (a.dateSubmitted?.toMillis?.() || 0));
    render();
  });
}

document.getElementById("filter-status").addEventListener("change", render);
document.getElementById("filter-tier").addEventListener("change", render);

function render() {
  const statusFilter = document.getElementById("filter-status").value;
  const tierFilter = document.getElementById("filter-tier").value;
  const listEl = document.getElementById("queue-list");

  const filtered = allDocs.filter(c =>
    (!statusFilter || c.status === statusFilter) &&
    (!tierFilter || String(c.tier) === tierFilter)
  );

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No concerns match these filters.</div>`;
    return;
  }

  listEl.innerHTML = "";
  filtered.forEach(c => listEl.appendChild(renderRow(c)));
}

function renderRow(c) {
  const row = document.createElement("div");
  row.className = "concern-row";
  row.innerHTML = `
    <div class="tier-badge tier-${c.tier}">Tier ${c.tier}</div>
    <div>
      <div class="who">${escapeHtml(c.studentName)} <span class="meta">· ${escapeHtml(c.studentGrade)} · ${escapeHtml(c.className)}</span></div>
      <div class="meta">Submitted by ${escapeHtml(c.teacherName)} · ${escapeHtml((c.areasOfConcern || []).join(", "))}</div>
    </div>
    <div class="spacer"></div>
    <span class="status-pill status-${c.status}">${statusLabel(c.status)}</span>
  `;
  row.addEventListener("click", () => openDetail(c));
  return row;
}

function statusLabel(status) {
  return {
    new: "New", under_review: "Under review", monitoring: "Monitoring",
    referred_speced: "Referred — Special Ed", closed: "Closed",
  }[status] || status;
}
function effLabel(v) {
  return { effective: "Working", partial: "Partially working", not_effective: "Not working", in_progress: "In progress" }[v] || v;
}
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

function openDetail(c) {
  const container = document.getElementById("detail-container");
  container.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "card";
  panel.style.marginTop = "16px";
  panel.innerHTML = `
    <h2>${escapeHtml(c.studentName)} <span class="tier-badge tier-${c.tier}" style="margin-left:8px;">Tier ${c.tier}</span></h2>
    <p class="hint">${escapeHtml(c.className)} · ${escapeHtml(c.studentGrade)} · Submitted by ${escapeHtml(c.teacherName)}</p>
    <p>${escapeHtml(c.description)}</p>

    <h3>Interventions logged</h3>
    <div id="d-ivs"></div>

    <div class="field-row" style="margin-top:20px;">
      <div class="field">
        <label>Status</label>
        <select id="d-status">
          <option value="new">New</option>
          <option value="under_review">Under review</option>
          <option value="monitoring">Monitoring</option>
          <option value="referred_speced">Referred — Special Ed</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <div class="field">
        <label>Tier</label>
        <select id="d-tier">
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
      </div>
    </div>
    <button type="button" id="d-save-status">Save status &amp; tier</button>

    <h3 style="margin-top:24px;">Team notes</h3>
    <div id="d-notes"></div>
    <div class="field" style="margin-top:10px;">
      <label>Add a note</label>
      <textarea id="d-new-note" placeholder="What's the plan, or what did the team decide?"></textarea>
    </div>
    <button type="button" id="d-save-note">Add note</button>

    <div style="margin-top:20px;">
      <button type="button" class="secondary" id="d-close">Close</button>
    </div>
  `;
  container.appendChild(panel);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  const ivWrap = panel.querySelector("#d-ivs");
  if (!c.interventions || c.interventions.length === 0) {
    ivWrap.innerHTML = `<p class="hint">None logged yet.</p>`;
  } else {
    c.interventions.forEach(iv => {
      const el = document.createElement("div");
      el.className = "intervention-item";
      el.innerHTML = `<strong>${escapeHtml(iv.description)}</strong> <span class="hint">(${escapeHtml(iv.frequency || "")})</span><br>
        <span class="status-pill">${effLabel(iv.effectiveness)}</span>`;
      ivWrap.appendChild(el);
    });
  }

  panel.querySelector("#d-status").value = c.status;
  panel.querySelector("#d-tier").value = String(c.tier);

  const notesWrap = panel.querySelector("#d-notes");
  renderNotes(notesWrap, c.mtssNotes || []);

  panel.querySelector("#d-close").addEventListener("click", () => container.innerHTML = "");

  panel.querySelector("#d-save-status").addEventListener("click", async () => {
    await updateDoc(doc(db, "concerns", c.id), {
      status: panel.querySelector("#d-status").value,
      tier: Number(panel.querySelector("#d-tier").value),
      lastUpdated: serverTimestamp(),
    });
  });

  panel.querySelector("#d-save-note").addEventListener("click", async () => {
    const noteText = panel.querySelector("#d-new-note").value.trim();
    if (!noteText) return;
    const note = {
      authorName: currentProfile.displayName || currentProfile.email,
      date: new Date().toISOString(),
      note: noteText,
    };
    await updateDoc(doc(db, "concerns", c.id), {
      mtssNotes: arrayUnion(note),
      lastUpdated: serverTimestamp(),
    });
    panel.querySelector("#d-new-note").value = "";
    const existing = c.mtssNotes || [];
    renderNotes(notesWrap, [...existing, note]);
    c.mtssNotes = [...existing, note];
  });
}

function renderNotes(wrap, notes) {
  if (notes.length === 0) {
    wrap.innerHTML = `<p class="hint">No notes yet.</p>`;
    return;
  }
  wrap.innerHTML = "";
  notes.forEach(n => {
    const el = document.createElement("p");
    el.innerHTML = `<strong>${escapeHtml(n.authorName)}</strong> <span class="hint">${new Date(n.date).toLocaleDateString()}</span><br>${escapeHtml(n.note)}`;
    wrap.appendChild(el);
  });
}
