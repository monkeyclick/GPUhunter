import {
  ALL_INSTANCE_TYPES,
  INSTANCE_FAMILIES,
  REGIONS,
  GCP_REGIONS,
  familyOf,
  cloudOf,
  regionLabel,
  isOptIn,
} from "./catalog.js";

const api = window.gpuHunter;

// ---- Auto-update banner ---------------------------------------------------
{
  const banner    = document.getElementById("updateBanner");
  const msg       = document.getElementById("updateMsg");
  const installBtn = document.getElementById("updateInstallBtn");
  const dismissBtn = document.getElementById("updateDismissBtn");

  api.onUpdateAvailable((info) => {
    msg.textContent = `v${info.version} available — downloading…`;
    banner.hidden = false;
  });
  api.onUpdateProgress((p) => {
    msg.textContent = `Downloading update… ${p.percent}%`;
  });
  api.onUpdateDownloaded((info) => {
    msg.textContent = `v${info.version} downloaded and ready.`;
    installBtn.hidden = false;
    dismissBtn.hidden = true; // nudge user to restart
  });
  api.onUpdateError((errMsg) => {
    msg.textContent = `Update check failed — ${errMsg}`;
    banner.hidden = false;
  });
  installBtn.addEventListener("click", () => api.installUpdate());
  dismissBtn.addEventListener("click", () => { banner.hidden = true; });
}

const state = {
  rows: [],            // [{cloud, region, az, instanceType, family, ondemandOffered, spotScore}]
  scanRegions: [],
  mode: "both",
  cloud: "aws",
  errors: [],
};

// Defined early so any module-level code below can call it.
const escapeHtml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const escapeAttr = escapeHtml;

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Pre-arch portion of the family spec line; arch is appended separately by callers.
const familySpec = (meta) =>
  meta.spec || `${meta.gpu} · ${meta.vramGb} GB`;

// ---------- Sidebar: build family checkboxes -------------------------------
const STORAGE_KEY = "gpuhunter:defaults";
const THEME_KEY = "gpuhunter:theme";
const DEFAULT_OPEN_FAMILIES = ["g5", "g6", "g6e"];

function applyCloudFilter(cloud) {
  for (const det of document.querySelectorAll("#familyList .family")) {
    det.hidden = cloud !== "both" && det.dataset.cloud !== cloud;
  }
  const awsCreds = document.getElementById("awsCreds");
  const gcpCreds = document.getElementById("gcpCreds");
  if (awsCreds) awsCreds.hidden = cloud === "gcp";
  if (gcpCreds) gcpCreds.hidden = cloud === "aws";
}

const familyList = document.getElementById("familyList");
for (const [fam, meta] of Object.entries(INSTANCE_FAMILIES)) {
  const det = document.createElement("details");
  det.className = "family";
  det.dataset.cloud = cloudOf(meta);
  det.open = DEFAULT_OPEN_FAMILIES.includes(fam);
  const initialChecked = DEFAULT_OPEN_FAMILIES.includes(fam);
  det.innerHTML = `
    <summary>
      <span class="caret">›</span>
      <input type="checkbox" class="famCheck" data-fam="${fam}" ${initialChecked ? "checked" : ""}>
      <span class="fam-name">${fam}</span>
      <span class="gpu">${escapeHtml(familySpec(meta))} · ${meta.arch}</span>
    </summary>
    <div class="sizes">
      ${meta.sizes
        .map(
          (s) => `<label><input type="checkbox" class="typeCheck" data-fam="${fam}" value="${s}"
                    ${initialChecked ? "checked" : ""}> ${s}</label>`
        )
        .join("")}
    </div>`;
  familyList.appendChild(det);
}

function updateFamilyState(fam) {
  const children = [...document.querySelectorAll(`.typeCheck[data-fam="${fam}"]`)];
  const checked = children.filter((c) => c.checked).length;
  const famCheck = document.querySelector(`.famCheck[data-fam="${fam}"]`);
  if (!famCheck) return;
  if (checked === 0) {
    famCheck.checked = false;
    famCheck.indeterminate = false;
  } else if (checked === children.length) {
    famCheck.checked = true;
    famCheck.indeterminate = false;
  } else {
    famCheck.checked = false;
    famCheck.indeterminate = true;
  }
}

// Wire family-master checkboxes: stop click from toggling <details>, propagate to children.
for (const cb of document.querySelectorAll(".famCheck")) {
  cb.addEventListener("click", (e) => e.stopPropagation());
  cb.addEventListener("change", () => {
    const fam = cb.dataset.fam;
    const want = cb.checked;
    for (const c of document.querySelectorAll(`.typeCheck[data-fam="${fam}"]`)) {
      c.checked = want;
    }
    cb.indeterminate = false;
  });
}

// Wire individual size checkboxes to bubble state to family.
for (const cb of document.querySelectorAll(".typeCheck")) {
  cb.addEventListener("change", () => updateFamilyState(cb.dataset.fam));
}

document.getElementById("selectAll").addEventListener("click", () => {
  for (const el of document.querySelectorAll(".typeCheck"))
    if (!el.closest(".family").hidden) el.checked = true;
  for (const fam of Object.keys(INSTANCE_FAMILIES)) updateFamilyState(fam);
});
document.getElementById("clearAll").addEventListener("click", () => {
  for (const el of document.querySelectorAll(".typeCheck"))
    if (!el.closest(".family").hidden) el.checked = false;
  for (const fam of Object.keys(INSTANCE_FAMILIES)) updateFamilyState(fam);
});

function selectedTypes() {
  return Array.from(document.querySelectorAll(".typeCheck:checked"))
    .filter((e) => !e.closest(".family").hidden)
    .map((e) => e.value);
}

// Cloud selector — filter families and credential sections on change.
for (const radio of document.querySelectorAll('input[name="cloud"]')) {
  radio.addEventListener("change", () => {
    state.cloud = radio.value;
    applyCloudFilter(radio.value);
    for (const fam of Object.keys(INSTANCE_FAMILIES)) updateFamilyState(fam);
  });
}
// Apply initial state (AWS default).
applyCloudFilter("aws");

// Initialize family-check tri-state for the default selections.
for (const fam of Object.keys(INSTANCE_FAMILIES)) updateFamilyState(fam);

// ---------- Tabs -----------------------------------------------------------
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "map" && map) {
      // Leaflet needs an invalidate when the container becomes visible.
      setTimeout(() => map.invalidateSize(), 50);
    }
  });
}

// ---------- Theme ----------------------------------------------------------
const TILE_URLS = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
};

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  if (tileLayer && map) {
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILE_URLS[theme], {
      attribution: "© OpenStreetMap contributors © CARTO",
      subdomains: "abcd",
      maxZoom: 9,
    }).addTo(map);
  }
}
document.getElementById("themeToggle").addEventListener("click", () => {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
});

