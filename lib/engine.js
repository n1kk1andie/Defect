/* VM Building Society tracker — rendering engine.
   Ported from the original static app; data + auth + upload/download now flow through
   the Next.js API (/api/*). Mounted by components/TrackerApp.tsx into the shell. */

export function initTracker(opts) {
  var MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var STORAGE = "vmbs-tracker:ui";

  // ---- Formatters ----
  function fmtPct(v) { return v == null || isNaN(v) ? "—" : (v * 100).toFixed(1) + "%"; }
  function fmtScore(v) { return v == null || isNaN(v) ? "—" : Number(v).toFixed(1); }
  function fmtNum(v) { return v == null || isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ---- RAG palettes ----
  var GREEN = { c: "#0E8A4D", bg: "#E5F4EC" }, AMBER = { c: "#A07208", bg: "#FBF2DC" },
      ORANGE = { c: "#C75F00", bg: "#FCEBD9" }, RED = { c: "#8E0E1F", bg: "#F9E2E5" }, GREY = { c: "#8A7E7A", bg: "#F1ECE9" };
  function withLabel(b, l) { return { c: b.c, bg: b.bg, label: l }; }
  function defectBand(v) {
    if (v == null) return withLabel(GREY, "Not tracked");
    if (v < 0.02) return withLabel(GREEN, "On Target");
    if (v < 0.05) return withLabel(AMBER, "Within Limit");
    if (v < 0.10) return withLabel(ORANGE, "Elevated");
    return withLabel(RED, "Breach");
  }
  function scoreBand(v) {
    if (v == null) return withLabel(GREY, "Not tracked");
    if (v >= 95) return withLabel(GREEN, "World Class");
    if (v >= 90) return withLabel(AMBER, "Industry Average");
    if (v >= 80) return withLabel(ORANGE, "Non-Competitive");
    return withLabel(RED, "Unacceptable");
  }
  function heatDefect(v) { return v == null ? "#EFE9E6" : v < 0.02 ? "#0E8A4D" : v < 0.05 ? "#E3B341" : v < 0.10 ? "#E07B00" : "#B5142A"; }
  function heatRes(v) { return v == null ? "#EFE9E6" : v >= 0.95 ? "#0E8A4D" : v >= 0.80 ? "#E3B341" : v >= 0.60 ? "#E07B00" : "#B5142A"; }
  function heatRecurring(v) { return v == null ? "#EFE9E6" : v < 0.10 ? "#0E8A4D" : v < 0.25 ? "#E3B341" : v < 0.50 ? "#E07B00" : "#B5142A"; }
  function heatScore(v) { return v == null ? "#EFE9E6" : v >= 95 ? "#0E8A4D" : v >= 90 ? "#E3B341" : v >= 80 ? "#E07B00" : "#B5142A"; }
  var LEG_DEFECT = [["#0E8A4D", "<2%"], ["#E3B341", "2–5%"], ["#E07B00", "5–10%"], ["#B5142A", "≥10%"], ["#EFE9E6", "n/a"]];
  var LEG_RES = [["#0E8A4D", "≥95%"], ["#E3B341", "80–95%"], ["#E07B00", "60–80%"], ["#B5142A", "<60%"], ["#EFE9E6", "n/a"]];
  var LEG_RECUR = [["#0E8A4D", "<10%"], ["#E3B341", "10–25%"], ["#E07B00", "25–50%"], ["#B5142A", "≥50%"], ["#EFE9E6", "n/a"]];
  var LEG_SCORE = [["#0E8A4D", "≥95 World Class"], ["#E3B341", "90–95 Industry"], ["#E07B00", "80–90 Non-Comp."], ["#B5142A", "<80 Unaccept."], ["#EFE9E6", "n/a"]];

  var GRADES = [{ g: "A", c: "#0E8A4D" }, { g: "B+", c: "#6BA644" }, { g: "B", c: "#E3B341" }, { g: "C", c: "#E07B00" }, { g: "D", c: "#B5142A" }, { g: "F", c: "#6E0715" }];
  function auditGrade(s) {
    if (s == null) return null;
    if (s <= 5) return ({ 5: "A", 4: "B", 3: "C", 2: "D", 1: "F" })[Math.round(s)] || null;
    if (s >= 100) return "A"; if (s >= 80) return "B+"; if (s >= 60) return "B"; if (s >= 40) return "C"; if (s >= 20) return "D"; return "F";
  }

  function periodObjs(isoList) {
    return isoList.map(function (iso) {
      var y = iso.slice(0, 4), m = parseInt(iso.slice(5, 7), 10) - 1;
      return { iso: iso, year: y, monIdx: m, label: MON3[m] + " '" + y.slice(2), full: MON3[m] + " " + y };
    });
  }
  function yearsOf(periods) { return periods.reduce(function (a, p) { if (a.indexOf(p.year) < 0) a.push(p.year); return a; }, []); }
  function assign(f, over) { var o = {}; for (var k in f) o[k] = f[k]; for (var k2 in over) o[k2] = over[k2]; return o; }

  // ===================== DEFECTS MODEL =====================
  function buildDefects() {
    var D = window.DEFECT_DATA;
    var C = { P: 0, B: 1, A: 2, REVIEWED: 3, INSTANCES: 4, DEFECTS: 5, RESOLVABLE: 6, RESOLVED: 7, RECURRING: 8 };
    var periods = periodObjs(D.periods);
    var lastActive = 0;
    D.rows.forEach(function (r) { if (r[C.INSTANCES] > 0 && r[C.P] > lastActive) lastActive = r[C.P]; });
    function matches(r, f) {
      if (f.year !== "all" && periods[r[C.P]].year !== f.year) return false;
      if (f.branch >= 0 && r[C.B] !== f.branch) return false;
      if (f.area >= 0 && r[C.A] !== f.area) return false;
      if (f.period != null && r[C.P] !== f.period) return false;
      return true;
    }
    function filterRows(f) { return D.rows.filter(function (r) { return matches(r, f); }); }
    var METRICS = [
      { key: "defectRate", label: "Defect rate", num: C.DEFECTS, den: C.INSTANCES, betterHigh: false, heat: heatDefect, band: defectBand, legend: LEG_DEFECT },
      { key: "resolutionRate", label: "Resolution rate", num: C.RESOLVED, den: C.RESOLVABLE, betterHigh: true, heat: heatRes, band: null, legend: LEG_RES },
      { key: "recurringRate", label: "Recurring rate", num: C.RECURRING, den: C.DEFECTS, betterHigh: false, heat: heatRecurring, band: null, legend: LEG_RECUR },
    ];
    function metric(k) { for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === k) return METRICS[i]; return METRICS[0]; }
    function aggregate(rows, key) { var m = metric(key), n = 0, d = 0; rows.forEach(function (r) { n += r[m.num]; d += r[m.den]; }); return d ? n / d : null; }
    function record(rows) {
      var a = { reviewed: 0, instances: 0, defects: 0, resolvable: 0, resolved: 0, recurring: 0 };
      rows.forEach(function (r) { a.reviewed += r[C.REVIEWED]; a.instances += r[C.INSTANCES]; a.defects += r[C.DEFECTS]; a.resolvable += r[C.RESOLVABLE]; a.resolved += r[C.RESOLVED]; a.recurring += r[C.RECURRING]; });
      a.defectRate = a.instances ? a.defects / a.instances : null;
      a.resolutionRate = a.resolvable ? a.resolved / a.resolvable : null;
      a.recurringRate = a.defects ? a.recurring / a.defects : null;
      return a;
    }
    function cellValue(bi, pi, key, f) { return aggregate(D.rows.filter(function (r) { return r[C.P] === pi && r[C.B] === bi && (f.area < 0 || r[C.A] === f.area); }), key); }
    function cellDetail(bi, pi, f) {
      var a = record(D.rows.filter(function (r) { return r[C.P] === pi && r[C.B] === bi && (f.area < 0 || r[C.A] === f.area); }));
      return '<span style="font-size:12px;color:#8E0E1F">Defect rate: ' + fmtPct(a.defectRate) + '</span>' +
        '<span style="font-size:12px;color:#0E8A4D">Resolved: ' + fmtPct(a.resolutionRate) + '</span>' +
        '<span style="font-size:12px;color:#C75F00">Recurring: ' + fmtPct(a.recurringRate) + '</span>' +
        '<span style="font-size:12px;font-weight:700">' + fmtNum(a.defects) + ' defects / ' + fmtNum(a.instances) + ' instances</span>';
    }
    function statusCards(rows) {
      var a = record(rows);
      return [{ value: fmtNum(a.reviewed), label: "Files reviewed" }, { value: fmtNum(a.defects), label: "Defects found", color: "#8E0E1F" },
        { value: fmtPct(a.resolutionRate), label: "Defects resolved", color: "#0E8A4D" }, { value: fmtPct(a.recurringRate), label: "Recurring", color: "#C75F00" }];
    }
    function heroSub(rows) { var a = record(rows), b = defectBand(a.defectRate); return fmtNum(a.defects) + " defects across " + fmtNum(a.instances) + " possible instances · " + b.label; }
    function secondaryBreakdown(f) {
      return { title: "By process area", cards: D.areas.map(function (name, i) {
        var a = record(filterRows(assign(f, { area: i })));
        return { name: name, value: fmtPct(a.defectRate), band: defectBand(a.defectRate), sub: fmtNum(a.defects) + " / " + fmtNum(a.instances) };
      }).sort(function (x, y) { return parseFloat(y.value) - parseFloat(x.value); }) };
    }
    var REG_COLS = [
      { k: "name", t: "Branch", type: "text" }, { k: "reviewed", t: "Reviewed", type: "num" }, { k: "instances", t: "Instances", type: "num" },
      { k: "defects", t: "Defects", type: "num" }, { k: "defectRate", t: "Rate", type: "bandpct", band: defectBand },
      { k: "resolved", t: "Resolved", type: "num" }, { k: "resolutionRate", t: "Res %", type: "pct" }, { k: "recurring", t: "Recurring", type: "num" },
    ];
    return { kind: "defects", label: "Branch Defects", branches: D.branches, periods: periods, years: yearsOf(periods), lastActive: lastActive, hasArea: true, areas: D.areas,
      headline: METRICS[0], metrics: METRICS, metric: metric, filterRows: filterRows, aggregate: aggregate, record: record, cellValue: cellValue, cellDetail: cellDetail,
      statusCards: statusCards, heroSub: heroSub, secondaryBreakdown: secondaryBreakdown, regCols: REG_COLS, regField: function (rec, k) { return rec[k]; }, source: "Branch_Defects_Consolidated_2024–2026" };
  }

  // ===================== OPERATIONAL STANDARD MODEL =====================
  function buildOpStd() {
    var O = window.OPSTD_DATA;
    var periods = periodObjs(O.periods);
    var nMetric = O.metrics.length;
    var lut = {}; O.rows.forEach(function (r) { lut[r[0] * 100 + r[1]] = r; });
    var auditByKey = {}; O.rows.forEach(function (r, i) { auditByKey[r[0] * 100 + r[1]] = O.auditRaw[i]; });
    var lastActive = periods.length - 1;
    function matches(r, f) {
      if (f.year !== "all" && periods[r[0]].year !== f.year) return false;
      if (f.branch >= 0 && r[1] !== f.branch) return false;
      if (f.period != null && r[0] !== f.period) return false;
      return true;
    }
    function filterRows(f) { return O.rows.filter(function (r) { return matches(r, f); }); }
    var METRICS = O.metrics.map(function (m, i) { return { key: i, label: m.label, full: m.key, betterHigh: true, heat: heatScore, band: scoreBand, legend: LEG_SCORE }; });
    function metric(k) { return METRICS[k] || METRICS[0]; }
    function mean(vals) { var s = 0, n = 0; vals.forEach(function (v) { if (v != null) { s += v; n++; } }); return n ? s / n : null; }
    function aggregate(rows, key) { return mean(rows.map(function (r) { return r[2 + key]; })); }
    function record(rows) { var rec = {}; for (var i = 0; i < nMetric; i++) rec[i] = mean(rows.map(function (r) { return r[2 + i]; })); return rec; }
    function cellValue(bi, pi, key) { var r = lut[pi * 100 + bi]; return r ? r[2 + key] : null; }
    function cellDetail(bi, pi) {
      var r = lut[pi * 100 + bi];
      if (!r) return '<span class="sub13">No data.</span>';
      return METRICS.map(function (m) { var v = r[2 + m.key], b = scoreBand(v); return '<span style="font-size:12px;color:' + b.c + '">' + esc(m.label) + ": " + fmtScore(v) + "</span>"; }).join("");
    }
    function statusCards(rows) { return [1, 4, 6, 7].map(function (i) { var v = aggregate(rows, i); return { value: fmtScore(v), label: METRICS[i].label, color: scoreBand(v).c }; }); }
    function heroSub(rows) {
      var v = aggregate(rows, 0), b = scoreBand(v), filled = 0;
      rows.forEach(function (r) { if (r[2] != null) filled++; });
      return filled + " of " + rows.length + " branch-months scored · overall standard tracked from May 2025 · " + b.label;
    }
    function secondaryBreakdown(f) {
      var rows = filterRows(f);
      return { title: "By standard", cards: METRICS.slice(1).map(function (m) { var v = aggregate(rows, m.key); return { name: m.label, value: fmtScore(v), band: scoreBand(v), sub: "avg score" }; }).sort(function (x, y) { return parseFloat(x.value) - parseFloat(y.value); }) };
    }
    var REG_COLS = [{ k: "name", t: "Branch", type: "text" }].concat(METRICS.map(function (m, i) { return { k: i, t: m.label, type: i === 0 ? "bandscore" : "score", band: scoreBand }; }));
    function extraSection(f) {
      var months = activeMonths(this);
      var BAR_W = 22, GAP = 4, COL = BAR_W + GAP, CHART_H = 140, NAME_PAD = 4;
      var perMonth = months.map(function (x) {
        var counts = {}; GRADES.forEach(function (gr) { counts[gr.g] = 0; });
        var total = 0;
        for (var bi = 0; bi < O.branches.length; bi++) {
          if (f.branch >= 0 && bi !== f.branch) continue;
          var g = auditGrade(auditByKey[x.pi * 100 + bi]);
          if (g) { counts[g]++; total++; }
        }
        return { x: x, counts: counts, total: total };
      });
      var maxTotal = Math.max.apply(null, perMonth.map(function (d) { return d.total; }).concat(1));
      var bars = perMonth.map(function (d) {
        var segs = GRADES.map(function (gr) {
          var n = d.counts[gr.g]; if (!n) return "";
          var h = (n / maxTotal) * CHART_H;
          return '<div style="width:100%;height:' + h + "px;background:" + gr.c + ';display:flex;align-items:center;justify-content:center;overflow:hidden">' +
            (h >= 12 ? '<span style="font-size:8px;font-weight:800;color:#fff;line-height:1">' + n + "</span>" : "") + "</div>";
        }).join("");
        var tip = GRADES.filter(function (gr) { return d.counts[gr.g]; }).map(function (gr) { return gr.g + ":" + d.counts[gr.g]; }).join("  ");
        return '<div title="' + esc(d.x.p.full + " — " + (tip || "no grade")) + '" style="display:flex;flex-direction:column;align-items:center;width:' + BAR_W + 'px;flex-shrink:0">' +
          '<div style="width:100%;display:flex;flex-direction:column-reverse;border-radius:3px;overflow:hidden">' + segs + "</div>" +
          (d.total ? '<div style="font-size:8px;font-weight:800;color:#1C1416;margin-top:2px;line-height:1">' + d.total + "</div>" : "") + "</div>";
      }).join("");
      var yearGroups = [];
      months.forEach(function (x) { var g = yearGroups[yearGroups.length - 1]; if (!g || g.yr !== x.p.year) yearGroups.push({ yr: x.p.year, count: 1 }); else g.count++; });
      var yearRow = '<div style="display:flex;padding-left:' + NAME_PAD + 'px;margin-top:4px">' + yearGroups.map(function (g, gi) {
        return '<div style="width:' + (g.count * COL) + "px;flex-shrink:0;border-left:" + (gi > 0 ? "2px solid rgba(228,1,43,.2)" : "none") + ';font-family:Sora;font-size:10px;font-weight:800;color:var(--red);text-align:center">' + g.yr + "</div>";
      }).join("") + "</div>";
      var monRow = '<div style="display:flex;padding-left:' + NAME_PAD + 'px">' + months.map(function (x) {
        return '<div style="width:' + COL + 'px;flex-shrink:0;font-size:8px;color:#A89C97;text-align:center;font-weight:600">' + MON3[x.p.monIdx] + "</div>";
      }).join("") + "</div>";
      var legend = '<div class="legend">' + GRADES.map(function (gr) { return '<span><i class="sw" style="background:' + gr.c + '"></i>' + gr.g + "</span>"; }).join("") + "</div>";
      var totalW = months.length * COL + 8;
      return '<div class="h2l">Audit grades by month</div>' +
        '<div class="sub13" style="margin:0 4px 10px">Letter grade derived from the audit score each month, stacked across branches (2024 used a 1–5 scale; 2025+ used A–D). Number on each bar is branches graded that month.</div>' + legend +
        '<div class="card" style="overflow-x:auto;padding:14px 12px 10px"><div style="min-width:' + totalW + 'px">' +
          '<div style="display:flex;align-items:flex-end;height:' + CHART_H + 'px;gap:' + GAP + "px;padding-left:" + NAME_PAD + 'px">' + bars + "</div>" + monRow + yearRow + "</div></div>";
    }
    return { kind: "opstd", label: "Operational Standard", branches: O.branches, periods: periods, years: yearsOf(periods), lastActive: lastActive, hasArea: false, areas: [],
      headline: METRICS[0], metrics: METRICS, metric: metric, filterRows: filterRows, aggregate: aggregate, record: record, cellValue: cellValue, cellDetail: cellDetail,
      statusCards: statusCards, heroSub: heroSub, secondaryBreakdown: secondaryBreakdown, extraSection: extraSection, regCols: REG_COLS, regField: function (rec, k) { return rec[k]; }, source: "Operational_Standards_Consolidated_2024–2026" };
  }

  // ---- Models ----
  var MODELS = {};
  var uploaded = { defects: false, opstd: false };
  function setData(datasets) {
    window.DEFECT_DATA = datasets.defects; window.OPSTD_DATA = datasets.opstd;
    uploaded = datasets.uploaded || { defects: false, opstd: false };
    rebuildModels();
  }
  function rebuildModels() { MODELS.defects = window.DEFECT_DATA ? buildDefects() : null; MODELS.opstd = window.OPSTD_DATA ? buildOpStd() : null; }

  // ---- Admin state + API ----
  var admin = !!opts.initialAdmin;
  function isAdmin() { return admin; }
  var NET_ERR = "Could not reach the server. If this is a protected Vercel preview, open the production URL (or disable Deployment Protection).";
  async function apiCall(url, opts) {
    // Never throws: a thrown fetch (network error / Vercel protection redirect) becomes
    // { ok:false, status:0 } so callers can show a message instead of silently failing.
    try {
      var r = await fetch(url, opts);
      var j = await r.json().catch(function () { return {}; });
      return { ok: r.ok, status: r.status, json: j };
    } catch (e) { return { ok: false, status: 0, json: {} }; }
  }
  var api = {
    async refreshData() {
      var res = await apiCall("/api/data", { cache: "no-store" });
      if (res.ok) setData(res.json);
      return res.ok;
    },
    async login(pw) {
      var res = await apiCall("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
      if (res.ok && res.json.ok) { admin = true; return { ok: true }; }
      if (res.status === 0) return { ok: false, error: NET_ERR };
      return { ok: false, error: res.json.error || (res.status === 401 ? "Incorrect password." : "Sign-in failed (HTTP " + res.status + ").") };
    },
    async logout() { await apiCall("/api/logout", { method: "POST" }); admin = false; },
    async changePassword(cur, nw) {
      var res = await apiCall("/api/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: cur, new: nw }) });
      if (res.ok && res.json.ok) return { ok: true };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Could not update password.") };
    },
    async upload(buf) {
      var res = await apiCall("/api/upload", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf });
      if (res.ok && res.json.ok) return { ok: true, dataset: res.json.dataset, stats: res.json.stats };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Upload failed (HTTP " + res.status + ").") };
    },
    async reset(mode) {
      var res = await apiCall("/api/upload?reset=" + mode, { method: "POST" });
      if (res.ok && res.json.ok) return { ok: true };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Reset failed.") };
    },
    fileUrl(mode) { return "/api/file?dataset=" + mode; },
  };

  // ---- State ----
  var state = {
    mode: "defects", tab: "pulse", year: "all", branch: -1, area: -1,
    heatMetric: { defects: "defectRate", opstd: 0 }, sort: { defects: { key: "defects", dir: -1 }, opstd: { key: 0, dir: -1 } },
    heatSel: null, ui: { msg: "", msgKind: "", pwMsg: "", pwOk: false }, pendingTab: null,
  };
  var savedYear = null;
  try { var saved = JSON.parse(localStorage.getItem(STORAGE) || "{}"); ["mode", "tab"].forEach(function (k) { if (saved[k] != null) state[k] = saved[k]; }); if (saved.year != null) savedYear = saved.year; if (saved.heatMetric) state.heatMetric = saved.heatMetric; } catch (e) {}
  function persist() { try { localStorage.setItem(STORAGE, JSON.stringify({ mode: state.mode, tab: state.tab, year: state.year, heatMetric: state.heatMetric })); } catch (e) {} }
  function model() { return MODELS[state.mode]; }
  function filters() { return { year: state.year, branch: state.branch, area: state.area }; }

  // ---- Shared UI ----
  function scopeLabel(m) {
    var parts = [state.branch < 0 ? "All branches" : m.branches[state.branch]];
    if (m.hasArea) parts.push(state.area < 0 ? "all process areas" : m.areas[state.area]);
    parts.push(state.year === "all" ? m.years[0] + "–" + m.years[m.years.length - 1] : state.year);
    return parts.join(" · ");
  }
  function filterChips(m) {
    var yearOpts = '<option value="all"' + (state.year === "all" ? " selected" : "") + '>All years</option>' + m.years.map(function (y) { return '<option value="' + y + '"' + (state.year === y ? " selected" : "") + '>' + y + '</option>'; }).join("");
    var branchChips = '<button class="chip' + (state.branch < 0 ? " on" : "") + '" data-branch="-1">All branches</button>' + m.branches.map(function (b, i) { return '<button class="chip' + (state.branch === i ? " on" : "") + '" data-branch="' + i + '">' + esc(b) + '</button>'; }).join("");
    var html = '<div class="row between mid" style="margin:2px 4px 8px;gap:8px"><div class="period-select-label">Filters</div><select class="sel" id="year-sel">' + yearOpts + '</select></div>' +
      '<div class="chips"' + (m.hasArea ? ' style="margin-bottom:6px"' : "") + '>' + branchChips + '</div>';
    if (m.hasArea) html += '<div class="chips"><button class="chip' + (state.area < 0 ? " on" : "") + '" data-area="-1">All process areas</button>' + m.areas.map(function (a, i) { return '<button class="chip' + (state.area === i ? " on" : "") + '" data-area="' + i + '">' + esc(a) + '</button>'; }).join("") + '</div>';
    return html;
  }
  function statusCard(c) { return '<div class="card"><div class="num"' + (c.color ? ' style="color:' + c.color + '"' : "") + '>' + c.value + '</div><div class="sub" style="margin-top:2px">' + esc(c.label) + '</div></div>'; }
  function legendRow(items) { return '<div class="legend">' + items.map(function (it) { return '<span><i class="sw" style="background:' + it[0] + '"></i>' + it[1] + '</span>'; }).join("") + '</div>'; }
  function footer(m) { return ""; }
  function activeMonths(m) { return m.periods.map(function (p, pi) { return { p: p, pi: pi }; }).filter(function (x) { return x.pi <= m.lastActive && (state.year === "all" || x.p.year === state.year); }); }

  // ---- Screen: Pulse ----
  function renderPulse() {
    var m = model(), f = filters();
    var rows = m.filterRows(f);
    var hv = m.aggregate(rows, m.headline.key);
    var band = (m.headline.band || defectBand)(hv);
    var hfmt = m.kind === "opstd" ? fmtScore(hv) : fmtPct(hv);
    var status = m.statusCards(rows).map(statusCard).join("");
    var sb = m.secondaryBreakdown(f);
    var sbCards = sb.cards.map(function (c) {
      return '<button class="card btncard"' + (m.kind === "defects" ? ' data-area="' + m.areas.indexOf(c.name) + '"' : "") + '><div class="row between mid"><div style="flex:1;padding-right:10px"><div class="t13">' + esc(c.name) + '</div><div class="sub" style="margin-top:3px">' + esc(c.sub) + '</div></div><span class="statpill" style="background:' + c.band.bg + ';color:' + c.band.c + '">' + c.value + '</span></div></button>';
    }).join("");
    var per = m.branches.map(function (name, i) { return { i: i, name: name, v: m.aggregate(m.filterRows(assign(f, { branch: i })), m.headline.key) }; }).filter(function (x) { return x.v != null; });
    per.sort(function (x, y) { return m.headline.betterHigh ? x.v - y.v : y.v - x.v; });
    var branchCards = per.slice(0, state.branch < 0 ? 6 : 16).map(function (x) {
      var b = (m.headline.band || defectBand)(x.v);
      return '<button class="card btncard" data-branch="' + x.i + '"><div class="row between mid"><div style="flex:1;padding-right:10px"><div class="t14">' + esc(x.name) + '</div><div class="sub" style="margin-top:3px">' + esc(m.headline.label) + '</div></div><span class="statpill" style="background:' + b.bg + ';color:' + b.c + '">' + (m.kind === "opstd" ? fmtScore(x.v) : fmtPct(x.v)) + '</span></div></button>';
    }).join("");
    document.getElementById("content").innerHTML =
      filterChips(m) +
      '<div class="hero"><div class="row between base"><span class="eyebrow">' + esc(m.headline.label.toUpperCase()) + '</span><span class="dim12">' + esc(scopeLabel(m)) + '</span></div><div class="big">' + hfmt + '</div><div class="dim13">' + esc(m.heroSub(rows)) + '</div></div>' +
      '<div class="grid-status">' + status + '</div>' +
      '<div class="h2l">' + esc(m.headline.label) + ' trend</div><div class="card">' + sparkline(m) + '</div>' +
      (m.extraSection ? m.extraSection(f) : "") +
      '<div class="h2l">' + esc(sb.title) + '</div><div class="grid-cats">' + sbCards + '</div>' +
      '<div class="h2l">' + (state.branch < 0 ? "Branches by " + esc(m.headline.label.toLowerCase()) : "Branch detail") + '</div>' +
      '<div class="grid-cats">' + (branchCards || '<div class="card"><div class="sub13">No data for this scope.</div></div>') + '</div>' + footer(m);
  }
  function sparkline(m) {
    var f = filters();
    var data = activeMonths(m).map(function (x) { return { label: x.p.label, v: m.aggregate(m.filterRows(assign(f, { period: x.pi })), m.headline.key) }; });
    var max = Math.max.apply(null, data.map(function (d) { return d.v || 0; }).concat(m.kind === "opstd" ? 100 : 0.001));
    var bars = data.map(function (d) {
      var h = d.v ? Math.max(2, (d.v / max) * 40) : 2;
      var b = (m.headline.band || defectBand)(d.v);
      var val = m.kind === "opstd" ? fmtScore(d.v) : fmtPct(d.v);
      return '<div class="sparkbar" title="' + esc(d.label) + ": " + val + '" style="height:' + h + "px;background:" + (d.v == null ? "#E8E1DD" : b.c) + '"></div>';
    }).join("");
    var first = data[0], last = data[data.length - 1];
    return '<div class="row between base"><span class="sub">' + esc(first ? first.label : "") + '</span><span class="sub">' + esc(last ? last.label : "") + '</span></div><div class="spark">' + bars + '</div>' +
      '<div class="sub" style="margin-top:6px">Bar colour reflects the RAG band for that month. Data through ' + esc(m.periods[m.lastActive].full) + '.</div>';
  }

  // ---- Screen: Heatmap ----
  function renderHeatmap() {
    var m = model(), mk = state.heatMetric[state.mode], metric = m.metric(mk), months = activeMonths(m), f = filters();
    var CELL_W = 22, CELL_H = 16, NAME_W = 130;
    var yearGroups = [];
    months.forEach(function (x) { var g = yearGroups[yearGroups.length - 1]; if (!g || g.yr !== x.p.year) yearGroups.push({ yr: x.p.year, count: 1 }); else g.count++; });
    var headerYears = '<div style="display:flex;padding-left:' + NAME_W + 'px">' + yearGroups.map(function (g, gi) { return '<div style="width:' + (g.count * (CELL_W + 2)) + "px;flex-shrink:0;border-left:" + (gi > 0 ? "2px solid rgba(228,1,43,.2)" : "none") + ';font-family:Sora;font-size:11px;font-weight:800;color:var(--red);text-align:center">' + g.yr + "</div>"; }).join("") + "</div>";
    var headerMonths = '<div style="display:flex;padding-left:' + NAME_W + 'px;margin-bottom:2px">' + months.map(function (x) { return '<div style="width:' + (CELL_W + 2) + 'px;flex-shrink:0;font-size:8px;color:#A89C97;text-align:center;font-weight:600">' + MON3[x.p.monIdx] + "</div>"; }).join("") + "</div>";
    // Branch rows ordered best → worst on the current metric (within the filtered
    // scope), so the grid reads as a gradient: greens at the top down to reds.
    var order = m.branches.map(function (bname, bi) {
      return { bname: bname, bi: bi, v: m.aggregate(m.filterRows(assign(f, { branch: bi })), mk) };
    });
    order.sort(function (x, y) {
      if (x.v == null && y.v == null) return 0;
      if (x.v == null) return 1;
      if (y.v == null) return -1;
      return metric.betterHigh ? y.v - x.v : x.v - y.v;
    });
    var rows = order.map(function (o) {
      var bname = o.bname, bi = o.bi;
      if (state.branch >= 0 && bi !== state.branch) return "";
      var cells = months.map(function (x) {
        var v = m.cellValue(bi, x.pi, mk, f);
        var selq = state.heatSel && state.heatSel.b === bi && state.heatSel.p === x.pi;
        return '<div class="hmcell" data-b="' + bi + '" data-p="' + x.pi + '" style="width:' + CELL_W + "px;height:" + CELL_H + "px;background:" + metric.heat(v) + (selq ? ";outline:2px solid var(--ink);outline-offset:-1px;z-index:1" : "") + '"></div>';
      }).join("");
      return '<div style="display:flex;align-items:center;margin-bottom:2px"><div class="hmname" style="width:' + NAME_W + 'px">' + esc(bname) + "</div>" + cells + "</div>";
    }).join("");
    var metricChips = m.metrics.map(function (mm) { return '<button class="chip' + (mk === mm.key ? " on" : "") + '" data-heat="' + mm.key + '">' + esc(mm.label) + "</button>"; }).join("");
    document.getElementById("content").innerHTML =
      filterChips(m) +
      '<div class="h2l">' + esc(metric.label) + ' history</div><div class="chips" style="margin-bottom:8px">' + metricChips + "</div>" +
      '<div class="sub13" style="margin:0 4px 10px">Each cell is a branch’s ' + esc(metric.label.toLowerCase()) + ' for that month' + (m.hasArea && state.area >= 0 ? " in " + esc(m.areas[state.area]) : "") + ". Tap a cell for detail.</div>" +
      legendRow(metric.legend) +
      '<div class="card" style="overflow-x:auto;padding:12px"><div style="min-width:' + (NAME_W + months.length * (CELL_W + 2)) + 'px">' + headerYears + headerMonths + rows + "</div></div>" +
      '<div id="heat-detail"></div>' + footer(m);
    renderHeatDetail();
  }
  function renderHeatDetail() {
    var el = document.getElementById("heat-detail");
    if (!el) return;
    if (!state.heatSel) { el.innerHTML = ""; return; }
    var m = model(), b = state.heatSel.b, p = state.heatSel.p;
    el.innerHTML = '<div class="notebox" style="margin-top:12px"><div class="b t13">' + esc(m.branches[b]) + " · " + esc(m.periods[p].full) + "</div><div class=\"row gap8 wrap\" style=\"margin-top:6px\">" + m.cellDetail(b, p, filters()) + "</div></div>";
  }

  // ---- Screen: Register ----
  function renderRegister() {
    var m = model(), f = filters();
    var groupBy = m.hasArea && state.branch >= 0 ? "area" : "branch";
    var groups = {};
    m.filterRows(f).forEach(function (r) { var key = groupBy === "area" ? r[2] : r[1]; (groups[key] || (groups[key] = [])).push(r); });
    var rows = Object.keys(groups).map(function (k) { var rec = m.record(groups[k]); rec.name = groupBy === "area" ? m.areas[k] : m.branches[k]; return rec; });
    var sort = state.sort[state.mode];
    rows.sort(function (x, y) {
      if (sort.key === "name") return sort.dir * String(x.name).localeCompare(String(y.name));
      var xv = x[sort.key] == null ? -Infinity : x[sort.key], yv = y[sort.key] == null ? -Infinity : y[sort.key];
      return sort.dir * (xv - yv);
    });
    var total = m.record(m.filterRows(f)); total.name = groupBy === "area" ? "All areas" : "All branches";
    var thead = "<tr>" + m.regCols.map(function (c) { return '<th data-sort="' + c.k + '" class="' + (sort.key == c.k ? "sorted" : "") + '">' + esc(c.t) + (sort.key == c.k ? (sort.dir < 0 ? " ▾" : " ▴") : "") + "</th>"; }).join("") + "</tr>";
    function cell(rec, c) {
      var v = m.regField(rec, c.k);
      if (c.type === "text") return "<td>" + esc(v) + "</td>";
      if (c.type === "num") return "<td>" + fmtNum(v) + "</td>";
      if (c.type === "pct") return "<td>" + fmtPct(v) + "</td>";
      if (c.type === "score") return "<td>" + fmtScore(v) + "</td>";
      if (c.type === "bandpct") { var b = c.band(v); return '<td><span class="statpill" style="background:' + b.bg + ";color:" + b.c + '">' + fmtPct(v) + "</span></td>"; }
      if (c.type === "bandscore") { var b2 = c.band(v); return '<td><span class="statpill" style="background:' + b2.bg + ";color:" + b2.c + '">' + fmtScore(v) + "</span></td>"; }
      return "<td>" + esc(v) + "</td>";
    }
    function rowHtml(rec, isTotal) { return "<tr" + (isTotal ? ' class="total"' : "") + ">" + m.regCols.map(function (c) { return cell(rec, c); }).join("") + "</tr>"; }
    document.getElementById("content").innerHTML =
      filterChips(m) +
      '<div class="h2l">Consolidated register · by ' + groupBy + "</div>" +
      '<div class="sub13" style="margin:0 4px 6px">' + esc(scopeLabel(m)) + " · " + rows.length + " rows · tap a column to sort.</div>" +
      '<div class="tbl-wrap"><table class="reg"><thead>' + thead + "</thead><tbody>" + rows.map(function (r) { return rowHtml(r, false); }).join("") + rowHtml(total, true) + "</tbody></table></div>" + footer(m);
  }

  // ---- Screen: Report ----
  // A document-style page (title block, prose summary, plain key figures, data table),
  // deliberately unlike the card/hero dashboard on the other tabs.
  function renderReport() {
    var m = model(), f = filters();
    var rows = m.filterRows(f);
    var rec = m.record(rows);
    var hv = m.aggregate(rows, m.headline.key);
    var band = (m.headline.band || defectBand)(hv);
    var hfmt = m.kind === "opstd" ? fmtScore(hv) : fmtPct(hv);

    var now = new Date();
    var genDate = MON3[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();

    // Executive narrative.
    var narr;
    if (m.kind === "defects") {
      narr = fmtNum(rec.defects) + " defects were identified across " + fmtNum(rec.instances) +
        " reviewed instances — a defect rate of " + fmtPct(rec.defectRate) + " (" + band.label + "). " +
        fmtPct(rec.resolutionRate) + " of resolvable defects have been resolved, and " + fmtPct(rec.recurringRate) +
        " of defects are recurring.";
    } else {
      narr = "The overall operational standard averages " + fmtScore(hv) + " (" + band.label + "). " + m.heroSub(rows) + ".";
    }

    // Key figures as plain document stats (no coloured cards).
    var keyFigs = m.statusCards(rows).map(function (c) {
      return '<div style="min-width:120px"><div style="font-family:Sora;font-size:22px;font-weight:800;color:' + (c.color || "var(--ink)") + '">' + c.value + '</div>' +
        '<div class="sub" style="margin-top:2px">' + esc(c.label) + "</div></div>";
    }).join("");

    // Data table: aggregated by branch (or by area when a single branch is scoped),
    // ranked on the headline metric, with a totals row — reusing the register columns.
    var groupBy = m.hasArea && state.branch >= 0 ? "area" : "branch";
    var groups = {};
    rows.forEach(function (r) { var key = groupBy === "area" ? r[2] : r[1]; (groups[key] || (groups[key] = [])).push(r); });
    var recs = Object.keys(groups).map(function (k) { var g = m.record(groups[k]); g.name = groupBy === "area" ? m.areas[k] : m.branches[k]; return g; });
    recs.sort(function (x, y) {
      var xv = x[m.headline.key], yv = y[m.headline.key];
      if (xv == null) return 1; if (yv == null) return -1;
      return m.headline.betterHigh ? yv - xv : xv - yv;
    });
    var total = m.record(rows); total.name = groupBy === "area" ? "All areas" : "All branches";
    function repCell(g, c) {
      var v = m.regField(g, c.k);
      if (c.type === "text") return "<td>" + esc(v) + "</td>";
      if (c.type === "num") return "<td>" + fmtNum(v) + "</td>";
      if (c.type === "pct") return "<td>" + fmtPct(v) + "</td>";
      if (c.type === "score") return "<td>" + fmtScore(v) + "</td>";
      if (c.type === "bandpct") { var b = c.band(v); return '<td><span class="statpill" style="background:' + b.bg + ";color:" + b.c + '">' + fmtPct(v) + "</span></td>"; }
      if (c.type === "bandscore") { var b2 = c.band(v); return '<td><span class="statpill" style="background:' + b2.bg + ";color:" + b2.c + '">' + fmtScore(v) + "</span></td>"; }
      return "<td>" + esc(v) + "</td>";
    }
    function repRow(g, isTotal) { return "<tr" + (isTotal ? ' class="total"' : "") + ">" + m.regCols.map(function (c) { return repCell(g, c); }).join("") + "</tr>"; }
    var thead = "<tr>" + m.regCols.map(function (c) { return "<th>" + esc(c.t) + "</th>"; }).join("") + "</tr>";
    var tableTitle = groupBy === "area" ? "Detail by process area" : "Performance by branch";

    document.getElementById("content").innerHTML =
      filterChips(m) +
      downloadPanel(m) +
      '<div class="report">' +
        '<div class="row between" style="gap:10px;align-items:flex-start">' +
          '<div style="flex:1;min-width:0">' +
            '<div class="report-title">' + esc(m.label) + " report</div>" +
            '<div class="sub13" style="margin-top:6px">' + esc(scopeLabel(m)) + "</div>" +
            '<div class="sub" style="margin-top:3px">Generated ' + esc(genDate) + ' · Source: ' + esc(m.source) + '</div>' +
          "</div>" +
        "</div>" +
        '<div class="row mid gap10" style="margin:18px 0 2px">' +
          '<span style="font-family:Sora;font-size:30px;font-weight:800">' + hfmt + "</span>" +
          '<span class="statpill" style="background:' + band.bg + ";color:" + band.c + '">' + esc(m.headline.label) + " · " + esc(band.label) + "</span>" +
        "</div>" +
        '<hr class="report-rule">' +
        '<div class="report-h">Executive summary</div>' +
        '<div class="sub13" style="margin-bottom:20px">' + narr + "</div>" +
        '<div class="report-h">Key figures</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:22px;margin-bottom:22px">' + keyFigs + "</div>" +
        '<div class="report-h">' + esc(tableTitle) + " · " + recs.length + " rows</div>" +
        '<div class="tbl-wrap" style="margin-top:0;box-shadow:none;border:1px solid var(--line)"><table class="reg"><thead>' + thead + "</thead><tbody>" +
          recs.map(function (g) { return repRow(g, false); }).join("") + repRow(total, true) + "</tbody></table></div>" +
      "</div>" + footer(m);
  }

  // ---- Screen: Settings (admin only) ----
  function renderSettings() {
    var m = model();
    if (!isAdmin()) {
      document.getElementById("content").innerHTML =
        '<div class="card awaiting"><div class="ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E4012B" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>' +
        '<div class="t15" style="margin-bottom:6px">Admin sign-in required</div><div class="sub13" style="max-width:320px;margin:0 auto 14px">Settings — data download/upload and the admin password — are available to admins.</div>' +
        '<button class="cta" style="max-width:220px;margin:0 auto" data-action="login">Sign in as admin</button></div>' + footer(m);
      return;
    }
    var ui = state.ui;
    var badge = uploaded[state.mode] ? '<span class="srcbadge live">Uploaded</span>' : '<span class="srcbadge">Built-in</span>';
    var msgHtml = ui.msg ? '<div class="msgbox ' + (ui.msgKind === "ok" ? "ok" : "info") + '">' + esc(ui.msg) + "</div>" : "";
    var pwHtml = ui.pwMsg ? '<div style="font-size:12px;margin-top:8px;font-weight:600;color:' + (ui.pwOk ? "#0E8A4D" : "#8E0E1F") + '">' + esc(ui.pwMsg) + "</div>" : "";
    var steps = m.kind === "defects"
      ? [["1", "Download", 'Tap "Download" above to get the current Branch Defects workbook.'], ["2", "Add the new month", "Append rows for the new period — one per branch × process area. Keep the same headers. The app derives rates and month from the Period date."], ["3", "Upload & verify", 'Save the file, then tap "Upload" below. It is saved to shared storage and published for everyone.']]
      : [["1", "Download", 'Tap "Download" above to get the current Operational Standard workbook.'], ["2", "Add the new month", "Append one row per branch for the new Year/Month with each 0–100 score. Leave a cell blank if not measured. Audit Score may be 1–5 or 20–100 — the app derives the grade."], ["3", "Upload & verify", 'Save the file, then tap "Upload" below. It is saved to shared storage and published for everyone.']];
    document.getElementById("content").innerHTML =
      '<div class="h2l">Data file · ' + esc(m.label) + "</div>" +
      '<div class="card" style="margin-bottom:10px"><div class="row between mid" style="margin-bottom:12px"><div><div class="t14">Current data</div><div class="sub13" style="margin-top:3px">' + (uploaded[state.mode] ? "Uploaded" : "Built-in") + " · " + m.periods.length + " months · " + m.branches.length + ' branches</div></div>' + badge + "</div>" +
        '<div class="row gap8" style="margin-bottom:10px"><button class="cta" style="flex:1" data-action="download">⬇ Download .xlsx</button><button class="cta" style="flex:1;background:#1C1416" data-action="reset-data">↺ Reset to built-in</button></div>' +
        '<label class="dropzone">⬆ Upload updated .xlsx<input type="file" accept=".xlsx" id="upload-input" style="display:none" /></label>' + msgHtml + "</div>" +
      '<div class="card" style="margin-bottom:10px"><div class="t14" style="margin-bottom:10px">Monthly update instructions</div>' +
        steps.map(function (s, i) { return '<div style="display:flex;gap:10px;padding:9px 0;' + (i ? "border-top:1px solid #F1ECE9;" : "") + 'align-items:flex-start"><div style="font-family:Sora;font-size:11px;font-weight:800;color:var(--red);flex-shrink:0;padding-top:2px;min-width:16px">' + s[0] + '</div><div><div style="font-size:12px;font-weight:700;margin-bottom:2px">' + esc(s[1]) + '</div><div class="sub13" style="line-height:1.5">' + esc(s[2]) + "</div></div></div>"; }).join("") + "</div>" +
      '<div class="h2l" style="margin-top:18px">Admin password</div>' +
      '<div class="card" style="margin-bottom:10px"><div class="sub13" style="margin-bottom:12px">Change the password used to sign in as admin. It is hashed and stored server-side and applies to every browser.</div>' +
        '<input class="login-in" id="pw-cur" type="password" autocomplete="current-password" placeholder="Current password" /><input class="login-in" id="pw-new" type="password" autocomplete="new-password" placeholder="New password" /><input class="login-in" id="pw-new2" type="password" autocomplete="new-password" placeholder="Confirm new password" />' +
        '<button class="cta" data-action="change-pw">Update password</button>' + pwHtml + "</div>" +
      '<div class="h2l" style="margin-top:18px">Admin session</div><div class="card"><div class="sub13" style="margin-bottom:12px">You are signed in as admin.</div><button class="cta2" data-action="logout">Sign out</button></div>' + footer(m);
  }

  // ---- Login modal ----
  function showLoginModal(err) {
    document.getElementById("modal-root").innerHTML =
      '<div class="overlay" data-action="modal-close"><div class="modal" data-stop><button class="modalx" data-action="modal-close">✕</button>' +
        '<div class="t15" style="margin-bottom:4px">Admin sign-in</div><div class="sub13" style="margin-bottom:12px">Enter the admin password to manage data.</div>' +
        (err ? '<div class="errmsg">' + esc(err) + "</div>" : "") +
        '<input class="login-in" id="login-pw" type="password" placeholder="Password" /><button class="cta" data-action="login-submit">Unlock</button></div></div>';
    var el = document.getElementById("login-pw");
    if (el) { el.focus(); el.addEventListener("keydown", function (e) { if (e.key === "Enter") submitLogin(); }); }
  }
  function hideModal() { document.getElementById("modal-root").innerHTML = ""; }
  async function submitLogin() {
    var el = document.getElementById("login-pw");
    var res = await api.login(el ? el.value : "");
    if (res.ok) { hideModal(); if (state.pendingTab) { state.tab = state.pendingTab; state.pendingTab = null; } persist(); render(); }
    else showLoginModal(res.error);
  }

  // ---- Tabs ----
  var TABS = [
    { id: "pulse", label: "Pulse", icon: "M3 12h4l3-8 4 16 3-8h4" },
    { id: "register", label: "Register", icon: "M4 6h16M4 12h16M4 18h10" },
    { id: "heatmap", label: "History", icon: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2" },
    { id: "report", label: "Report", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" },
    { id: "settings", label: "Settings", admin: true, icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" },
  ];
  function renderTabs() {
    document.getElementById("tabbar").innerHTML = TABS.map(function (t) {
      var locked = t.admin && !isAdmin();
      return '<button class="tabbtn' + (state.tab === t.id ? " on" : "") + '" data-tab="' + t.id + '"><span class="iconwrap"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + t.icon + '"/></svg>' +
        (locked ? '<span class="tablock"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8A7E7A" stroke-width="3"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>' : "") +
        "</span><span>" + t.label + "</span></button>";
    }).join("");
  }

  // ---- Dispatch ----
  function render() {
    var m = model();
    document.getElementById("appbar-sub").textContent = m.label + " · Latest data " + m.periods[m.lastActive].full;
    var badge = document.getElementById("src-badge");
    badge.textContent = uploaded[state.mode] ? "Uploaded" : "Built-in data"; badge.className = "srcbadge live";
    document.getElementById("auth-slot").innerHTML = isAdmin()
      ? '<button class="userchip" data-action="logout" title="Sign out of admin">A</button>'
      : '<button class="loginpill" data-action="login"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Login</button>';
    Array.prototype.forEach.call(document.querySelectorAll("#mode-toggle button"), function (b) { b.classList.toggle("on", b.getAttribute("data-mode") === state.mode); });
    renderTabs();
    if (state.tab === "settings") renderSettings();
    else if (state.tab === "heatmap") renderHeatmap();
    else if (state.tab === "register") renderRegister();
    else if (state.tab === "report") renderReport();
    else renderPulse();
  }

  // ---- Downloads (CSV / Excel / PDF, any date range, current branch/area scope) ----
  function csvq(s) { return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"'; }
  function periodByIso(m, iso) { for (var i = 0; i < m.periods.length; i++) if (m.periods[i].iso === iso) return m.periods[i]; return null; }
  // Raw rows within [from,to] (inclusive ISO), honouring the current branch/area filter.
  function rowsInRange(m, from, to) {
    return m.filterRows({ year: "all", branch: state.branch, area: state.area }).filter(function (r) {
      var iso = m.periods[r[0]].iso;
      return (!from || iso >= from) && (!to || iso <= to);
    });
  }
  function rangeTag(from, to) { return (from ? from.slice(0, 7) : "start") + "_to_" + (to ? to.slice(0, 7) : "end"); }
  function fileBase(m) { return m.kind === "defects" ? "branch-defects" : "operational-standard"; }
  function saveBlob(text, type, filename) {
    var blob = new Blob([text], { type: type }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvFor(m, rows) {
    var lines;
    if (m.kind === "defects") {
      lines = ["Period,Branch,Process Area,Items Reviewed,Possible Instances,Defects,Defect Rate,Resolvable,Resolved,Resolution Rate,Recurring,Recurring Rate"];
      rows.forEach(function (r) {
        var dr = r[4] ? r[5] / r[4] : "", rr = r[6] ? r[7] / r[6] : "", rc = r[5] ? r[8] / r[5] : "";
        lines.push([m.periods[r[0]].iso, csvq(m.branches[r[1]]), csvq(m.areas[r[2]]), r[3], r[4], r[5], dr, r[6], r[7], rr, r[8], rc].join(","));
      });
    } else {
      lines = ["Period,Branch," + m.metrics.map(function (x) { return csvq(x.label); }).join(",")];
      rows.forEach(function (r) { lines.push([m.periods[r[0]].iso, csvq(m.branches[r[1]])].concat(m.metrics.map(function (x) { return r[2 + x.key] == null ? "" : r[2 + x.key]; })).join(",")); });
    }
    return lines.join("\n");
  }

  // Aggregated, printable report for the range — rendered to an offscreen iframe so the
  // browser's "Save as PDF" captures just the report, not the app shell.
  function pdfCell(m, rec, c) {
    var v = m.regField(rec, c.k);
    if (c.type === "text") return esc(v);
    if (c.type === "num") return fmtNum(v);
    if (c.type === "pct") return fmtPct(v);
    if (c.type === "score") return fmtScore(v);
    if (c.type === "bandpct") { var b = c.band(v); return '<span class="pill" style="background:' + b.bg + ';color:' + b.c + '">' + fmtPct(v) + '</span>'; }
    if (c.type === "bandscore") { var b2 = c.band(v); return '<span class="pill" style="background:' + b2.bg + ';color:' + b2.c + '">' + fmtScore(v) + '</span>'; }
    return esc(v);
  }
  function reportHTML(m, rows, from, to) {
    var groupBy = m.hasArea && state.branch >= 0 ? "area" : "branch";
    var groups = {};
    rows.forEach(function (r) { var key = groupBy === "area" ? r[2] : r[1]; (groups[key] || (groups[key] = [])).push(r); });
    var recs = Object.keys(groups).map(function (k) { var rec = m.record(groups[k]); rec.name = groupBy === "area" ? m.areas[k] : m.branches[k]; return rec; });
    recs.sort(function (x, y) {
      var xv = x[m.headline.key], yv = y[m.headline.key];
      if (xv == null) return 1; if (yv == null) return -1;
      return m.headline.betterHigh ? yv - xv : xv - yv;
    });
    var total = m.record(rows); total.name = groupBy === "area" ? "All areas" : "All branches";
    var hv = m.aggregate(rows, m.headline.key), band = (m.headline.band || defectBand)(hv);
    var hfmt = m.kind === "opstd" ? fmtScore(hv) : fmtPct(hv);
    var fromP = periodByIso(m, from), toP = periodByIso(m, to);
    var rangeLabel = (fromP ? fromP.full : "start") + " – " + (toP ? toP.full : "end");
    var scope = (state.branch < 0 ? "All branches" : m.branches[state.branch]) + (m.hasArea ? " · " + (state.area < 0 ? "all process areas" : m.areas[state.area]) : "");
    var now = new Date(), genDate = MON3[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
    var cards = m.statusCards(rows).map(function (c) {
      return '<div class="kf"><div class="kfv" style="color:' + (c.color || "#1C1416") + '">' + c.value + '</div><div class="kfl">' + esc(c.label) + '</div></div>';
    }).join("");
    var thead = m.regCols.map(function (c) { return '<th class="' + (c.type === "text" ? "l" : "r") + '">' + esc(c.t) + '</th>'; }).join("");
    var body = recs.map(function (rec) {
      return '<tr>' + m.regCols.map(function (c) { return '<td class="' + (c.type === "text" ? "l" : "r") + '">' + pdfCell(m, rec, c) + '</td>'; }).join("") + '</tr>';
    }).join("");
    var totalRow = '<tr class="total">' + m.regCols.map(function (c) { return '<td class="' + (c.type === "text" ? "l" : "r") + '">' + pdfCell(m, total, c) + '</td>'; }).join("") + '</tr>';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(m.label) + ' report</title><style>' +
      '*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1C1416;margin:28px;font-size:13px}' +
      'h1{font-size:20px;margin:0 0 2px}.meta{color:#6E625E;font-size:12px;line-height:1.6;margin-bottom:16px}' +
      '.hl{display:flex;align-items:baseline;gap:10px;margin:10px 0 14px}.hl .v{font-size:30px;font-weight:800}.hl .b{font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;background:' + band.bg + ';color:' + band.c + '}' +
      '.kfs{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}.kf{border:1px solid #EEE7E3;border-radius:10px;padding:10px 14px;min-width:120px}.kfv{font-size:20px;font-weight:800}.kfl{font-size:11px;color:#6E625E;margin-top:2px}' +
      'table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:7px 9px;border-bottom:1px solid #EEE7E3}th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6E625E;text-align:right}th.l,td.l{text-align:left}th.r,td.r{text-align:right}' +
      'tr.total td{font-weight:800;background:#FAF7F5;border-top:2px solid #EEE7E3}.pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}' +
      '@page{margin:14mm}</style></head><body>' +
      '<h1>' + esc(m.label) + ' — report</h1>' +
      '<div class="meta">' + esc(rangeLabel) + ' · ' + esc(scope) + '<br>Generated ' + esc(genDate) + ' · Source: ' + esc(m.source) + '</div>' +
      '<div class="hl"><span class="v">' + hfmt + '</span><span class="b">' + esc(m.headline.label) + ' · ' + esc(band.label) + '</span></div>' +
      '<div class="kfs">' + cards + '</div>' +
      '<table><thead><tr>' + thead + '</tr></thead><tbody>' + body + totalRow + '</tbody></table>' +
      '</body></html>';
  }
  function printReport(html) {
    var f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(f);
    var d = f.contentWindow.document;
    d.open(); d.write(html); d.close();
    var done = false, cleanup = function () { if (!done) { done = true; setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1000); } };
    f.contentWindow.onafterprint = cleanup;
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} cleanup(); }, 350);
  }

  function runDownload() {
    var m = model(), dl = state.dl, rows = rowsInRange(m, dl.from, dl.to);
    var tag = rangeTag(dl.from, dl.to);
    if (dl.format === "xlsx") {
      var url = "/api/export?dataset=" + state.mode + "&from=" + encodeURIComponent(dl.from) + "&to=" + encodeURIComponent(dl.to) + "&branch=" + state.branch + "&area=" + state.area;
      window.location.href = url;
    } else if (dl.format === "pdf") {
      printReport(reportHTML(m, rows, dl.from, dl.to));
    } else {
      saveBlob(csvFor(m, rows), "text/csv", fileBase(m) + "-" + tag + ".csv");
    }
    hideModal();
  }

  // ---- Download panel (inline, above the report) ----
  // Rendered at the top of the Report page so the format/date-range options are
  // visible immediately, without scrolling past the report to reach them.
  function ensureDlState(m) {
    var isoSet = {};
    m.periods.forEach(function (p) { isoSet[p.iso] = 1; });
    if (!state.dl || !isoSet[state.dl.from] || !isoSet[state.dl.to]) {
      state.dl = { format: (state.dl && state.dl.format) || "csv", from: m.periods[0].iso, to: m.periods[m.lastActive].iso };
    }
    var dl = state.dl;
    if (dl.from > dl.to) { var t = dl.from; dl.from = dl.to; dl.to = t; }
    return dl;
  }
  function downloadPanel(m) {
    var dl = ensureDlState(m);
    var scope = (state.branch < 0 ? "All branches" : m.branches[state.branch]) + (m.hasArea ? " · " + (state.area < 0 ? "all process areas" : m.areas[state.area]) : "");
    var fmts = [["csv", "CSV"], ["xlsx", "Excel"], ["pdf", "PDF"]];
    var fmtChips = fmts.map(function (o) { return '<button class="chip' + (dl.format === o[0] ? " on" : "") + '" data-dlfmt="' + o[0] + '">' + o[1] + "</button>"; }).join("");
    var optsFor = function (sel) { return m.periods.map(function (p) { return '<option value="' + p.iso + '"' + (sel === p.iso ? " selected" : "") + ">" + esc(p.full) + "</option>"; }).join(""); };
    var note = dl.format === "pdf"
      ? "PDF is an aggregated report (a printable summary by " + (m.hasArea && state.branch >= 0 ? "process area" : "branch") + "). CSV and Excel contain the underlying monthly rows."
      : "Row-level data for every month in the range, within the current scope.";
    return '<div class="card no-print" style="margin-bottom:12px">' +
        '<div class="row between mid" style="gap:10px;margin-bottom:12px">' +
          '<div style="min-width:0"><div class="t14">Download data</div>' +
            '<div class="sub13" style="margin-top:3px">' + esc(m.label) + ' · ' + esc(scope) + '</div></div>' +
          '<button class="lockbtn" data-action="print" title="Print or save as PDF" aria-label="Print report">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>' +
        "</div>" +
        '<div class="period-select-label" style="margin-bottom:6px">Format</div>' +
        '<div class="chips" style="margin-bottom:14px">' + fmtChips + '</div>' +
        '<div class="period-select-label" style="margin-bottom:6px">Date range</div>' +
        '<div class="row gap8" style="margin-bottom:6px"><select class="sel" id="dl-from" style="flex:1">' + optsFor(dl.from) + '</select>' +
          '<span style="align-self:center;color:#8A7E7A;font-size:12px">to</span>' +
          '<select class="sel" id="dl-to" style="flex:1">' + optsFor(dl.to) + '</select></div>' +
        '<div class="sub13" style="margin:8px 0 14px">' + esc(note) + '</div>' +
        '<button class="cta" data-action="download-run">Download ' + esc(dl.format.toUpperCase()) + '</button>' +
      "</div>";
  }

  // Same controls as a modal, opened from the global download button in the app bar
  // (available on every tab, unlike the inline panel which only lives on the report).
  function showDownloadModal() {
    var m = model();
    var dl = ensureDlState(m);
    var scope = (state.branch < 0 ? "All branches" : m.branches[state.branch]) + (m.hasArea ? " · " + (state.area < 0 ? "all process areas" : m.areas[state.area]) : "");
    var fmts = [["csv", "CSV"], ["xlsx", "Excel"], ["pdf", "PDF"]];
    var fmtChips = fmts.map(function (o) { return '<button class="chip' + (dl.format === o[0] ? " on" : "") + '" data-dlfmt="' + o[0] + '">' + o[1] + "</button>"; }).join("");
    var optsFor = function (sel) { return m.periods.map(function (p) { return '<option value="' + p.iso + '"' + (sel === p.iso ? " selected" : "") + ">" + esc(p.full) + "</option>"; }).join(""); };
    var note = dl.format === "pdf"
      ? "PDF is an aggregated report (a printable summary by " + (m.hasArea && state.branch >= 0 ? "process area" : "branch") + "). CSV and Excel contain the underlying monthly rows."
      : "Row-level data for every month in the range, within the current scope.";
    document.getElementById("modal-root").innerHTML =
      '<div class="overlay" data-action="modal-close"><div class="modal" data-stop><button class="modalx" data-action="modal-close">✕</button>' +
        '<div class="t15" style="margin-bottom:4px">Download data</div>' +
        '<div class="sub13" style="margin-bottom:14px">' + esc(m.label) + ' · ' + esc(scope) + '</div>' +
        '<div class="period-select-label" style="margin-bottom:6px">Format</div>' +
        '<div class="chips" style="margin-bottom:14px">' + fmtChips + '</div>' +
        '<div class="period-select-label" style="margin-bottom:6px">Date range</div>' +
        '<div class="row gap8" style="margin-bottom:6px"><select class="sel" id="dl-from" style="flex:1">' + optsFor(dl.from) + '</select>' +
          '<span style="align-self:center;color:#8A7E7A;font-size:12px">to</span>' +
          '<select class="sel" id="dl-to" style="flex:1">' + optsFor(dl.to) + '</select></div>' +
        '<div class="sub13" style="margin:8px 0 14px">' + esc(note) + '</div>' +
        '<button class="cta" data-action="download-run">Download ' + esc(dl.format.toUpperCase()) + '</button>' +
      '</div></div>';
  }

  // ---- Actions ----
  function val(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  async function handleAction(a) {
    if (a === "print") { window.print(); return; }
    if (a === "download-run") { runDownload(); return; }
    if (a === "login") { showLoginModal(); return; }
    if (a === "login-submit") { submitLogin(); return; }
    if (a === "modal-close") { hideModal(); state.pendingTab = null; return; }
    if (a === "logout") { await api.logout(); if (state.tab === "settings") state.tab = "pulse"; render(); return; }
    if (a === "download") { window.location.href = api.fileUrl(state.mode); state.ui.msg = "✓ Downloading the current " + model().label + " workbook…"; state.ui.msgKind = "ok"; render(); return; }
    if (a === "reset-data") {
      if (!uploaded[state.mode]) { state.ui.msg = "Already using built-in data."; state.ui.msgKind = "info"; render(); return; }
      state.ui.msg = "Resetting…"; state.ui.msgKind = "info"; render();
      var rr = await api.reset(state.mode);
      if (rr.ok) { await api.refreshData(); state.ui.msg = "✓ Reset to built-in " + model().label + " data."; state.ui.msgKind = "ok"; }
      else { state.ui.msg = "Reset failed: " + rr.error; state.ui.msgKind = "info"; }
      render(); return;
    }
    if (a === "change-pw") {
      var cur = val("pw-cur"), nw = val("pw-new"), nw2 = val("pw-new2");
      if (nw !== nw2) { state.ui.pwMsg = "New passwords don't match."; state.ui.pwOk = false; render(); return; }
      var res = await api.changePassword(cur, nw);
      state.ui.pwOk = res.ok; state.ui.pwMsg = res.ok ? "✓ Admin password updated." : res.error; render(); return;
    }
  }
  async function handleUpload(file) {
    state.ui.msg = "Uploading…"; state.ui.msgKind = "info"; render();
    var buf;
    try { buf = await file.arrayBuffer(); } catch (e) { state.ui.msg = "Could not read file."; state.ui.msgKind = "info"; render(); return; }
    var res = await api.upload(buf);
    if (res.ok) {
      await api.refreshData();
      if (state.mode !== res.dataset) { state.mode = res.dataset; state.branch = -1; state.area = -1; }
      state.tab = "settings"; state.heatSel = null;
      var mm = MODELS[res.dataset];
      state.ui.msg = "✓ " + mm.label + " uploaded & published — " + mm.periods.length + " months · " + mm.branches.length + " branches.";
      state.ui.msgKind = "ok"; persist(); render();
    } else { state.ui.msg = "Upload failed: " + res.error; state.ui.msgKind = "info"; render(); }
  }

  // ---- Events ----
  function onClick(e) {
    var t = e.target.closest("[data-mode],[data-tab],[data-branch],[data-area],[data-heat],[data-b][data-p],[data-sort],[data-action],[data-dlfmt],[data-stop]");
    if (!t) return;
    if (t.hasAttribute("data-action")) { handleAction(t.getAttribute("data-action")); return; }
    if (t.hasAttribute("data-dlfmt")) {
      if (state.dl) state.dl.format = t.getAttribute("data-dlfmt");
      var mr = document.getElementById("modal-root");
      if (mr && mr.innerHTML) showDownloadModal(); else renderReport();
      return;
    }
    if (t.hasAttribute("data-stop")) return;
    if (t.hasAttribute("data-mode")) { if (state.mode !== t.getAttribute("data-mode")) { state.mode = t.getAttribute("data-mode"); state.branch = -1; state.area = -1; state.heatSel = null; state.ui.msg = ""; } persist(); render(); return; }
    if (t.hasAttribute("data-tab")) {
      var tab = t.getAttribute("data-tab");
      if (tab === "settings" && !isAdmin()) { state.pendingTab = "settings"; showLoginModal(); return; }
      state.tab = tab; state.heatSel = null; state.ui.msg = ""; persist(); render(); window.scrollTo(0, 0); return;
    }
    if (t.hasAttribute("data-heat")) { var k = t.getAttribute("data-heat"); state.heatMetric[state.mode] = isNaN(+k) ? k : +k; state.heatSel = null; persist(); render(); return; }
    if (t.hasAttribute("data-sort")) { var sk = t.getAttribute("data-sort"), key = isNaN(+sk) ? sk : +sk, s = state.sort[state.mode]; if (s.key == key) s.dir *= -1; else state.sort[state.mode] = { key: key, dir: key === "name" ? 1 : -1 }; renderRegister(); return; }
    if (t.hasAttribute("data-b") && t.hasAttribute("data-p")) { var b = +t.getAttribute("data-b"), p = +t.getAttribute("data-p"); state.heatSel = (state.heatSel && state.heatSel.b === b && state.heatSel.p === p) ? null : { b: b, p: p }; renderHeatmap(); return; }
    if (t.hasAttribute("data-branch")) { state.branch = +t.getAttribute("data-branch"); state.heatSel = null; render(); return; }
    if (t.hasAttribute("data-area")) { state.area = +t.getAttribute("data-area"); state.heatSel = null; render(); return; }
  }
  function onChange(e) {
    if (e.target.id === "year-sel") { state.year = e.target.value; state.heatSel = null; persist(); render(); }
    else if (e.target.id === "dl-from") { if (state.dl) state.dl.from = e.target.value; }
    else if (e.target.id === "dl-to") { if (state.dl) state.dl.to = e.target.value; }
    else if (e.target.id === "upload-input") { var f = e.target.files && e.target.files[0]; if (f) handleUpload(f); e.target.value = ""; }
  }

  // ---- Init ----
  setData(opts.datasets);
  // Default the year filter to the current calendar year if the data has it, else the
  // latest available year — so the app opens on the current year, not an all-years blend.
  // A saved choice (including "All years") always wins and is remembered.
  if (savedYear != null) state.year = savedYear;
  else {
    var m0 = model() || MODELS.defects || MODELS.opstd;
    if (m0 && m0.years.length) { var cy = String(new Date().getFullYear()); state.year = m0.years.indexOf(cy) >= 0 ? cy : m0.years[m0.years.length - 1]; }
  }
  var exportBtn = document.getElementById("export-btn");
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("change", onChange);
  if (exportBtn) exportBtn.addEventListener("click", showDownloadModal);
  render();

  return function teardown() {
    document.body.removeEventListener("click", onClick);
    document.body.removeEventListener("change", onChange);
    if (exportBtn) exportBtn.removeEventListener("click", showDownloadModal);
  };
}