// ---------- Map ------------------------------------------------------------
let map;
let regionLayer;
let tileLayer;
function ensureMap() {
  if (map) return;
  map = L.map("map", {
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  }).setView([25, 10], 2);
  tileLayer = L.tileLayer(TILE_URLS[currentTheme()], {
    attribution: "© OpenStreetMap contributors © CARTO",
    subdomains: "abcd",
    maxZoom: 9,
  }).addTo(map);
  regionLayer = L.layerGroup().addTo(map);
}
ensureMap();

function colorForScore(score) {
  if (score == null) return "#4b5563";
  if (score >= 7) return "#22c55e";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}

function radiusForScore(score) {
  const v = score ?? 2;
  return 9 + v * 1.8; // pixel radius
}

function renderMap() {
  ensureMap();
  regionLayer.clearLayers();

  // Aggregate per region: best spot score, AZ count, OD offering count.
  const byRegion = new Map();
  for (const r of state.rows) {
    const e = byRegion.get(r.region) || {
      region: r.region, bestSpot: null, azs: new Set(), types: new Set(), odCount: 0, perType: [],
    };
    if (r.spotScore != null) e.bestSpot = Math.max(e.bestSpot ?? -Infinity, r.spotScore);
    if (r.az) e.azs.add(r.az);
    e.types.add(r.instanceType);
    if (r.ondemandOffered === true) e.odCount += 1;
    e.perType.push(r);
    byRegion.set(r.region, e);
  }

  for (const [region, e] of byRegion.entries()) {
    const meta = REGIONS[region];
    if (!meta) continue;
    const [lat, lon] = meta;
    const score = isFinite(e.bestSpot) ? e.bestSpot : null;
    const fill = colorForScore(score);
    const marker = L.circleMarker([lat, lon], {
      radius: radiusForScore(score),
      fillColor: fill,
      fillOpacity: 0.85,
      color: fill,
      weight: 2,
      opacity: 0.9,
    });
    const top3 = e.perType
      .filter((r) => r.spotScore != null)
      .sort((a, b) => b.spotScore - a.spotScore)
      .slice(0, 3)
      .map((r) => `<li>${r.instanceType} @ ${r.az || "?"} — <strong>${r.spotScore}</strong>/10</li>`)
      .join("");
    marker.bindPopup(
      `<div style="min-width:200px">
        <strong>${regionLabel(region)}</strong><br/>
        Best Spot score: <strong>${score ?? "n/a"}</strong>${score != null ? "/10" : ""}<br/>
        AZs with data: ${e.azs.size} · types: ${e.types.size} · OD offerings: ${e.odCount}
        ${top3 ? `<ul style="margin:6px 0 0 16px;padding:0">${top3}</ul>` : ""}
       </div>`
    );
    marker.addTo(regionLayer);
  }

  // Top regions table is rendered by renderTopRegions (filtered + sorted).
  renderTopRegions();

  // Hide the empty-state once we have any data.
  const empty$ = document.getElementById("mapEmpty");
  if (empty$) empty$.style.display = state.rows.length ? "none" : "block";
}

// ---------- Top Regions overlay (Map page) ---------------------------------
const topRegionsPanel = document.getElementById("topRegions");
const trSearch = topRegionsPanel.querySelector(".trSearch");
const trFamily = topRegionsPanel.querySelector(".trFamily");
const trMin = topRegionsPanel.querySelector(".trMin");
const trMinVal = topRegionsPanel.querySelector(".trMinVal");
const trMeta = topRegionsPanel.querySelector(".trMeta");

let trSortKey = "bestSpot";
let trSortDir = "desc";
const TR_NUMERIC_KEYS = new Set(["bestSpot", "azCount", "typeCount", "odCount"]);

trSearch.addEventListener("input", renderTopRegions);
trFamily.addEventListener("change", renderTopRegions);
trMin.addEventListener("input", () => {
  trMinVal.textContent = trMin.value;
  renderTopRegions();
});
topRegionsPanel.querySelector(".trClear").addEventListener("click", () => {
  trSearch.value = "";
  trFamily.value = "";
  trMin.value = 0;
  trMinVal.textContent = "0";
  trSortKey = "bestSpot";
  trSortDir = "desc";
  renderTopRegions();
});

topRegionsPanel.querySelector("thead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  const k = th.dataset.sort;
  if (trSortKey === k) {
    trSortDir = trSortDir === "desc" ? "asc" : "desc";
  } else {
    trSortKey = k;
    trSortDir = TR_NUMERIC_KEYS.has(k) ? "desc" : "asc";
  }
  renderTopRegions();
});

topRegionsPanel.querySelector("tbody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-region]");
  if (!tr) return;
  jumpToDetail(tr.dataset.region);
});

function buildRegionSummary({ family, minScore, search }) {
  let rows = state.rows;
  if (family) rows = rows.filter((r) => r.family === family);

  const byRegion = new Map();
  for (const r of rows) {
    const e = byRegion.get(r.region) || {
      region: r.region, bestSpot: null, azs: new Set(), types: new Set(), odCount: 0,
    };
    if (r.spotScore != null) e.bestSpot = Math.max(e.bestSpot ?? -Infinity, r.spotScore);
    if (r.az) e.azs.add(r.az);
    e.types.add(r.instanceType);
    if (r.ondemandOffered === true) e.odCount += 1;
    byRegion.set(r.region, e);
  }

  let result = [...byRegion.values()].map((e) => ({
    region: e.region,
    bestSpot: isFinite(e.bestSpot) ? e.bestSpot : null,
    azCount: e.azs.size,
    typeCount: e.types.size,
    odCount: e.odCount,
  }));

  if (minScore > 0) result = result.filter((r) => (r.bestSpot ?? -1) >= minScore);
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(
      (r) =>
        r.region.toLowerCase().includes(q) ||
        regionLabel(r.region).toLowerCase().includes(q)
    );
  }
  return result;
}

function renderTopRegions() {
  if (!state.rows.length) {
    topRegionsPanel.style.display = "none";
    return;
  }
  topRegionsPanel.style.display = "block";

  const summary = buildRegionSummary({
    family: trFamily.value,
    minScore: parseInt(trMin.value, 10) || 0,
    search: trSearch.value.trim(),
  });

  summary.sort((a, b) => {
    const primary = compareRows(a, b, trSortKey, trSortDir);
    if (primary !== 0) return primary;
    return a.region.localeCompare(b.region);
  });

  for (const th of topRegionsPanel.querySelectorAll("th[data-sort]")) {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === trSortKey) th.classList.add(`sort-${trSortDir}`);
  }

  const tbody = topRegionsPanel.querySelector("tbody");
  tbody.innerHTML = summary
    .map(
      (r) => `<tr data-region="${r.region}" title="Click to view in Detail table">
        <td>${regionLabel(r.region)}</td>
        <td>${scoreBadge(r.bestSpot)}</td>
        <td>${r.azCount}</td>
        <td>${r.typeCount}</td>
        <td>${r.odCount}</td>
      </tr>`
    )
    .join("");

  trMeta.textContent = `${summary.length} ${summary.length === 1 ? "region" : "regions"} match`;
}

function jumpToDetail(region) {
  document.querySelector('.tab[data-tab="table"]').click();
  // Narrow region multi-select to just this region.
  for (const opt of filterRegion.options) opt.selected = opt.value === region;
  // Clear text/min-score so the row isn't filtered out by an unrelated filter.
  filterText.value = "";
  filterMinScore.value = 0;
  filterMinScoreVal.textContent = "0";
  renderTable();
}

function scoreBadge(s) {
  if (s == null) return '<span class="muted">—</span>';
  const cls = s >= 7 ? "s-high" : s >= 4 ? "s-mid" : "s-low";
  return `<span class="score ${cls}">${s}</span>`;
}

// ---------- Detail table ---------------------------------------------------
const tbl = document.querySelector("#detailTable tbody");
const filterFamily = document.getElementById("filterFamily");
const filterRegion = document.getElementById("filterRegion");
const filterMinScore = document.getElementById("filterMinScore");
const filterMinScoreVal = document.getElementById("filterMinScoreVal");
const filterOd = document.getElementById("filterOd");
const filterText = document.getElementById("filterText");
const resultCount = document.getElementById("resultCount");

// Sort state — column key matches row property names.
let sortKey = "spotScore";
let sortDir = "desc"; // "asc" | "desc"
const NUMERIC_KEYS = new Set(["spotScore"]);

const COLUMNS = [
  { key: "cloud",             label: "Cloud",       bothOnly: true },
  { key: "region",            label: "Region" },
  { key: "az",                label: "AZ" },
  { key: "instanceType",      label: "Instance type" },
  { key: "family",            label: "Family" },
  { key: "spotScore",         label: "Spot score" },
  { key: "ondemandOffered",   label: "OD offered", odOnly: true },
];

// Row selection (Detail table → Probe queue)
const selectedRowIds = new Set();
const rowId = (r) => `${r.cloud || "aws"}|${r.region}|${r.az || ""}|${r.instanceType}`;
const selectionBar = document.getElementById("selectionBar");

function updateSelectionBar() {
  const n = selectedRowIds.size;
  if (n === 0) {
    selectionBar.style.display = "none";
  } else {
    selectionBar.style.display = "flex";
    selectionBar.querySelector(".count").textContent = n.toLocaleString();
  }
}

document.getElementById("clearSelection").addEventListener("click", () => {
  selectedRowIds.clear();
  updateSelectionBar();
  renderTable();
});

document.getElementById("sendToProbe").addEventListener("click", () => {
  const byId = new Map(state.rows.map((r) => [rowId(r), r]));
  let added = 0, skipped = 0;
  for (const id of selectedRowIds) {
    const r = byId.get(id);
    if (!r) { skipped++; continue; }
    if (addToProbeQueue(r)) added++;
    else skipped++;
  }
  document.querySelector('.tab[data-tab="probe"]').click();
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (skipped) parts.push(`${skipped} skipped (already queued or no AZ)`);
  setStatus(parts.join(" · ") || "Nothing to send", added ? "ok" : "");
});

filterMinScore.addEventListener("input", () => {
  filterMinScoreVal.textContent = filterMinScore.value;
  renderTable();
});
filterFamily.addEventListener("change", renderTable);
filterRegion.addEventListener("change", renderTable);
filterOd.addEventListener("change", renderTable);
filterText.addEventListener("input", debounce(renderTable, 150));

document.getElementById("clearFilters").addEventListener("click", () => {
  filterText.value = "";
  filterMinScore.value = 0;
  filterMinScoreVal.textContent = "0";
  filterOd.value = "any";
  for (const opt of filterFamily.options) opt.selected = true;
  for (const opt of filterRegion.options) opt.selected = true;
  sortKey = "spotScore";
  sortDir = "desc";
  renderTable();
});

// Header — sort (click on a sortable th) and select-all (click on the master checkbox).
document.querySelector("#detailTable thead").addEventListener("click", (e) => {
  if (e.target.matches(".rowSelectAll")) {
    e.stopPropagation();
    return; // handled by 'change' below
  }
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  const k = th.dataset.sort;
  if (sortKey === k) {
    sortDir = sortDir === "desc" ? "asc" : "desc";
  } else {
    sortKey = k;
    sortDir = NUMERIC_KEYS.has(k) ? "desc" : "asc";
  }
  renderTable();
});
document.querySelector("#detailTable thead").addEventListener("change", (e) => {
  if (!e.target.matches(".rowSelectAll")) return;
  const want = e.target.checked;
  const visibleRows = document.querySelectorAll("#detailTable tbody tr[data-id]");
  for (const tr of visibleRows) {
    if (want) selectedRowIds.add(tr.dataset.id);
    else selectedRowIds.delete(tr.dataset.id);
  }
  updateSelectionBar();
  renderTable();
});

// Row-level checkbox toggling via delegation.
document.querySelector("#detailTable tbody").addEventListener("change", (e) => {
  if (!e.target.matches(".rowSelect")) return;
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  if (e.target.checked) selectedRowIds.add(tr.dataset.id);
  else selectedRowIds.delete(tr.dataset.id);
  tr.classList.toggle("selected", e.target.checked);
  updateSelectionBar();
  // Re-render to update header checkbox state.
  renderTable();
});

function rebuildFilterOptions() {
  const fams = [...new Set(state.rows.map((r) => r.family))].sort();
  const regions = [...new Set(state.rows.map((r) => r.region))].sort();
  filterFamily.innerHTML = fams.map((f) => `<option value="${f}" selected>${f}</option>`).join("");
  filterRegion.innerHTML = regions
    .map((r) => `<option value="${r}" selected>${regionLabel(r)}</option>`)
    .join("");
  // Top-Regions family pivot (single-select with "all").
  const prevFam = trFamily.value;
  trFamily.innerHTML =
    `<option value="">all families</option>` +
    fams.map((f) => `<option value="${f}">${f}</option>`).join("");
  if (fams.includes(prevFam)) trFamily.value = prevFam;
}

function compareRows(a, b, key, dir) {
  const av = a[key];
  const bv = b[key];
  // null/undefined always sorts last regardless of direction.
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  let cmp;
  if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else if (typeof av === "boolean" && typeof bv === "boolean") cmp = av === bv ? 0 : av ? -1 : 1;
  else cmp = String(av).localeCompare(String(bv));
  return dir === "desc" ? -cmp : cmp;
}

function renderTable() {
  const fams = new Set(Array.from(filterFamily.selectedOptions).map((o) => o.value));
  const regions = new Set(Array.from(filterRegion.selectedOptions).map((o) => o.value));
  const minScore = parseInt(filterMinScore.value, 10);
  const od = filterOd.value;
  const q = filterText.value.trim().toLowerCase();

  let view = state.rows.filter((r) => {
    if (!fams.has(r.family)) return false;
    if (!regions.has(r.region)) return false;
    if (minScore > 0 && (r.spotScore ?? -1) < minScore) return false;
    if (od === "yes" && r.ondemandOffered !== true) return false;
    if (od === "no" && r.ondemandOffered !== false) return false;
    if (q) {
      const haystack = `${r.region} ${regionLabel(r.region)} ${r.az || ""} ${r.instanceType} ${r.family}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Primary sort by sortKey/sortDir, then stable secondary sort.
  view.sort((a, b) => {
    const primary = compareRows(a, b, sortKey, sortDir);
    if (primary !== 0) return primary;
    return (
      a.region.localeCompare(b.region) ||
      (a.az || "").localeCompare(b.az || "") ||
      a.instanceType.localeCompare(b.instanceType)
    );
  });

  const showOd = state.mode !== "spot";

  // Header checkbox state — checked if every visible row is selected.
  const visibleIds = view.map(rowId);
  const visibleSelected = visibleIds.filter((id) => selectedRowIds.has(id)).length;
  const headerChecked = visibleIds.length > 0 && visibleSelected === visibleIds.length;
  const headerIndeterminate = visibleSelected > 0 && visibleSelected < visibleIds.length;

  // Rebuild column headers only when sort state, OD visibility, or cloud mode changes.
  const showCloud = state.cloud === "both";
  const headRow = document.querySelector("#detailTable thead tr");
  if (
    headRow.dataset.sortKey !== sortKey ||
    headRow.dataset.sortDir !== sortDir ||
    headRow.dataset.showOd !== String(showOd) ||
    headRow.dataset.showCloud !== String(showCloud)
  ) {
    headRow.dataset.sortKey = sortKey;
    headRow.dataset.sortDir = sortDir;
    headRow.dataset.showOd = String(showOd);
    headRow.dataset.showCloud = String(showCloud);
    headRow.innerHTML =
      `<th class="selectCol"><input type="checkbox" class="rowSelectAll" title="Select all visible rows"></th>` +
      COLUMNS.filter((c) => (!c.odOnly || showOd) && (!c.bothOnly || showCloud))
        .map((c) => {
          const cls = c.key === sortKey ? ` class="sort-${sortDir}"` : "";
          return `<th data-sort="${c.key}"${cls}>${c.label}</th>`;
        })
        .join("");
  }
  const headerCb = headRow.querySelector(".rowSelectAll");
  if (headerCb) {
    headerCb.checked = headerChecked;
    headerCb.indeterminate = headerIndeterminate;
  }

  tbl.innerHTML = view
    .map((r) => {
      const id = rowId(r);
      const sel = selectedRowIds.has(id);
      return `<tr data-id="${id}"${sel ? ' class="selected"' : ""}>
        <td class="selectCol"><input type="checkbox" class="rowSelect"${sel ? " checked" : ""}></td>
        ${showCloud ? `<td><span class="pill ${r.cloud || "aws"}">${(r.cloud || "aws").toUpperCase()}</span></td>` : ""}
        <td>${regionLabel(r.region)}</td>
        <td>${r.az || "—"}</td>
        <td>${r.instanceType}</td>
        <td>${r.family}</td>
        <td>${scoreBadge(r.spotScore)}</td>
        ${
          showOd
            ? `<td>${
                r.ondemandOffered === true
                  ? '<span class="pill yes">yes</span>'
                  : r.ondemandOffered === false
                  ? '<span class="pill no">no</span>'
                  : '<span class="muted">—</span>'
              }</td>`
            : ""
        }
      </tr>`;
    })
    .join("");

  // Row-count summary
  const total = state.rows.length;
  resultCount.textContent = total
    ? `${view.length.toLocaleString()} of ${total.toLocaleString()} rows · sorted by ${
        COLUMNS.find((c) => c.key === sortKey)?.label || sortKey
      } ${sortDir === "desc" ? "↓" : "↑"}`
    : "—";
}

document.getElementById("exportCsv").addEventListener("click", () => {
  const rows = [
    ["cloud", "region", "az", "instance_type", "family", "spot_score", "ondemand_offered"],
    ...state.rows.map((r) => [
      r.cloud || "aws",
      r.region,
      r.az || "",
      r.instanceType,
      r.family,
      r.spotScore ?? "",
      r.ondemandOffered === true ? "yes" : r.ondemandOffered === false ? "no" : "",
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "gpu_hunter.csv";
  a.click();
});

// ---------- Probe tab — queue-based ---------------------------------------
const probeType = document.getElementById("probeType");
const probeAz = document.getElementById("probeAz");
const probeManualRegion = document.getElementById("probeManualRegion");
const probeConfirm = document.getElementById("probeConfirm");
const probeAllBtn = document.getElementById("probeAllBtn");
const clearQueueBtn = document.getElementById("clearQueueBtn");
const addToQueueBtn = document.getElementById("addToQueueBtn");
const queueWrap = document.getElementById("probeQueueWrap");
const queueTbody = document.querySelector("#probeQueueTable tbody");
const queueCountSpan = document.getElementById("queueCount");
const manualAddNote = document.getElementById("manualAddNote");

const probeQueue = []; // {id, region, az, instanceType, count, status, message}
const azCache = new Map(); // region → string[] of AZ names

// Populate region & instance-type dropdowns from the static catalog (no scan needed).
function populateManualForm() {
  const regions = Object.keys(REGIONS).sort();
  probeManualRegion.innerHTML = regions
    .map((r) => `<option value="${r}">${escapeHtml(regionLabel(r))}</option>`)
    .join("");
  probeType.innerHTML = ALL_INSTANCE_TYPES.map((t) => `<option>${t}</option>`).join("");
}
populateManualForm();

async function loadAzsForRegion(region) {
  if (!region) return [];
  if (azCache.has(region)) return azCache.get(region);

  // Use already-scanned AZs as an instant fallback.
  const scanned = [
    ...new Set(state.rows.filter((r) => r.region === region).map((r) => r.az).filter(Boolean)),
  ].sort();
  if (scanned.length) {
    azCache.set(region, scanned);
    return scanned;
  }

  // GCP regions don't use the AWS AZ API — zones come from scan results only.
  if (GCP_REGIONS.has(region)) return [];

  const profile = document.getElementById("profile").value.trim() || null;
  try {
    const map = await api.getAzIdMap({ regions: [region], profile });
    const azs = [...new Set(Object.values(map))]
      .filter((n) => typeof n === "string" && n.startsWith(region))
      .sort();
    azCache.set(region, azs);
    return azs;
  } catch (e) {
    console.warn(`Failed to fetch AZs for ${region}:`, e);
    return [];
  }
}

async function refreshManualAzs() {
  const region = probeManualRegion.value;
  probeAz.disabled = true;
  probeAz.innerHTML = `<option value="">loading…</option>`;
  manualAddNote.textContent = `Loading AZs for ${region}…`;
  const azs = await loadAzsForRegion(region);
  if (azs.length === 0) {
    probeAz.innerHTML = `<option value="" disabled>No AZs available</option>`;
    const isGcp = GCP_REGIONS.has(region);
    manualAddNote.innerHTML = isGcp
      ? `No zones found for <code>${escapeHtml(region)}</code>. Run a GCP scan first to populate zones.`
      : `No AZs returned for <code>${escapeHtml(region)}</code>. The region may not be enabled, or your credentials lack <code>ec2:DescribeAvailabilityZones</code>.`;
  } else {
    probeAz.innerHTML = azs.map((a) => `<option>${escapeHtml(a)}</option>`).join("");
    manualAddNote.innerHTML = `<code>${azs.length}</code> AZs loaded for <code>${escapeHtml(
      region
    )}</code>.`;
  }
  probeAz.disabled = false;
}
probeManualRegion.addEventListener("change", refreshManualAzs);
// After a scan, refresh AZ cache from real scanned data and re-populate the
// manual AZ select if the user has a region selected.
function rebuildProbeOptions() {
  // Drop cached entries for regions present in the scan so they pick up the latest names.
  for (const r of state.rows) {
    if (r.region) azCache.delete(r.region);
  }
  // If the manual form already has a region picked, refresh its AZs.
  if (probeManualRegion.value) refreshManualAzs();
}

function addToProbeQueue(row, count = 1) {
  const id = rowId(row);
  if (!row.az) return false; // need an AZ/zone to probe
  if (probeQueue.some((q) => q.id === id)) return false; // dedupe
  probeQueue.push({
    id,
    cloud: row.cloud || "aws",
    region: row.region,
    az: row.az,
    instanceType: row.instanceType,
    count,
    status: "pending",
    message: "",
  });
  renderProbeQueue();
  return true;
}

function removeFromProbeQueue(id) {
  const idx = probeQueue.findIndex((q) => q.id === id);
  if (idx >= 0) {
    probeQueue.splice(idx, 1);
    renderProbeQueue();
  }
}

function renderProbeQueue() {
  const n = probeQueue.length;
  queueCountSpan.textContent = `(${n})`;
  clearQueueBtn.disabled = n === 0;
  queueWrap.classList.toggle("empty", n === 0);
  updateProbeAllEnabled();

  queueTbody.innerHTML = probeQueue
    .map((it) => {
      const probing = it.status === "probing";
      const statusHtml = renderQueueStatus(it);
      return `<tr data-id="${escapeAttr(it.id)}">
        <td><span class="pill ${it.cloud || "aws"}">${(it.cloud || "aws").toUpperCase()}</span></td>
        <td>${regionLabel(it.region)}</td>
        <td>${it.az}</td>
        <td>${it.instanceType}</td>
        <td><input type="number" class="countInput" min="1" max="64" value="${it.count}"${
        probing ? " disabled" : ""
      }></td>
        <td>${statusHtml}</td>
        <td class="probeActions">
          <button class="probeOne" ${probing ? "disabled" : ""}>${
        it.status === "ok" || it.status === "err" ? "Re-probe" : "Probe"
      }</button>
          <button class="iconBtn removeOne" title="Remove from queue" ${probing ? "disabled" : ""}>×</button>
        </td>
      </tr>`;
    })
    .join("");
}

function renderQueueStatus(it) {
  switch (it.status) {
    case "pending":
      return `<div class="statusCell"><span class="muted">pending</span></div>`;
    case "probing":
      return `<div class="statusCell"><span class="spinner-sm"></span><span class="muted">probing…</span></div>`;
    case "ok":
      return `<div class="statusCell"><span class="pill yes">available</span><span class="msg" title="${escapeAttr(
        it.message
      )}">${escapeAttr(it.message)}</span></div>`;
    case "err":
      return `<div class="statusCell"><span class="pill no">no capacity</span><span class="msg" title="${escapeAttr(
        it.message
      )}">${escapeAttr(it.message)}</span></div>`;
  }
  return "";
}

function updateProbeAllEnabled() {
  const hasItems = probeQueue.length > 0;
  const anyProbeable = probeQueue.some((q) => q.status !== "probing");
  probeAllBtn.disabled = !probeConfirm.checked || !hasItems || !anyProbeable;
}

probeConfirm.addEventListener("change", updateProbeAllEnabled);

clearQueueBtn.addEventListener("click", () => {
  probeQueue.length = 0;
  renderProbeQueue();
});

addToQueueBtn.addEventListener("click", () => {
  const region = probeManualRegion.value;
  const az = probeAz.value;
  const instanceType = probeType.value;
  if (!region || !az || !instanceType) {
    setStatus("Pick a region, AZ, and instance type before adding.", "error");
    return;
  }
  const ok = addToProbeQueue(
    { region, az, instanceType },
    parseInt(document.getElementById("probeCount").value, 10) || 1
  );
  if (!ok) setStatus("That row is already in the queue.", "");
});

// Per-row: count change, probe-one, remove. Delegated.
queueTbody.addEventListener("input", (e) => {
  if (!e.target.matches(".countInput")) return;
  const tr = e.target.closest("tr[data-id]");
  const item = probeQueue.find((q) => q.id === tr.dataset.id);
  if (!item) return;
  const v = parseInt(e.target.value, 10);
  if (Number.isFinite(v) && v >= 1 && v <= 64) item.count = v;
});

queueTbody.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const id = tr.dataset.id;
  if (e.target.matches(".removeOne")) {
    removeFromProbeQueue(id);
  } else if (e.target.matches(".probeOne")) {
    if (!probeConfirm.checked) {
      setStatus("Tick the confirmation checkbox to enable probing.", "error");
      return;
    }
    probeOne(id);
  }
});

async function probeOne(id) {
  const item = probeQueue.find((q) => q.id === id);
  if (!item) return;
  item.status = "probing";
  item.message = "";
  renderProbeQueue();
  try {
    let res;
    if (item.cloud === "gcp") {
      const projectId = document.getElementById("gcpProjectId").value.trim();
      const keyFile   = document.getElementById("gcpKeyFile").value.trim() || null;
      if (!projectId) {
        res = { success: false, message: "Enter a GCP Project ID in the sidebar to probe." };
      } else {
        res = await api.gcpProbe({
          projectId,
          zone: item.az,
          machineType: item.instanceType,
          count: item.count,
          keyFile,
        });
      }
    } else {
      res = await api.probe({
        region: item.region,
        az: item.az,
        instanceType: item.instanceType,
        count: item.count,
        profile: document.getElementById("profile").value.trim() || null,
      });
    }
    item.status = res.success ? "ok" : "err";
    item.message = res.message;
  } catch (e) {
    item.status = "err";
    item.message = e.message || String(e);
  }
  renderProbeQueue();
}

probeAllBtn.addEventListener("click", async () => {
  if (!probeConfirm.checked) return;
  probeAllBtn.classList.add("busy");
  probeAllBtn.querySelector(".label").textContent = "Probing…";
  // Sequential to avoid hammering AWS and to keep status legible.
  for (const item of [...probeQueue]) {
    if (item.status === "probing") continue;
    if (!probeQueue.find((q) => q.id === item.id)) continue; // removed mid-run
    await probeOne(item.id);
  }
  probeAllBtn.classList.remove("busy");
  probeAllBtn.querySelector(".label").textContent = "Probe all";
  updateProbeAllEnabled();
});

renderProbeQueue();

// ---------- Scan -----------------------------------------------------------
const status$ = document.getElementById("status");
api.onProgress((p) => {
  if (p.phase === "spot") {
    status$.textContent = `Spot scores ${p.done}/${p.total} chunks…`;
  } else if (p.phase === "gcp") {
    status$.textContent = `GCP zones ${p.done} (${p.zone || ""})…`;
  } else {
    status$.textContent = `Offerings ${p.done}/${p.total} (${p.region})…`;
  }
  status$.className = "";
});

const scanBtn = document.getElementById("scan");
function setStatus(msg, kind = "") {
  status$.textContent = msg;
  status$.className = kind;
}
function setBusy(busy) {
  scanBtn.classList.toggle("busy", busy);
  scanBtn.disabled = busy;
  scanBtn.querySelector(".label").textContent = busy ? "Scanning…" : "Scan for capacity";
}

scanBtn.addEventListener("click", async () => {
  const types = selectedTypes();
  if (types.length === 0) {
    setStatus("Select at least one instance type.", "error");
    return;
  }
  setBusy(true);
  const profile = document.getElementById("profile").value.trim() || null;
  const targetCapacity = parseInt(document.getElementById("targetCapacity").value, 10);
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const cloud = document.querySelector('input[name="cloud"]:checked').value;
  const gcpProjectId = document.getElementById("gcpProjectId").value.trim();
  const gcpKeyFile = document.getElementById("gcpKeyFile").value.trim() || null;
  const includeOptInChk = document.getElementById("includeOptIn").checked;
  state.mode = mode;
  state.cloud = cloud;

  // Validate GCP credentials before starting.
  if ((cloud === "gcp" || cloud === "both") && !gcpProjectId) {
    if (cloud === "gcp") {
      setStatus("Enter a GCP Project ID in the sidebar.", "error");
      setBusy(false);
      return;
    }
  }

  // ---- AWS scan -----------------------------------------------------------
  let offerings = {};
  let spot = { results: [], errors: [] };
  let azIdMap = {};
  let scanRegions = [];

  if (cloud === "aws" || cloud === "both") {
    setStatus("Listing enabled regions…");
    let enabled;
    try {
      enabled = await api.listRegions(profile);
    } catch (e) {
      setStatus(`Failed to list regions. Check credentials. ${e.message || e}`, "error");
      setBusy(false);
      return;
    }

    const preferred = (getStoredDefaults().preferredRegions || []).filter(Boolean);
    scanRegions = enabled.filter((r) => {
      if (!REGIONS[r]) return false;
      if (preferred.length > 0) return preferred.includes(r);
      return includeOptInChk || !isOptIn(r);
    });
    state.scanRegions = scanRegions;

    if (scanRegions.length === 0) {
      if (cloud === "aws") {
        setStatus("No regions to scan — none of your preferred regions are enabled on this account.", "error");
        setBusy(false);
        return;
      }
    } else {
      setStatus(
        `Scanning ${scanRegions.length} AWS regions${preferred.length ? " (restricted by your preferences)" : ""}…`
      );
      const awsTypes = types.filter((t) => t.includes("."));
      try {
        const tasks = [];
        if (mode === "both" || mode === "ondemand") {
          tasks.push(
            api.getOfferings({ regions: scanRegions, instanceTypes: awsTypes, profile }).then((o) => (offerings = o))
          );
        }
        if (mode === "both" || mode === "spot") {
          tasks.push(
            api
              .getSpotScores({ instanceTypes: awsTypes, targetCapacity, regions: scanRegions, profile })
              .then((s) => (spot = s))
          );
        }
        await Promise.all(tasks);
      } catch (e) {
        setStatus(`AWS scan failed: ${e.message || e}`, "error");
        setBusy(false);
        return;
      }

      if (spot.results.length) {
        azIdMap = await api.getAzIdMap({ regions: scanRegions, profile });
      }
    }
  }

  // ---- GCP scan -----------------------------------------------------------
  let gcpOfferings = {};

  if ((cloud === "gcp" || cloud === "both") && gcpProjectId) {
    const gcpTypes = types.filter((t) => !t.includes("."));
    if (gcpTypes.length === 0 && cloud === "gcp") {
      setStatus("No GCP instance types selected.", "error");
      setBusy(false);
      return;
    }
    if (gcpTypes.length > 0) {
      setStatus("Scanning GCP zones…");
      try {
        gcpOfferings = await api.gcpGetOfferings({
          projectId: gcpProjectId,
          machineTypes: gcpTypes,
          keyFile: gcpKeyFile,
        });
      } catch (e) {
        if (cloud === "gcp") {
          setStatus(`GCP scan failed: ${e.message || e}`, "error");
          setBusy(false);
          return;
        }
        state.errors = [...(state.errors || []), { message: `GCP: ${e.message || e}` }];
      }
    }
  }

  // Build unified row list.
  const map = new Map(); // key = cloud|region|az|type
  function upsert(region, az, type, patch) {
    const rowCloud = patch.cloud || "aws";
    const key = `${rowCloud}|${region}|${az || ""}|${type}`;
    const existing = map.get(key) || {
      cloud: rowCloud,
      region, az: az || null, instanceType: type, family: familyOf(type),
      ondemandOffered: null, spotScore: null,
    };
    if (patch.ondemandOffered === true) existing.ondemandOffered = true;
    else if (existing.ondemandOffered == null && patch.ondemandOffered === false)
      existing.ondemandOffered = false;
    if (patch.spotScore != null) {
      existing.spotScore =
        existing.spotScore == null ? patch.spotScore : Math.max(existing.spotScore, patch.spotScore);
    }
    map.set(key, existing);
  }

  // Mark unknown OD when we didn't query it.
  const knowOd = mode === "both" || mode === "ondemand";

  for (const [region, azMap] of Object.entries(offerings)) {
    if (azMap && azMap._error) continue;
    for (const [az, types_] of Object.entries(azMap || {})) {
      for (const t of types_) upsert(region, az, t, { ondemandOffered: true });
    }
  }
  for (const s of spot.results) {
    const azName = azIdMap[s.azId] || s.azId || null;
    for (const t of s.instanceTypes || []) {
      upsert(s.region, azName, t, { spotScore: s.score });
    }
  }

  // GCP on-demand offerings — zone is both the AZ and the source of the region.
  for (const [zone, zoneTypes] of Object.entries(gcpOfferings)) {
    const region = zone.split("-").slice(0, -1).join("-");
    for (const t of zoneTypes) {
      upsert(region, zone, t, { ondemandOffered: true, cloud: "gcp" });
    }
  }

  state.rows = [...map.values()].map((r) => ({
    ...r,
    ondemandOffered: r.cloud === "gcp" ? r.ondemandOffered : (knowOd ? r.ondemandOffered === true : null),
  }));
  state.errors = spot.errors || [];

  // Drop selections that no longer match any row in the new scan.
  const validIds = new Set(state.rows.map(rowId));
  for (const id of [...selectedRowIds]) if (!validIds.has(id)) selectedRowIds.delete(id);
  updateSelectionBar();

  rebuildFilterOptions();
  rebuildProbeOptions();
  renderMap();
  renderTable();

  saveScanCache();
  let msg = `Scan complete · ${state.rows.length} (region, AZ, type) rows`;
  if (state.errors.length) msg += ` · ${state.errors.length} warnings (see console)`;
  setStatus(msg, state.errors.length ? "" : "ok");
  if (state.errors.length) console.warn("Spot API warnings:", state.errors);
  setBusy(false);
});

// ---------- Scan cache (persist last results across sessions) --------------
const SCAN_CACHE_KEY = "gpuhunter:scan-cache";

function saveScanCache() {
  try {
    localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify({ rows: state.rows, mode: state.mode, cloud: state.cloud, ts: Date.now() }));
  } catch {}
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function loadScanCache() {
  try {
    const raw = localStorage.getItem(SCAN_CACHE_KEY);
    if (!raw) return;
    const { rows, mode, cloud, ts } = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length) return;
    state.rows = rows;
    state.mode = mode || "ondemand";
    state.cloud = cloud || "aws";
    const cloudRadio = document.querySelector(`input[name="cloud"][value="${state.cloud}"]`);
    if (cloudRadio) { cloudRadio.checked = true; applyCloudFilter(state.cloud); }
    rebuildFilterOptions();
    rebuildProbeOptions();
    renderMap();
    renderTable();
    setStatus(`Showing cached scan from ${timeAgo(ts)} — click Scan to refresh`);
  } catch {}
}

// ---------- Save / load defaults ------------------------------------------
const FACTORY_DEFAULTS = {
  profile: "",
  cloud: "aws",
  gcpProjectId: "",
  gcpKeyFile: "",
  selectedTypes: [
    ...INSTANCE_FAMILIES.g5.sizes,
    ...INSTANCE_FAMILIES.g6.sizes,
    ...INSTANCE_FAMILIES.g6e.sizes,
  ],
  targetCapacity: 4,
  mode: "ondemand",
  includeOptIn: false,
  preferredRegions: [],
  probeDefaultRegion: "us-east-1",
  probeDefaultCount: 1,
};

function getStoredDefaults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...FACTORY_DEFAULTS, ...JSON.parse(raw) } : { ...FACTORY_DEFAULTS };
  } catch {
    return { ...FACTORY_DEFAULTS };
  }
}

function readSidebarState() {
  const stored = getStoredDefaults();
  return {
    ...stored,
    profile: document.getElementById("profile").value,
    cloud: document.querySelector('input[name="cloud"]:checked')?.value || "aws",
    gcpProjectId: document.getElementById("gcpProjectId").value,
    gcpKeyFile: document.getElementById("gcpKeyFile").value,
    selectedTypes: selectedTypes(),
    targetCapacity: parseInt(document.getElementById("targetCapacity").value, 10) || 4,
    mode: document.querySelector('input[name="mode"]:checked').value,
    includeOptIn: document.getElementById("includeOptIn").checked,
  };
}

function applySidebarState(d) {
  if (!d || typeof d !== "object") return;
  if (typeof d.profile === "string") document.getElementById("profile").value = d.profile;
  if (typeof d.gcpProjectId === "string") document.getElementById("gcpProjectId").value = d.gcpProjectId;
  if (typeof d.gcpKeyFile === "string") document.getElementById("gcpKeyFile").value = d.gcpKeyFile;
  if (Number.isFinite(d.targetCapacity))
    document.getElementById("targetCapacity").value = d.targetCapacity;
  document.getElementById("includeOptIn").checked = !!d.includeOptIn;
  if (d.cloud) {
    const r = document.querySelector(`input[name="cloud"][value="${d.cloud}"]`);
    if (r) { r.checked = true; applyCloudFilter(d.cloud); }
  }
  if (d.mode) {
    const r = document.querySelector(`input[name="mode"][value="${d.mode}"]`);
    if (r) r.checked = true;
  }
  if (Array.isArray(d.selectedTypes)) {
    const want = new Set(d.selectedTypes);
    for (const el of document.querySelectorAll(".typeCheck")) el.checked = want.has(el.value);
    for (const fam of Object.keys(INSTANCE_FAMILIES)) updateFamilyState(fam);
  }
}

function applyProbeDefaults(d) {
  if (d.probeDefaultRegion && probeManualRegion.querySelector(`option[value="${d.probeDefaultRegion}"]`)) {
    probeManualRegion.value = d.probeDefaultRegion;
  }
  if (Number.isFinite(d.probeDefaultCount)) {
    document.getElementById("probeCount").value = d.probeDefaultCount;
  }
}

(function loadDefaultsOnStartup() {
  const d = getStoredDefaults();
  applySidebarState(d);
  applyProbeDefaults(d);
  loadScanCache();
})();

// ---------- Defaults modal ------------------------------------------------
const modalEl = document.getElementById("defaultsModal");
const prefRegionsRoot = document.getElementById("prefRegions");
const prefTypesRoot = document.getElementById("prefTypes");
const prefProbeRegion = document.getElementById("prefProbeRegion");

function openDefaultsModal() {
  populateModalFromStorage();
  modalEl.hidden = false;
}
function closeDefaultsModal() {
  modalEl.hidden = true;
}

function populateModalRegions(selected) {
  const sel = new Set(selected || []);
  prefRegionsRoot.innerHTML = Object.keys(REGIONS)
    .sort()
    .map((code) => {
      const optInBadge = isOptIn(code) ? `<span class="opt-in-badge">opt-in</span>` : "";
      return `<label><input type="checkbox" class="prefRegion" value="${code}"${
        sel.has(code) ? " checked" : ""
      }>${code}${optInBadge}</label>`;
    })
    .join("");
}

function populateModalTypes(selected) {
  const want = new Set(selected || []);
  prefTypesRoot.innerHTML = "";
  for (const [fam, meta] of Object.entries(INSTANCE_FAMILIES)) {
    const det = document.createElement("details");
    det.className = "family";
    det.innerHTML = `
      <summary>
        <span class="caret">›</span>
        <input type="checkbox" class="prefFamCheck" data-fam="${fam}">
        <span class="fam-name">${fam}</span>
        <span class="gpu">${escapeHtml(familySpec(meta))} · ${meta.arch}</span>
      </summary>
      <div class="sizes">
        ${meta.sizes
          .map(
            (s) =>
              `<label><input type="checkbox" class="prefTypeCheck" data-fam="${fam}" value="${s}"${
                want.has(s) ? " checked" : ""
              }> ${s}</label>`
          )
          .join("")}
      </div>`;
    prefTypesRoot.appendChild(det);
  }
  // Wire family-master + child interactions for the modal copy.
  for (const cb of prefTypesRoot.querySelectorAll(".prefFamCheck")) {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      const fam = cb.dataset.fam;
      const w = cb.checked;
      for (const c of prefTypesRoot.querySelectorAll(`.prefTypeCheck[data-fam="${fam}"]`)) c.checked = w;
      cb.indeterminate = false;
    });
  }
  for (const cb of prefTypesRoot.querySelectorAll(".prefTypeCheck")) {
    cb.addEventListener("change", () => updatePrefFamilyState(cb.dataset.fam));
  }
  for (const fam of Object.keys(INSTANCE_FAMILIES)) updatePrefFamilyState(fam);
}

function updatePrefFamilyState(fam) {
  const children = [...prefTypesRoot.querySelectorAll(`.prefTypeCheck[data-fam="${fam}"]`)];
  const checked = children.filter((c) => c.checked).length;
  const cb = prefTypesRoot.querySelector(`.prefFamCheck[data-fam="${fam}"]`);
  if (!cb) return;
  if (checked === 0) { cb.checked = false; cb.indeterminate = false; }
  else if (checked === children.length) { cb.checked = true; cb.indeterminate = false; }
  else { cb.checked = false; cb.indeterminate = true; }
}

function populateModalProbeRegion(selectedCode) {
  prefProbeRegion.innerHTML = Object.keys(REGIONS)
    .sort()
    .map((code) => `<option value="${code}"${code === selectedCode ? " selected" : ""}>${escapeHtml(regionLabel(code))}</option>`)
    .join("");
}

function populateModal(d) {
  document.getElementById("prefProfile").value = d.profile || "";
  document.getElementById("prefGcpProjectId").value = d.gcpProjectId || "";
  document.getElementById("prefGcpKeyFile").value = d.gcpKeyFile || "";
  const cloudRadio = document.querySelector(`input[name="prefCloud"][value="${d.cloud || "aws"}"]`);
  if (cloudRadio) cloudRadio.checked = true;
  const themeRadio = document.querySelector(`input[name="prefTheme"][value="${currentTheme()}"]`);
  if (themeRadio) themeRadio.checked = true;
  document.getElementById("prefTargetCapacity").value = d.targetCapacity ?? 4;
  const modeRadio = document.querySelector(`input[name="prefMode"][value="${d.mode || "ondemand"}"]`);
  if (modeRadio) modeRadio.checked = true;
  document.getElementById("prefIncludeOptIn").checked = !!d.includeOptIn;
  document.getElementById("prefProbeCount").value = d.probeDefaultCount ?? 1;
  populateModalRegions(d.preferredRegions);
  populateModalTypes(d.selectedTypes);
  populateModalProbeRegion(d.probeDefaultRegion);
}

function populateModalFromStorage() {
  populateModal(getStoredDefaults());
}

function readModalState() {
  return {
    profile: document.getElementById("prefProfile").value,
    gcpProjectId: document.getElementById("prefGcpProjectId").value.trim(),
    gcpKeyFile: document.getElementById("prefGcpKeyFile").value.trim(),
    cloud: document.querySelector('input[name="prefCloud"]:checked')?.value || "aws",
    selectedTypes: [...prefTypesRoot.querySelectorAll(".prefTypeCheck:checked")].map((e) => e.value),
    targetCapacity: parseInt(document.getElementById("prefTargetCapacity").value, 10) || 4,
    mode: document.querySelector('input[name="prefMode"]:checked')?.value || "ondemand",
    includeOptIn: document.getElementById("prefIncludeOptIn").checked,
    preferredRegions: [...prefRegionsRoot.querySelectorAll(".prefRegion:checked")].map((e) => e.value),
    probeDefaultRegion: prefProbeRegion.value,
    probeDefaultCount: parseInt(document.getElementById("prefProbeCount").value, 10) || 1,
  };
}

document.getElementById("openDefaults").addEventListener("click", openDefaultsModal);
modalEl.addEventListener("click", (e) => {
  if (e.target === modalEl) closeDefaultsModal();
  if (e.target.matches('[data-action="close"]')) closeDefaultsModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalEl.hidden) closeDefaultsModal();
});

document.getElementById("prefRegionsAll").addEventListener("click", () => {
  for (const cb of prefRegionsRoot.querySelectorAll(".prefRegion")) cb.checked = true;
});
document.getElementById("prefRegionsNone").addEventListener("click", () => {
  for (const cb of prefRegionsRoot.querySelectorAll(".prefRegion")) cb.checked = false;
});

document.getElementById("prefSyncFromSidebar").addEventListener("click", () => {
  const current = readSidebarState();
  populateModal({ ...getStoredDefaults(), ...current });
});

document.getElementById("prefReset").addEventListener("click", () => {
  populateModal(FACTORY_DEFAULTS);
});

document.getElementById("prefSave").addEventListener("click", () => {
  const next = readModalState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    setStatus(`Could not save defaults: ${e.message || e}`, "error");
    return;
  }
  const theme = document.querySelector('input[name="prefTheme"]:checked')?.value;
  if (theme && theme !== currentTheme()) applyTheme(theme);
  applySidebarState(next);
  applyProbeDefaults(next);
  closeDefaultsModal();
  setStatus("Defaults saved · applied to current session", "ok");
});
