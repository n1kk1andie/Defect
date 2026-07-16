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
  // Every heat*() returns one of these five hexes; map each to its light band
  // (background + readable text colour) so a cell can carry legible numbers.
  var HEAT_PALETTE = { "#0E8A4D": GREEN, "#E3B341": AMBER, "#E07B00": ORANGE, "#B5142A": RED, "#EFE9E6": GREY };
  function heatBand(hex) { return HEAT_PALETTE[hex] || GREY; }

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
      { key: "defectRate", label: "Defect rate", noun: "defects", num: C.DEFECTS, den: C.INSTANCES, betterHigh: false, heat: heatDefect, band: defectBand, legend: LEG_DEFECT },
      { key: "resolutionRate", label: "Resolution rate", noun: "resolved", num: C.RESOLVED, den: C.RESOLVABLE, betterHigh: true, heat: heatRes, band: null, legend: LEG_RES },
      { key: "recurringRate", label: "Recurring rate", noun: "recurring", num: C.RECURRING, den: C.DEFECTS, betterHigh: false, heat: heatRecurring, band: null, legend: LEG_RECUR },
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
    // Branch × process-area cell: the rate plus the raw counts behind it, honouring
    // the current year/period scope (branch and area are pinned to this cell).
    function areaCell(bi, ai, key, f) {
      var m = metric(key), rows = filterRows(assign(f, { branch: bi, area: ai })), n = 0, d = 0;
      rows.forEach(function (r) { n += r[m.num]; d += r[m.den]; });
      return { rate: d ? n / d : null, count: n, den: d };
    }
    function areaCellDetail(bi, ai, f) {
      var a = record(filterRows(assign(f, { branch: bi, area: ai })));
      return '<span style="font-size:12px;color:#8E0E1F">Defect rate: ' + fmtPct(a.defectRate) + '</span>' +
        '<span style="font-size:12px;color:#0E8A4D">Resolved: ' + fmtPct(a.resolutionRate) + '</span>' +
        '<span style="font-size:12px;color:#C75F00">Recurring: ' + fmtPct(a.recurringRate) + '</span>' +
        '<span style="font-size:12px;font-weight:700">' + fmtNum(a.recurring) + ' recurring · ' + fmtNum(a.defects) + ' defects / ' + fmtNum(a.instances) + ' instances</span>';
    }
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
      headline: METRICS[0], metrics: METRICS, metric: metric, filterRows: filterRows, aggregate: aggregate, record: record, cellValue: cellValue, cellDetail: cellDetail, areaCell: areaCell, areaCellDetail: areaCellDetail,
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

  // ---- Session state + API ----
  // session = { role, username, branch } when signed in, else null. The role decides
  // which screens the account sees (see roleCanSee / TABS); admin sees everything.
  var session = opts.initialSession || null;
  function role() { return session ? session.role : null; }
  function isAdmin() { return role() === "admin"; }
  var ROLE_LABEL = { inspector: "Officer", supervisor: "Supervisor", admin: "Admin" };
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
    async login(username, pw) {
      var res = await apiCall("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username, password: pw }) });
      if (res.ok && res.json.ok) { session = { role: res.json.role, username: res.json.username, branch: res.json.branch }; return { ok: true, role: res.json.role }; }
      if (res.status === 0) return { ok: false, error: NET_ERR };
      return { ok: false, error: res.json.error || (res.status === 401 ? "Incorrect password." : "Sign-in failed (HTTP " + res.status + ").") };
    },
    async roleLogin(roleName, name, branch, pw) {
      var res = await apiCall("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: roleName, name: name, branch: branch, password: pw }) });
      if (res.ok && res.json.ok) { session = { role: res.json.role, username: res.json.username, branch: res.json.branch }; return { ok: true, role: res.json.role }; }
      if (res.status === 0) return { ok: false, error: NET_ERR };
      return { ok: false, error: res.json.error || "Sign-in failed (HTTP " + res.status + ")." };
    },
    async rolePwStatus() {
      var res = await apiCall("/api/role-passwords", { cache: "no-store" });
      if (res.ok && res.json.ok) return { ok: true, status: res.json.status };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Could not load role passwords.") };
    },
    async setRolePw(roleName, pw) {
      var res = await apiCall("/api/role-passwords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: roleName, password: pw }) });
      if (res.ok && res.json.ok) return { ok: true, status: res.json.status };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Could not set password.") };
    },
    async logout() { await apiCall("/api/logout", { method: "POST" }); session = null; },
    async listAccounts() {
      var res = await apiCall("/api/accounts", { cache: "no-store" });
      if (res.ok && res.json.ok) return { ok: true, accounts: res.json.accounts };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Could not load accounts.") };
    },
    async saveAccount(a) {
      var res = await apiCall("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
      if (res.ok && res.json.ok) return { ok: true, accounts: res.json.accounts };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Could not save account.") };
    },
    async removeAccount(username) {
      var res = await apiCall("/api/accounts?username=" + encodeURIComponent(username), { method: "DELETE" });
      if (res.ok && res.json.ok) return { ok: true, accounts: res.json.accounts };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Could not remove account.") };
    },
    async listSubmissions() {
      var res = await apiCall("/api/submissions", { cache: "no-store" });
      if (res.ok && res.json.ok) return { ok: true, submissions: res.json.submissions, me: res.json.me };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Could not load submissions.") };
    },
    async postSubmission(body) {
      var res = await apiCall("/api/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok && res.json.ok) return { ok: true, submission: res.json.submission, submissions: res.json.submissions };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "That didn’t go through.") };
    },
    async parseReview(buf) {
      var res = await apiCall("/api/review-parse", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf });
      if (res.ok && res.json.ok) return { ok: true, items: res.json.items, stats: res.json.stats };
      return { ok: false, error: res.status === 0 ? NET_ERR : (res.json.error || "Could not read that file.") };
    },
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
    heatSel: null, ui: { msg: "", msgKind: "", pwMsg: "", pwOk: false }, pendingTab: null, acct: null,
    entry: null, subs: null, subsErr: "", reviewId: null, reviewFilter: { dataset: "all", branch: "all", sort: "oldest" }, login: null, reportMonth: null,
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
    // In the branch × process-area heat map, process area is the column axis, so the
    // area filter chips are hidden (they would collapse the matrix to one column).
    var areaAsAxis = state.tab === "heatmap" && isHeatAreaView(m);
    var showAreaChips = m.hasArea && !areaAsAxis;
    var html = '<div class="row between mid" style="margin:2px 4px 8px;gap:8px"><div class="period-select-label">Filters</div><select class="sel" id="year-sel">' + yearOpts + '</select></div>' +
      '<div class="chips"' + (showAreaChips ? ' style="margin-bottom:6px"' : "") + '>' + branchChips + '</div>';
    if (showAreaChips) html += '<div class="chips"><button class="chip' + (state.area < 0 ? " on" : "") + '" data-area="-1">All process areas</button>' + m.areas.map(function (a, i) { return '<button class="chip' + (state.area === i ? " on" : "") + '" data-area="' + i + '">' + esc(a) + '</button>'; }).join("") + '</div>';
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
  // The lens is chosen by the metric, not a toggle. Recurring rate reads as root
  // cause — which process area keeps repeating — so it shows a branch × process-area
  // grid where each cell carries the rate and the raw counts. Every other metric
  // shows its branch × month history: where and when it runs hot. isHeatAreaView is
  // the single source of truth for which of the two the History tab is showing.
  function isHeatAreaView(m) { return m.hasArea && state.heatMetric[state.mode] === "recurringRate"; }
  function renderHeatmap() {
    var m = model(), mk = state.heatMetric[state.mode], metric = m.metric(mk), f = filters();
    var areaView = isHeatAreaView(m);
    var metricChips = m.metrics.map(function (mm) { return '<button class="chip' + (mk === mm.key ? " on" : "") + '" data-heat="' + mm.key + '">' + esc(mm.label) + "</button>"; }).join("");
    var desc = areaView
      ? "Each cell is a branch × process area — the top figure is its " + esc(metric.label.toLowerCase()) + ", the small figure the counts behind it (" + esc(metric.noun) + " ÷ base). A ▲/▼ marks the change from the previous year — green improved, red worsened, grey if the rate held but the volume moved, ➜ no material change. Branches run best to worst, top to bottom; tap a cell for the full breakdown."
      : "Each cell is a branch’s " + esc(metric.label.toLowerCase()) + " for that month" + (m.hasArea && state.area >= 0 ? " in " + esc(m.areas[state.area]) : "") + ". Tap a cell for detail.";
    document.getElementById("content").innerHTML =
      filterChips(m) +
      '<div class="h2l">' + esc(metric.label) + (areaView ? " by process area" : " history") + "</div>" +
      '<div class="chips" style="margin-bottom:8px">' + metricChips + "</div>" +
      '<div class="sub13" style="margin:0 4px 10px">' + desc + "</div>" +
      legendRow(metric.legend) +
      '<div id="heat-detail"></div>' +
      (areaView ? heatAreaGrid(m, mk, metric, f) : heatTimeGrid(m, mk, metric, f)) + footer(m);
    renderHeatDetail();
  }
  // Branches ordered best → worst on the current metric (within scope), so a grid
  // reads as a gradient: greens at the top down to reds.
  function orderBranches(m, mk, metric, f) {
    var order = m.branches.map(function (bname, bi) {
      return { bname: bname, bi: bi, v: m.aggregate(m.filterRows(assign(f, { branch: bi, area: -1 })), mk) };
    });
    order.sort(function (x, y) {
      if (x.v == null && y.v == null) return 0;
      if (x.v == null) return 1;
      if (y.v == null) return -1;
      return metric.betterHigh ? y.v - x.v : x.v - y.v;
    });
    return order;
  }
  function heatTimeGrid(m, mk, metric, f) {
    var CELL_W = 22, CELL_H = 16, NAME_W = 130, months = activeMonths(m);
    var yearGroups = [];
    months.forEach(function (x) { var g = yearGroups[yearGroups.length - 1]; if (!g || g.yr !== x.p.year) yearGroups.push({ yr: x.p.year, count: 1 }); else g.count++; });
    var headerYears = '<div style="display:flex;padding-left:' + NAME_W + 'px">' + yearGroups.map(function (g, gi) { return '<div style="width:' + (g.count * (CELL_W + 2)) + "px;flex-shrink:0;border-left:" + (gi > 0 ? "2px solid rgba(228,1,43,.2)" : "none") + ';font-family:Sora;font-size:11px;font-weight:800;color:var(--red);text-align:center">' + g.yr + "</div>"; }).join("") + "</div>";
    var headerMonths = '<div style="display:flex;padding-left:' + NAME_W + 'px;margin-bottom:2px">' + months.map(function (x) { return '<div style="width:' + (CELL_W + 2) + 'px;flex-shrink:0;font-size:8px;color:#A89C97;text-align:center;font-weight:600">' + MON3[x.p.monIdx] + "</div>"; }).join("") + "</div>";
    var rows = orderBranches(m, mk, metric, f).map(function (o) {
      var bi = o.bi;
      if (state.branch >= 0 && bi !== state.branch) return "";
      var cells = months.map(function (x) {
        var v = m.cellValue(bi, x.pi, mk, f);
        var selq = state.heatSel && state.heatSel.b === bi && state.heatSel.p === x.pi;
        return '<div class="hmcell" data-b="' + bi + '" data-p="' + x.pi + '" style="width:' + CELL_W + "px;height:" + CELL_H + "px;background:" + metric.heat(v) + (selq ? ";outline:2px solid var(--ink);outline-offset:-1px;z-index:1" : "") + '"></div>';
      }).join("");
      return '<div style="display:flex;align-items:center;margin-bottom:2px"><div class="hmname" style="width:' + NAME_W + 'px">' + esc(o.bname) + "</div>" + cells + "</div>";
    }).join("");
    return '<div class="card" style="overflow-x:auto;padding:12px"><div style="min-width:' + (NAME_W + months.length * (CELL_W + 2)) + 'px">' + headerYears + headerMonths + rows + "</div></div>";
  }
  // Year-over-year movement for a branch × area cell. Compares the scoped year with
  // the one before it (in All-years view, the latest year vs its prior). If the rate
  // moved, the arrow is coloured (green better / red worse); if the rate held but the
  // volume behind it changed, the arrow is grey — so an identical rate still signals
  // whether the branch is doing more or less. Returns { sym, color } or null.
  var TREND_UP = "#B5142A", TREND_DOWN = "#0E8A4D", TREND_FLAT = "#A89C97";
  function areaTrend(m, bi, ai, mk, metric, f) {
    var years = m.years, curY = f.year === "all" ? years[years.length - 1] : f.year, i = years.indexOf(curY);
    if (i <= 0) return null;
    var cur = m.areaCell(bi, ai, mk, assign(f, { year: curY })), prev = m.areaCell(bi, ai, mk, assign(f, { year: years[i - 1] }));
    if (cur.rate == null || prev.rate == null) return null;
    if (Math.abs(cur.rate - prev.rate) >= 0.005) {
      var rose = cur.rate > prev.rate;
      return { sym: rose ? "▲" : "▼", color: (metric.betterHigh ? rose : !rose) ? TREND_DOWN : TREND_UP };
    }
    if (cur.den !== prev.den) return { sym: cur.den > prev.den ? "▲" : "▼", color: TREND_FLAT };
    return { sym: "➜", color: TREND_FLAT }; // compared, but rate and volume both held — no material change
  }
  function heatAreaGrid(m, mk, metric, f) {
    var NAME_W = 130, AREA_W = 104, AREA_H = 46, areas = m.areas;
    var header = '<div style="display:flex;align-items:flex-end;margin-bottom:3px"><div style="width:' + NAME_W + 'px;flex-shrink:0"></div>' +
      areas.map(function (a) { return '<div class="hmac-h" style="width:' + (AREA_W + 2) + 'px">' + esc(a) + "</div>"; }).join("") + "</div>";
    var rows = orderBranches(m, mk, metric, f).map(function (o) {
      var bi = o.bi;
      if (state.branch >= 0 && bi !== state.branch) return "";
      var cells = areas.map(function (aname, ai) {
        var c = m.areaCell(bi, ai, mk, f), pal = heatBand(metric.heat(c.rate));
        var selq = state.heatSel && state.heatSel.b === bi && state.heatSel.a === ai;
        var sub = c.den ? fmtNum(c.count) + " / " + fmtNum(c.den) : "—";
        var tr = c.rate == null ? null : areaTrend(m, bi, ai, mk, metric, f);
        var trMark = tr ? ' <span class="tr" style="color:' + tr.color + '">' + tr.sym + "</span>" : "";
        return '<div class="hmac" data-ba="' + bi + '" data-aa="' + ai + '" style="width:' + AREA_W + "px;height:" + AREA_H + "px;background:" + pal.bg + ";color:" + pal.c + (selq ? ";outline:2px solid var(--ink);outline-offset:-2px" : "") + '"><span class="r">' + fmtPct(c.rate) + trMark + '</span><span class="c">' + sub + "</span></div>";
      }).join("");
      return '<div style="display:flex;align-items:center;margin-bottom:2px"><div class="hmname" style="width:' + NAME_W + 'px">' + esc(o.bname) + "</div>" + cells + "</div>";
    }).join("");
    return '<div class="card" style="overflow-x:auto;padding:12px"><div style="min-width:' + (NAME_W + areas.length * (AREA_W + 2)) + 'px">' + header + rows + "</div></div>";
  }
  function renderHeatDetail() {
    var el = document.getElementById("heat-detail");
    if (!el) return;
    var sel = state.heatSel;
    if (!sel) { el.innerHTML = ""; return; }
    var m = model(), f = filters();
    if (isHeatAreaView(m) && sel.a != null) {
      el.innerHTML = '<div class="notebox" style="margin-bottom:10px"><div class="b t13">' + esc(m.branches[sel.b]) + " · " + esc(m.areas[sel.a]) + '</div><div class="row gap8 wrap" style="margin-top:6px">' + m.areaCellDetail(sel.b, sel.a, f) + "</div></div>";
      return;
    }
    if (sel.p == null) { el.innerHTML = ""; return; }
    el.innerHTML = '<div class="notebox" style="margin-bottom:10px"><div class="b t13">' + esc(m.branches[sel.b]) + " · " + esc(m.periods[sel.p].full) + '</div><div class="row gap8 wrap" style="margin-top:6px">' + m.cellDetail(sel.b, sel.p, f) + "</div></div>";
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
    var m = model();
    var f = filters();
    // A branch defect report is monthly: default to the latest month in scope, with a
    // "Whole year" option. Op Standard keeps the full-scope aggregate.
    var monthsInScope = activeMonths(m);
    var repMonth = null;
    if (m.kind === "defects") {
      var isoSet = {}; monthsInScope.forEach(function (x) { isoSet[x.p.iso] = 1; });
      if (state.reportMonth == null || (state.reportMonth !== "all" && !isoSet[state.reportMonth])) state.reportMonth = monthsInScope.length ? monthsInScope[monthsInScope.length - 1].p.iso : "all";
      repMonth = state.reportMonth === "all" ? null : state.reportMonth;
    }
    var repPi = repMonth ? periodIndex(m, repMonth) : -1;
    var rows = repPi >= 0 ? m.filterRows(assign(f, { period: repPi })) : m.filterRows(f);
    var rec = m.record(rows);
    var hv = m.aggregate(rows, m.headline.key);
    var band = (m.headline.band || defectBand)(hv);
    var hfmt = m.kind === "opstd" ? fmtScore(hv) : fmtPct(hv);
    var repScope = (state.branch < 0 ? "All branches" : m.branches[state.branch]) + (m.hasArea ? " · " + (state.area < 0 ? "all process areas" : m.areas[state.area]) : "") +
      " · " + (repPi >= 0 ? m.periods[repPi].full : (state.year === "all" ? m.years[0] + "–" + m.years[m.years.length - 1] : state.year));
    var monthPicker = m.kind === "defects" ? '<div class="period-select" style="margin:2px 4px 10px"><span class="period-select-label">Report month</span><select class="period-select-input" id="rep-month">' +
      monthsInScope.slice().reverse().map(function (x) { return '<option value="' + x.p.iso + '"' + (state.reportMonth === x.p.iso ? " selected" : "") + ">" + esc(x.p.full) + "</option>"; }).join("") +
      '<option value="all"' + (state.reportMonth === "all" ? " selected" : "") + ">Whole year</option></select></div>" : "";

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

    // Key figures. For a branch defect report we surface the sample, defect rate,
    // resolution, recurring and an accuracy score; op-standard keeps its status cards.
    var score = m.kind === "defects" && rec.instances ? Math.round((rec.instances - rec.defects) / rec.instances * 100) : null;
    var kpis = m.kind === "defects"
      ? [{ v: fmtNum(rec.instances), l: "Transactions sampled" }, { v: fmtNum(rec.defects), l: "Defects found", c: "#8E0E1F" },
         { v: fmtPct(rec.defectRate), l: "Defect rate", c: band.c }, { v: fmtPct(rec.resolutionRate), l: "Resolved", c: "#0E8A4D" },
         { v: fmtPct(rec.recurringRate), l: "Recurring", c: "#C75F00" }, { v: score == null ? "—" : score, l: "Accuracy score", c: scoreBand(score).c }]
      : m.statusCards(rows).map(function (c) { return { v: c.value, l: c.label, c: c.color }; });
    var kpiGrid = '<div class="rep-kpis">' + kpis.map(function (k) { return '<div class="rep-kpi"><div class="rep-kpi-v" style="color:' + (k.c || "var(--ink)") + '">' + k.v + '</div><div class="rep-kpi-l">' + esc(k.l) + "</div></div>"; }).join("") + "</div>";

    // Monthly trend of the headline metric across the scoped period.
    var trendData = activeMonths(m).map(function (x) { return { label: x.p.label, v: m.aggregate(m.filterRows(assign(f, { period: x.pi })), m.headline.key) }; });
    var trendMax = Math.max.apply(null, trendData.map(function (d) { return d.v || 0; }).concat(m.kind === "opstd" ? 100 : 0.001));
    var trendBars = trendData.map(function (d) { var h = d.v ? Math.max(3, (d.v / trendMax) * 48) : 3; var b = (m.headline.band || defectBand)(d.v); return '<div title="' + esc(d.label) + ": " + (m.kind === "opstd" ? fmtScore(d.v) : fmtPct(d.v)) + '" style="flex:1;min-width:4px;height:' + h + "px;background:" + (d.v == null ? "#E8E1DD" : b.c) + ';border-radius:2px 2px 0 0"></div>'; }).join("");
    var trend = trendData.length > 1 ? '<div class="report-h">' + esc(m.headline.label) + ' trend</div><div style="display:flex;align-items:flex-end;gap:2px;height:52px;margin-bottom:6px">' + trendBars + '</div><div class="row between" style="margin-bottom:20px"><span class="sub">' + esc(trendData[0].label) + '</span><span class="sub">' + esc(trendData[trendData.length - 1].label) + "</span></div>" : "";

    // Nature of defects — aggregated from the published submission rows for this branch
    // (best-effort; only shown when the viewer's submissions are loaded).
    function natureSection() {
      if (m.kind !== "defects" || state.branch < 0) return "";
      if (state.subs === null) { ensureSubs(); return ""; }
      var bn = m.branches[state.branch], nat = {};
      (state.subs || []).forEach(function (s) {
        if (s.dataset === "defects" && s.status === "published" && s.branch === bn && (repMonth ? s.period === repMonth : (state.year === "all" || (s.period || "").slice(0, 4) === state.year))) {
          (s.items || []).forEach(function (it) { if ((it.defects || 0) > 0) { var k = (it.defectArea || "").trim() || "Unspecified"; nat[k] = (nat[k] || 0) + it.defects; } });
        }
      });
      var keys = Object.keys(nat); if (!keys.length) return "";
      keys.sort(function (a, b) { return nat[b] - nat[a]; });
      var mx = nat[keys[0]];
      var rows2 = keys.map(function (k) { var w = Math.max(6, nat[k] / mx * 100); return '<div class="rep-nat-row"><div style="flex:1;min-width:0"><div class="t13" style="font-weight:600">' + esc(k) + '</div><div class="rep-nat-bar" style="width:' + w + '%"></div></div><div class="num16" style="flex-shrink:0">' + nat[k] + "</div></div>"; }).join("");
      return '<div class="report-h">Nature of defects</div><div class="rep-nature">' + rows2 + "</div>";
    }
    var repTitle = m.kind === "defects" ? (state.branch >= 0 ? "Branch Defect Report" : "Branch Defects Report") : "Operational Standard Report";

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
      monthPicker +
      downloadPanel(m) +
      '<div class="report">' +
        '<div class="rep-head">' +
          '<div class="rep-eyebrow">VM Building Society · Operational Risk &amp; Audit</div>' +
          '<div class="report-title">' + esc(repTitle) + "</div>" +
          '<div class="sub13" style="margin-top:6px">' + esc(repScope) + "</div>" +
          '<div class="sub" style="margin-top:3px">Generated ' + esc(genDate) + " · Source: " + esc(m.source) + "</div>" +
        "</div>" +
        '<div class="rep-verdict"><span class="big">' + hfmt + '</span><span class="statpill" style="background:' + band.bg + ";color:" + band.c + '">' + esc(m.headline.label) + " · " + esc(band.label) + "</span></div>" +
        '<hr class="report-rule">' +
        '<div class="report-h">Executive summary</div>' +
        '<div class="sub13" style="margin-bottom:20px">' + narr + "</div>" +
        '<div class="report-h">Key figures</div>' + kpiGrid +
        trend +
        natureSection() +
        '<div class="report-h">' + esc(tableTitle) + " · " + recs.length + " rows</div>" +
        '<div class="tbl-wrap" style="margin-top:0;box-shadow:none;border:1px solid var(--line)"><table class="reg"><thead>' + thead + "</thead><tbody>" +
          recs.map(function (g) { return repRow(g, false); }).join("") + repRow(total, true) + "</tbody></table></div>" +
      "</div>" + footer(m);
  }

  // ===================== SUBMISSIONS: entry / mine / review =====================
  // The six defect counts, in entry order (keys match the server's DEFECT_FIELDS).
  var DEFECT_INPUTS = [["reviewed", "Files reviewed"], ["instances", "Possible instances"], ["defects", "Defects found"], ["recurring", "…of which recurring"], ["resolvable", "Resolvable defects"], ["resolved", "…of which resolved"]];
  var STATUS_META = { draft: { label: "Draft", c: "#6E625E", bg: "#EFEAE7" }, submitted: { label: "In review", c: "#8E0E1F", bg: "#FBE3E7" }, returned: { label: "Returned", c: "#A07208", bg: "#FBF2DC" }, published: { label: "Published", c: "#0E8A4D", bg: "#E5F4EC" } };
  function statusPill(s) { var m = STATUS_META[s] || STATUS_META.draft; return '<span class="statpill" style="background:' + m.bg + ";color:" + m.c + '">' + m.label + "</span>"; }
  function datasetLabel(ds) { return ds === "opstd" ? "Operational Standard" : "Branch Defects"; }
  function periodIndex(m, iso) { for (var i = 0; i < m.periods.length; i++) if (m.periods[i].iso === iso) return i; return -1; }
  function periodFull(ds, iso) { var m = MODELS[ds]; if (!m) return iso; var i = periodIndex(m, iso); return i < 0 ? iso : m.periods[i].full; }
  function subTitle(s) { return esc(s.branch) + (s.area ? " · " + esc(s.area) : (s.dataset === "defects" ? " · Process review" : "")); }
  function defectRatesOf(v) { var n = function (k) { return +v[k] || 0; }; var inst = n("instances"), def = n("defects"), resv = n("resolvable"), res = n("resolved"), rec = n("recurring"); return { defectRate: inst ? def / inst : null, resolutionRate: resv ? res / resv : null, recurringRate: def ? rec / def : null }; }
  function defectRuleMsg(v) { var n = function (k) { return +v[k] || 0; }; if (n("defects") > n("instances")) return "Defects can’t exceed possible instances."; if (n("resolved") > n("resolvable")) return "Resolved can’t exceed resolvable defects."; if (n("recurring") > n("defects")) return "Recurring can’t exceed defects found."; return ""; }
  function timeAgo(iso) {
    var t = Date.parse(iso); if (isNaN(t)) return ""; var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago"; if (s < 86400) return Math.floor(s / 3600) + " hr ago"; return Math.floor(s / 86400) + " d ago";
  }
  function loadingCard(msg) { return '<div class="card"><div class="sub13">' + esc(msg) + "</div></div>"; }
  function ensureSubs() {
    if (state.subs === null && !state.subsLoading) {
      state.subsLoading = true;
      api.listSubmissions().then(function (r) {
        state.subsLoading = false;
        if (r.ok) { state.subs = r.submissions; state.subsErr = ""; } else { state.subs = []; state.subsErr = r.error; }
        if (["entry", "mine", "review", "report"].indexOf(state.tab) >= 0) render();
      });
    }
  }
  function refreshSubs(list) { state.subs = list || null; if (!list) ensureSubs(); }

  // ---- Screen: Entry — Process Critical Review register (officer) ----
  var CHECK_LABELS = [["memberVerified", "Member verified"], ["cardKeyedCMS", "Card keyed to CMS"], ["cmsSigMatch", "CMS & Sig match"], ["idCapture", "ID capture updated"], ["formCompleted", "Form completed"]];
  var TXN_TYPES = ["Application", "Amendment", "Maintenance", "Other"];
  function blankRow() { var c = {}; CHECK_LABELS.forEach(function (x) { c[x[0]] = "yes"; }); return { area: "", txnType: "Application", checks: c, defects: 0, defectArea: "", recurring: false, status: "open" }; }
  // Compute per-area aggregates, totals and a compliance score from register rows
  // (mirrors summariseItems on the server so the preview matches what gets published).
  function summariseItems(items) {
    function blank() { return { reviewed: 0, instances: 0, defects: 0, resolvable: 0, resolved: 0, recurring: 0 }; }
    var byArea = {}, totals = blank(), defectRows = 0, cp = {};
    CHECK_LABELS.forEach(function (c) { cp[c[0]] = { yes: 0, app: 0 }; });
    (items || []).forEach(function (it) {
      var d = Math.max(0, Math.round(+it.defects || 0));
      var a = byArea[it.area] || (byArea[it.area] = blank());
      [a, totals].forEach(function (x) { x.reviewed += 1; x.instances += 1; x.defects += d; x.resolvable += d; if (it.status === "resolved") x.resolved += d; if (it.recurring) x.recurring += d; });
      if (d > 0) defectRows += 1;
      CHECK_LABELS.forEach(function (c) { var v = it.checks && it.checks[c[0]]; if (v === "yes" || v === "no") { cp[c[0]].app += 1; if (v === "yes") cp[c[0]].yes += 1; } });
    });
    var sample = totals.reviewed;
    var accuracy = sample ? (sample - defectRows) / sample : null;
    var rates = CHECK_LABELS.map(function (c) { return cp[c[0]].app ? cp[c[0]].yes / cp[c[0]].app : null; });
    var measured = rates.filter(function (r) { return r != null; });
    var compliance = measured.length ? measured.reduce(function (s, r) { return s + r; }, 0) / measured.length : null;
    var score = (accuracy != null && compliance != null) ? Math.round((accuracy + compliance) / 2 * 100) : (accuracy != null ? Math.round(accuracy * 100) : null);
    return { byArea: byArea, totals: totals, sample: sample, defectRows: defectRows, accuracy: accuracy, compliance: compliance, rates: rates, score: score };
  }
  function ratesOfTotals(t) { return { defectRate: t.instances ? t.defects / t.instances : null, resolutionRate: t.resolvable ? t.resolved / t.resolvable : null, recurringRate: t.defects ? t.recurring / t.defects : null }; }
  function ensureEntry() {
    if (state.entry) return;
    var ds = state.mode === "opstd" ? "opstd" : "defects";
    var m = MODELS[ds] || MODELS.defects;
    state.entry = { id: null, dataset: ds, branch: (session && session.branch) || "", period: m.periods[m.lastActive].iso, items: [], row: blankRow(), values: {}, audit: "", msg: "", msgOk: false };
  }
  function readEntryForm() {
    var e = state.entry; if (!e) return;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    var v;
    if ((v = g("entry-dataset")) != null) e.dataset = v;
    if ((v = g("entry-branch")) != null) e.branch = v;
    if ((v = g("entry-period")) != null) e.period = v;
    if (e.dataset === "opstd") { for (var i = 0; i < 9; i++) { var x = g("entry-m" + i); if (x != null) e.values[i] = x; } var au = g("entry-audit"); if (au != null) e.audit = au; }
  }
  function readEntryRow() {
    var e = state.entry; if (!e || !e.row) return; var r = e.row;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    var v;
    if ((v = g("er-area")) != null) r.area = v;
    if ((v = g("er-txn")) != null) r.txnType = v;
    CHECK_LABELS.forEach(function (c) { var x = g("er-chk-" + c[0]); if (x != null) r.checks[c[0]] = x; });
    if ((v = g("er-defectarea")) != null) r.defectArea = v;
    if ((v = g("er-status")) != null) r.status = v;
    var rec = document.getElementById("er-recurring"); if (rec) r.recurring = rec.checked;
  }
  function numField(id, label, val) {
    return '<div><div class="period-select-label" style="margin-bottom:5px">' + esc(label) + '</div><input id="' + id + '" class="entry-num login-in" style="margin-bottom:0" inputmode="numeric" autocomplete="off" value="' + (val == null || val === "" ? "" : esc(String(val))) + '" placeholder="0"></div>';
  }
  function entryPreviewHtml(e) {
    if (e.dataset === "opstd") {
      var vals = []; for (var i = 1; i < 9; i++) { var x = e.values[i]; if (x !== "" && x != null) vals.push(+x); }
      var avg = vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null;
      return '<div class="notebox">Overall Operational Standard Score is tracked separately; component average is <b>' + (avg == null ? "—" : avg) + '</b>. Leave a score blank if it wasn’t measured this month.</div>';
    }
    var sm = summariseItems(e.items), rt = ratesOfTotals(sm.totals);
    if (!sm.sample) return '<div class="notebox">Add reviewed transactions above — the branch sample, defect rate, resolution, recurring and score compute automatically.</div>';
    var tile = function (val, lbl, color) { return '<div style="flex:1;min-width:70px;text-align:center"><div class="num18"' + (color ? ' style="color:' + color + '"' : "") + ">" + val + '</div><div class="sub" style="margin-top:2px">' + lbl + "</div></div>"; };
    var db = defectBand(rt.defectRate);
    var tiles = '<div class="row wrap gap10" style="justify-content:space-between">' +
      tile(fmtNum(sm.sample), "Sample") + tile(fmtNum(sm.totals.defects), "Defects", "#8E0E1F") +
      tile(fmtPct(rt.defectRate), "Defect rate", db.c) + tile(fmtPct(rt.resolutionRate), "Resolved", "#0E8A4D") +
      tile(fmtPct(rt.recurringRate), "Recurring", "#C75F00") + tile(sm.score == null ? "—" : sm.score, "Score", scoreBand(sm.score).c) + "</div>";
    var areaRows = Object.keys(sm.byArea).sort().map(function (a) { var v = sm.byArea[a], r = ratesOfTotals(v); return '<div class="row between mid" style="padding:6px 0;border-top:1px solid #F4EFED"><span class="t13" style="font-weight:600">' + esc(a) + '</span><span class="sub">' + fmtNum(v.defects) + " / " + fmtNum(v.reviewed) + " · " + fmtPct(r.defectRate) + "</span></div>"; }).join("");
    return tiles + '<div class="notebox" style="margin-top:10px">Publishing writes one dataset row per area — these figures flow straight into Pulse, Heatmap, Register &amp; Report.</div>' + '<div style="margin-top:6px">' + areaRows + "</div>";
  }
  function updateEntryPreview() { var el = document.getElementById("entry-preview"); if (el) el.innerHTML = entryPreviewHtml(state.entry); }
  function rowFormHtml(e) {
    var r = e.row, areas = (MODELS.defects || {}).areas || [];
    var sel = function (id, opts, cur, extra) { return '<select class="sel" id="' + id + '" style="width:100%' + (extra || "") + '">' + opts.map(function (o) { var val = o[0] != null ? o[0] : o, lbl = o[1] != null ? o[1] : o; return '<option value="' + esc(val) + '"' + (cur === val ? " selected" : "") + ">" + esc(lbl) + "</option>"; }).join("") + "</select>"; };
    var lbl = function (t) { return '<div class="period-select-label" style="margin-bottom:4px">' + esc(t) + "</div>"; };
    var checks = '<div class="grid-status" style="grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:0">' + CHECK_LABELS.map(function (c) {
      return "<div>" + '<div class="period-select-label" style="margin-bottom:4px;font-size:9px">' + esc(c[1]) + "</div>" + sel("er-chk-" + c[0], [["yes", "Yes"], ["no", "No"], ["na", "N/A"]], r.checks[c[0]] || "yes", ";padding:7px 8px;font-size:12px") + "</div>";
    }).join("") + "</div>";
    var defectFields = r.defects > 0
      ? '<div style="margin-top:10px"><div>' + lbl("Defect area / nature") + '<input class="login-in" id="er-defectarea" style="margin-bottom:0" placeholder="e.g. ID Cap, CMS, form completion, Status 3" value="' + esc(r.defectArea || "") + '"></div>' +
        '<div class="row gap8 mid" style="margin-top:8px"><div style="flex:1">' + lbl("Status") + sel("er-status", [["open", "Open"], ["resolved", "Resolved"]], r.status) + "</div>" +
        '<label class="row mid gap8" style="flex:1;font-size:12.5px;font-weight:600;padding-top:16px"><input type="checkbox" id="er-recurring"' + (r.recurring ? " checked" : "") + ' style="width:17px;height:17px">Recurring defect</label></div></div>'
      : "";
    return '<div class="card" style="margin-bottom:12px">' +
      '<div class="t14" style="margin-bottom:10px">Add a reviewed transaction</div>' +
      '<div class="row gap8" style="margin-bottom:10px"><div style="flex:1">' + lbl("Process area") + sel("er-area", [["", "Choose area…"]].concat(areas.map(function (a) { return [a, a]; })), r.area) + "</div>" +
        '<div style="flex:1">' + lbl("Transaction") + sel("er-txn", TXN_TYPES, r.txnType) + "</div></div>" +
      lbl("Control checks") + checks +
      '<div class="row between mid" style="margin-top:12px"><div class="period-select-label" style="margin:0">Defects on this transaction</div>' +
        '<div class="stepper" style="width:120px"><div class="mv" data-action="er-def-dec">–</div><div class="val">' + (r.defects || 0) + '</div><div class="mv" data-action="er-def-inc">+</div></div></div>' +
      defectFields +
      '<button class="cta2" data-action="entry-additem" style="margin-top:12px">+ Add to review</button></div>';
  }
  function renderEntry() {
    ensureEntry(); var e = state.entry;
    var dsM = MODELS[e.dataset] || MODELS.defects;
    var branches = dsM.branches;
    var lockedBranch = session && session.branch;
    var dsOpts = [["defects", "Branch Defects"], ["opstd", "Operational Standard"]].map(function (o) { return '<option value="' + o[0] + '"' + (e.dataset === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
    var branchSel = lockedBranch
      ? '<div class="login-in" style="margin-bottom:0;background:#FAF7F5">' + esc(e.branch || lockedBranch) + '</div><input type="hidden" id="entry-branch" value="' + esc(e.branch || lockedBranch) + '">'
      : '<select class="sel" id="entry-branch" style="width:100%">' + '<option value="">Choose branch…</option>' + branches.map(function (b) { return '<option value="' + esc(b) + '"' + (e.branch === b ? " selected" : "") + ">" + esc(b) + "</option>"; }).join("") + "</select>";
    var periodSel = '<select class="sel" id="entry-period" style="width:100%">' + dsM.periods.map(function (p) { return '<option value="' + p.iso + '"' + (e.period === p.iso ? " selected" : "") + ">" + esc(p.full) + "</option>"; }).join("") + "</select>";
    var header = '<div class="card" style="margin-bottom:12px">' +
      '<div style="margin-bottom:12px"><div class="period-select-label" style="margin-bottom:5px">Dataset</div><select class="sel" id="entry-dataset" style="width:100%">' + dsOpts + "</select></div>" +
      '<div class="row gap8"><div style="flex:1;min-width:0"><div class="period-select-label" style="margin-bottom:5px">Branch</div>' + branchSel + "</div>" +
        '<div style="flex:1;min-width:0"><div class="period-select-label" style="margin-bottom:5px">Month</div>' + periodSel + "</div></div></div>";
    var body;
    if (e.dataset === "opstd") {
      var metrics = dsM.metrics || [];
      body = '<div class="h2l">Component scores · 0–100</div><div class="card" style="margin-bottom:12px"><div class="grid-status" style="grid-template-columns:1fr 1fr;margin-top:0">' +
        metrics.map(function (mm, i) { return numField("entry-m" + i, mm.label, e.values[i]); }).join("") + numField("entry-audit", "Audit score (raw)", e.audit) + "</div></div>";
    } else {
      var items = e.items || [];
      var list = items.length ? items.map(function (it, i) {
        var tag = it.defects > 0 ? '<span class="statpill" style="background:#FBE3E7;color:#8E0E1F">' + it.defects + (it.defects > 1 ? " defects" : " defect") + "</span>" : '<span class="statpill" style="background:#E5F4EC;color:#0E8A4D">Clean</span>';
        var det = esc(it.area) + (it.txnType ? " · " + esc(it.txnType) : "") + (it.defects > 0 && it.defectArea ? " · " + esc(it.defectArea) : "") + (it.recurring ? " · recurring" : "");
        return '<div class="row between mid" style="padding:9px 0;border-top:1px solid #F4EFED"><div style="min-width:0;flex:1;padding-right:8px"><div class="t13">' + det + '</div><div class="sub" style="margin-top:2px">' + (it.defects > 0 ? (it.status === "resolved" ? "Resolved" : "Open") : "No anomalies") + '</div></div><div class="row mid gap8">' + tag + '<button class="modalx" data-action="entry-delitem" data-id="' + i + '">✕</button></div></div>';
      }).join("") : '<div class="sub13">No transactions added yet.</div>';
      var ioCard = '<div class="card" style="margin-bottom:12px"><div class="t14" style="margin-bottom:4px">Have it in Excel?</div>' +
        '<div class="sub13" style="margin-bottom:10px">Upload your Process Critical Review and the rows fill in below, or download a blank template. You can also key rows manually.</div>' +
        '<div class="row gap8"><label class="cta2" style="flex:1;margin:0;cursor:pointer;text-align:center">⬆ Upload review<input type="file" accept=".xlsx" id="review-upload" style="display:none"></label>' +
          '<a class="cta2" style="flex:1;margin:0;text-align:center;text-decoration:none;line-height:1.7" href="/api/review-template">⬇ Template</a></div></div>';
      body = ioCard + rowFormHtml(e) +
        '<div class="h2l">Reviewed transactions · ' + items.length + "</div><div class=\"card\" style=\"margin-bottom:12px;padding:4px 14px\">" + list + "</div>" +
        '<div class="h2l">This month computes</div><div class="card" id="entry-preview" style="margin-bottom:12px">' + entryPreviewHtml(e) + "</div>";
    }
    var msgHtml = e.msg ? '<div class="msgbox ' + (e.msgOk ? "ok" : "info") + '" style="margin-top:10px">' + esc(e.msg) + "</div>" : "";
    document.getElementById("content").innerHTML =
      '<div class="h2l">' + (e.dataset === "opstd" ? "Operational standard entry" : "Process critical review") + (e.id ? " · editing" : "") + "</div>" +
      header + body + msgHtml +
      '<button class="cta" data-action="entry-submit">Submit for review</button>' +
      '<button class="cta2" data-action="entry-save">Save draft</button>' +
      (e.id ? '<button class="cta2" data-action="entry-new" style="border-color:#E4DDD9;color:#6E625E">Start a new review instead</button>' : "") +
      '<div class="metabar" style="margin-top:12px;color:#8A7E7A;font-size:11px">Submitted work goes to your branch supervisor for approval before it counts.</div>';
  }

  // ---- Screen: My submissions (inspector) ----
  function subRowHtml(s, kind) {
    var meta = datasetLabel(s.dataset) + " · " + periodFull(s.dataset, s.period);
    var head = '<div class="row between mid"><div style="min-width:0;flex:1;padding-right:8px"><div class="t13">' + subTitle(s) + '</div><div class="sub" style="margin-top:3px">' + esc(meta) + "</div></div>" + statusPill(s.status) + "</div>";
    var histChip = '<button class="chip" data-action="sub-open" data-id="' + s.id + '">History</button>';
    var extra = "";
    if (kind === "returned") extra = '<div class="msgbox info" style="margin-top:10px">' + esc(s.note ? "“" + s.note + "” — " + (s.supervisor || "supervisor") : "Returned for changes.") + "</div>" +
      '<div class="row gap8 mid" style="margin-top:8px"><button class="cta2" data-action="edit-sub" data-id="' + s.id + '" style="flex:1;margin-top:0;color:var(--red);border-color:#F0CDD2">Fix &amp; resubmit</button>' + histChip + "</div>";
    else if (kind === "draft") extra = '<div class="row gap8" style="margin-top:10px"><button class="cta2" data-action="edit-sub" data-id="' + s.id + '" style="flex:1;margin-top:0">Edit</button><button class="cta2" data-action="del-sub" data-id="' + s.id + '" style="flex:1;margin-top:0;color:#8E0E1F;border-color:#F0CDD2">Delete</button></div>';
    else if (kind === "submitted") extra = '<div class="row between mid" style="margin-top:8px"><span class="sub">With ' + esc(s.supervisor || "your supervisor") + " · sent " + esc(timeAgo(subWhen(s))) + "</span>" + histChip + "</div>";
    else if (kind === "published") extra = '<div class="row between mid" style="margin-top:8px"><span class="sub">Approved by ' + esc(s.supervisor || "supervisor") + '</span><span class="row gap8">' + histChip + '<button class="chip" data-action="goto-published" data-id="' + s.id + '">View in Pulse →</button></span></div>';
    return '<div class="card" style="margin-bottom:10px">' + head + extra + "</div>";
  }
  function renderMine() {
    ensureSubs();
    var content = document.getElementById("content");
    if (state.subs === null) { content.innerHTML = loadingCard("Loading your submissions…"); return; }
    if (state.subsErr) { content.innerHTML = '<div class="card"><div class="errmsg" style="margin:0">' + esc(state.subsErr) + "</div></div>"; return; }
    var g = { returned: [], submitted: [], draft: [], published: [] };
    state.subs.forEach(function (s) { (g[s.status] || (g[s.status] = [])).push(s); });
    var section = function (title, arr, kind) { return arr.length ? '<div class="h2l">' + title + "</div>" + arr.map(function (s) { return subRowHtml(s, kind); }).join("") : ""; };
    var body = '<button class="cta" data-action="entry-new" style="margin-bottom:6px">+ New review</button>' +
      section("Needs your attention", g.returned, "returned") +
      section("In review", g.submitted, "submitted") +
      section("Drafts", g.draft, "draft") +
      section("Published", g.published, "published");
    if (!g.returned.length && !g.submitted.length && !g.draft.length && !g.published.length) body += '<div class="card awaiting"><div class="t15" style="margin-bottom:4px">Nothing yet</div><div class="sub13">Tap “New review” to key your first submission.</div></div>';
    content.innerHTML = body;
  }

  // ---- Shared submission detail: values, impact, audit trail ----
  function valuesTableHtml(s) {
    var m = MODELS[s.dataset];
    if (s.dataset === "defects") {
      var sm = summariseItems(s.items || []), rt = ratesOfTotals(sm.totals);
      var line = function (lbl, val) { return '<div class="row between mid" style="padding:9px 0;border-bottom:1px solid #F4EFED"><span class="t13" style="font-weight:600">' + esc(lbl) + '</span><span class="num16">' + val + "</span></div>"; };
      var areaLines = Object.keys(sm.byArea).sort().map(function (a) { var v = sm.byArea[a]; return '<div class="row between mid" style="padding:7px 0;border-bottom:1px solid #F8F4F2"><span class="sub" style="color:#6E625E">' + esc(a) + '</span><span class="sub">' + fmtNum(v.defects) + " / " + fmtNum(v.reviewed) + "</span></div>"; }).join("");
      return line("Transactions sampled", fmtNum(sm.sample)) + line("Defects found", fmtNum(sm.totals.defects)) +
        line("Defect rate", fmtPct(rt.defectRate)) + line("Resolution rate", fmtPct(rt.resolutionRate)) +
        line("Recurring rate", fmtPct(rt.recurringRate)) + line("Compliance score", sm.score == null ? "—" : sm.score) +
        (areaLines ? '<div class="period-select-label" style="margin:10px 0 2px">By process area · defects / sampled</div>' + areaLines : "");
    }
    return (m.metrics || []).map(function (mm, i) { var v = s.values[i]; return '<div class="row between mid" style="padding:9px 0;border-bottom:1px solid #F4EFED"><span class="t13" style="font-weight:600">' + esc(mm.label) + '</span><span class="num16">' + (v == null || v === "" ? "—" : fmtScore(+v)) + "</span></div>"; }).join("") +
      '<div class="row between mid" style="padding:9px 0"><span class="t13" style="font-weight:600">Audit score (raw)</span><span class="num16">' + (s.audit == null || s.audit === "" ? "—" : esc(String(s.audit))) + "</span></div>";
  }
  // Before→after preview of what publishing this submission does to the branch's metrics.
  function impactHtml(s) {
    var m = MODELS[s.dataset], bi = m.branches.indexOf(s.branch), pi = periodIndex(m, s.period);
    if (s.dataset === "defects") {
      var curRows = bi >= 0 && pi >= 0 ? m.filterRows({ year: "all", branch: bi, area: -1, period: pi }) : [];
      var cur = m.record(curRows), nw = ratesOfTotals(summariseItems(s.items || []).totals);
      var line = function (lbl, a, b, band) { var bb = band(b); return '<div class="row between mid" style="padding:7px 0"><span class="sub">' + lbl + '</span><span class="row mid gap8"><span class="sub" style="color:#B9AEA8">' + (a == null ? "—" : fmtPct(a)) + '</span><span style="color:#8A7E7A">→</span><span class="statpill" style="background:' + bb.bg + ";color:" + bb.c + '">' + fmtPct(b) + "</span></span></div>"; };
      return line("Branch defect rate · " + periodFull(s.dataset, s.period), cur.defectRate, nw.defectRate, defectBand) +
        line("Resolution rate", cur.resolutionRate, nw.resolutionRate, function () { return { bg: "#E5F4EC", c: "#0E8A4D" }; }) +
        line("Recurring rate", cur.recurringRate, nw.recurringRate, function () { return { bg: "#FBF2DC", c: "#C75F00" }; });
    }
    var curOv = bi >= 0 && pi >= 0 ? m.cellValue(bi, pi, 0) : null, nwOv = s.values[0];
    var bnd = scoreBand(nwOv == null || nwOv === "" ? null : +nwOv);
    return '<div class="row between mid" style="padding:7px 0"><span class="sub">Op Standard Score · ' + esc(periodFull(s.dataset, s.period)) + '</span><span class="row mid gap8"><span class="sub" style="color:#B9AEA8">' + (curOv == null ? "—" : fmtScore(curOv)) + '</span><span style="color:#8A7E7A">→</span><span class="statpill" style="background:' + bnd.bg + ";color:" + bnd.c + '">' + (nwOv == null || nwOv === "" ? "—" : fmtScore(+nwOv)) + "</span></span></div>" +
      '<div class="sub13" style="margin-top:4px">All nine components update on publish.</div>';
  }
  var TRAIL_META = { draft: { label: "Drafted", c: "#8A7E7A" }, submitted: { label: "Submitted", c: "#A07208" }, returned: { label: "Returned", c: "#C77800" }, published: { label: "Published", c: "#0E8A4D" } };
  // The submission's immutable history — newest first — showing who did what, when.
  function auditTrailHtml(s) {
    var evs = (s.history || []).slice().reverse();
    if (!evs.length) return '<div class="sub13">No history.</div>';
    return evs.map(function (h, i) {
      var mm = TRAIL_META[h.status] || { label: h.status, c: "#8A7E7A" };
      return '<div class="row" style="gap:9px;padding:8px 0;align-items:flex-start' + (i ? ";border-top:1px solid #F4EFED" : "") + '">' +
        '<span style="width:8px;height:8px;border-radius:99px;background:' + mm.c + ';flex-shrink:0;margin-top:5px"></span>' +
        '<div style="flex:1;min-width:0"><div class="t13">' + esc(mm.label) + " · " + esc(h.by || "") + "</div>" + (h.note ? '<div class="sub" style="margin-top:2px">“' + esc(h.note) + "”</div>" : "") + "</div>" +
        '<span class="sub" style="flex-shrink:0">' + esc(timeAgo(h.at)) + "</span></div>";
    }).join("");
  }
  // Read-only submission detail (values + audit trail) — opened from any list.
  function showSubModal(id) {
    var s = null; (state.subs || []).forEach(function (x) { if (x.id === id) s = x; });
    if (!s) return;
    document.getElementById("modal-root").innerHTML =
      '<div class="overlay" data-action="modal-close"><div class="modal" data-stop style="max-width:380px;max-height:86vh;overflow-y:auto">' +
        '<button class="modalx" data-action="modal-close">✕</button>' +
        '<div class="t15" style="padding-right:22px">' + subTitle(s) + "</div>" +
        '<div class="sub13" style="margin:4px 0 14px">' + esc(datasetLabel(s.dataset) + " · " + periodFull(s.dataset, s.period)) + " · from <b>" + esc(s.inspector) + "</b> " + statusPill(s.status) + "</div>" +
        '<div class="h2l" style="margin-top:0">Values submitted</div><div style="padding:0 2px 4px">' + valuesTableHtml(s) + "</div>" +
        '<div class="h2l">Audit trail</div><div style="padding:0 2px">' + auditTrailHtml(s) + "</div></div></div>";
  }

  // ---- Screen: Review queue (supervisor) ----
  function reviewHeadline(s) {
    if (s.dataset === "defects") { var r = ratesOfTotals(summariseItems(s.items || []).totals), b = defectBand(r.defectRate); return { txt: "Defect rate " + fmtPct(r.defectRate), c: b.c, low: r.defectRate != null && b.label === "Unacceptable" }; }
    var ov = s.values[0]; var band = scoreBand(ov); return { txt: "Op score " + fmtScore(ov), c: band.c, low: ov != null && +ov < 60 };
  }
  function subWhen(s) { return s.history && s.history.length ? s.history[s.history.length - 1].at : s.updatedAt; }
  function renderReview() {
    if (state.reviewId) { renderReviewDetail(); return; }
    ensureSubs();
    var content = document.getElementById("content");
    if (state.subs === null) { content.innerHTML = loadingCard("Loading the review queue…"); return; }
    if (state.subsErr) { content.innerHTML = '<div class="card"><div class="errmsg" style="margin:0">' + esc(state.subsErr) + "</div></div>"; return; }
    var f = state.reviewFilter || (state.reviewFilter = { dataset: "all", branch: "all", sort: "oldest" });
    var allQueue = state.subs.filter(function (s) { return s.status === "submitted"; });
    // Branch filter only makes sense when this reviewer covers more than one branch.
    var branchesInQueue = []; allQueue.forEach(function (s) { if (branchesInQueue.indexOf(s.branch) < 0) branchesInQueue.push(s.branch); });
    var multiBranch = branchesInQueue.length > 1;
    if (!multiBranch) f.branch = "all";
    var queue = allQueue.filter(function (s) { return (f.dataset === "all" || s.dataset === f.dataset) && (f.branch === "all" || s.branch === f.branch); });
    queue.sort(function (a, b) { var c = subWhen(a).localeCompare(subWhen(b)); return f.sort === "newest" ? -c : c; });
    var reviewed = state.subs.filter(function (s) { return s.status === "published" || s.status === "returned"; }).slice(0, 8);

    var chip = function (attr, val, cur, label) { return '<button class="chip' + (cur === val ? " on" : "") + '" ' + attr + '="' + val + '">' + label + "</button>"; };
    var dsChips = '<div class="chips" style="margin-bottom:6px">' + chip("data-revds", "all", f.dataset, "All types") + chip("data-revds", "defects", f.dataset, "Branch Defects") + chip("data-revds", "opstd", f.dataset, "Op Standard") + "</div>";
    var brChips = multiBranch ? '<div class="chips" style="margin-bottom:6px">' + chip("data-revbranch", "all", f.branch, "All branches") + branchesInQueue.slice().sort().map(function (b) { return chip("data-revbranch", b, f.branch, esc(b)); }).join("") + "</div>" : "";
    var sortChips = '<div class="chips">' + chip("data-revsort", "oldest", f.sort, "Oldest first") + chip("data-revsort", "newest", f.sort, "Newest first") + "</div>";
    var filtered = f.dataset !== "all" || f.branch !== "all";

    var rows = queue.map(function (s) {
      var h = reviewHeadline(s);
      return '<button class="card btncard" data-action="open-review" data-id="' + s.id + '" style="margin-bottom:10px">' +
        '<div class="row between mid"><span class="sub"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8A7E7A" stroke-width="2" style="vertical-align:-1px;margin-right:3px"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/></svg>From <b style="color:var(--ink)">' + esc(s.inspector) + '</b></span><span class="sub">' + esc(timeAgo(subWhen(s))) + "</span></div>" +
        '<div class="t14" style="margin-top:6px">' + subTitle(s) + '</div>' +
        '<div class="row between mid" style="margin-top:4px"><span class="sub">' + esc(datasetLabel(s.dataset) + " · " + periodFull(s.dataset, s.period)) + '</span><span class="t13" style="color:' + h.c + '">' + (h.low ? "⚠ " : "") + esc(h.txt) + "</span></div>" +
        "</button>";
    }).join("");
    var emptyMsg = filtered ? "No submissions match this filter." : "No submissions waiting. New ones from your officers will appear here.";
    content.innerHTML =
      '<div class="row between mid" style="margin:6px 4px 10px"><div class="h2l" style="margin:0">Awaiting sign-off</div><span class="statpill" style="background:var(--red);color:#fff">' + queue.length + (filtered ? " / " + allQueue.length : "") + "</span></div>" +
      dsChips + brChips + sortChips +
      '<div style="height:10px"></div>' +
      (queue.length ? rows : '<div class="card awaiting"><div class="t15" style="margin-bottom:4px">' + (filtered ? "Nothing here" : "Queue clear") + '</div><div class="sub13">' + emptyMsg + "</div></div>") +
      (reviewed.length ? '<div class="h2l" style="margin-top:20px">Recently reviewed</div>' + reviewed.map(function (s) {
        return '<button class="card btncard" data-action="sub-open" data-id="' + s.id + '" style="margin-bottom:10px"><div class="row between mid"><div style="min-width:0;flex:1;padding-right:8px"><div class="t13">' + subTitle(s) + '</div><div class="sub" style="margin-top:3px">From ' + esc(s.inspector) + " · " + esc(periodFull(s.dataset, s.period)) + " · " + esc(timeAgo(subWhen(s))) + "</div></div>" + statusPill(s.status) + "</div></button>";
      }).join("") : "") +
      '<div class="metabar" style="margin-top:14px;color:#8A7E7A;font-size:11px">Approving publishes into the live dataset — Pulse, Heatmap, Register and Report update at once. Tap a reviewed item for its audit trail.</div>';
  }
  function renderReviewDetail() {
    var s = null; state.subs.forEach(function (x) { if (x.id === state.reviewId) s = x; });
    var content = document.getElementById("content");
    if (!s) { state.reviewId = null; renderReview(); return; }
    content.innerHTML =
      '<button class="chip" data-action="review-back" style="margin:2px 0 12px">← Back to queue</button>' +
      '<div class="card" style="margin-bottom:10px"><div class="row between mid"><div class="t15">' + subTitle(s) + "</div>" + statusPill(s.status) + "</div>" +
        '<div class="sub13" style="margin-top:4px">' + esc(datasetLabel(s.dataset) + " · " + periodFull(s.dataset, s.period)) + ' · from <b>' + esc(s.inspector) + "</b></div></div>" +
      '<div class="h2l">Values submitted</div><div class="card" style="margin-bottom:10px;padding:4px 14px">' + valuesTableHtml(s) + "</div>" +
      '<div class="h2l">If published — impact on ' + esc(s.branch) + "</div><div class=\"card\" style=\"margin-bottom:10px\">" + impactHtml(s) + "</div>" +
      '<div class="h2l">Note to officer</div><div class="card" style="margin-bottom:10px"><textarea id="review-note" class="login-in" style="margin-bottom:0;min-height:64px;resize:vertical" placeholder="Optional — required context if you’re returning it">' + esc(s.note || "") + "</textarea></div>" +
      (state.reviewMsg ? '<div class="msgbox info" style="margin-bottom:10px">' + esc(state.reviewMsg) + "</div>" : "") +
      '<button class="cta" data-action="review-approve" style="background:#0E8A4D">Approve &amp; publish</button>' +
      '<button class="cta2" data-action="review-return" style="border-color:#E4B10A;color:#A07208">Return for changes</button>' +
      '<div class="h2l" style="margin-top:20px">Audit trail</div><div class="card">' + auditTrailHtml(s) + "</div>";
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
      rolePwManagerHtml() +
      '<div class="h2l" style="margin-top:18px">Your session</div><div class="card"><div class="sub13" style="margin-bottom:12px">Signed in as <b>' + esc(ROLE_LABEL[role()] || role()) + '</b>' + (session && session.username ? ' · ' + esc(session.username) : '') + '.</div><button class="cta2" data-action="logout">Sign out</button></div>' + footer(m);
  }

  // Role sign-in passwords — admin-only. Sets the shared password each role uses on the
  // staff login (Inspector / Supervisor). Until set, the admin default password is used.
  function rolePwManagerHtml() {
    var acct = state.acct || (state.acct = { status: null, msg: "", msgOk: false, loadErr: "" });
    if (acct.status === null && !acct.loading) { acct.loading = true; loadRolePw(); }
    var statusRow = function (r, label) {
      var set = acct.status && acct.status[r];
      var pill = '<span class="statpill" style="background:' + (set ? "#E5F4EC;color:#0E8A4D" : "#FBF2DC;color:#A07208") + '">' + (set ? "Set" : "Using default") + "</span>";
      return '<div style="padding:10px 0;border-top:1px solid #F1ECE9">' +
        '<div class="row between mid" style="margin-bottom:8px"><div class="t13">' + label + "</div>" + pill + "</div>" +
        '<div class="row gap8"><input class="login-in" id="rolepw-' + r + '" type="password" autocomplete="new-password" style="margin-bottom:0;flex:1" placeholder="New ' + label.toLowerCase() + ' password" />' +
          '<button class="cta2" data-action="set-rolepw" data-id="' + r + '" style="margin-top:0;width:auto;padding:11px 14px">Set</button></div></div>';
    };
    var loadNote = acct.loadErr ? '<div class="sub13" style="color:#8E0E1F">' + esc(acct.loadErr) + "</div>" : (acct.status === null ? '<div class="sub13">Loading…</div>' : "");
    var msgHtml = acct.msg ? '<div style="font-size:12px;margin-top:8px;font-weight:600;color:' + (acct.msgOk ? "#0E8A4D" : "#8E0E1F") + '">' + esc(acct.msg) + "</div>" : "";
    return '<div class="h2l" style="margin-top:18px">Role sign-in passwords</div>' +
      '<div class="card" style="margin-bottom:10px"><div class="sub13" style="margin-bottom:6px">Staff sign in by role from the gear: they pick Officer or Supervisor, type their name, choose a branch and enter the shared password for that role. Set those shared passwords here — they’re hashed on the server. Until you set one, the admin password works.</div>' +
        (acct.status ? statusRow("inspector", "Officer") + statusRow("supervisor", "Supervisor") : "") + loadNote + msgHtml + "</div>";
  }
  async function loadRolePw() {
    var r = await api.rolePwStatus();
    state.acct = state.acct || {};
    state.acct.loading = false;
    if (r.ok) { state.acct.status = r.status; state.acct.loadErr = ""; }
    else { state.acct.status = {}; state.acct.loadErr = r.error; }
    if (state.tab === "settings" && isAdmin()) renderSettings();
  }

  // ---- Login modal (role picker + name + shared role password) ----
  // Opened only from the gear. Staff pick a role, type their name (recorded as the
  // submission author), choose their branch and enter the shared password for that role.
  // Admin has a separate sign-in. Name/role/branch are remembered on the device.
  var LOGIN_ROLES = [{ id: "inspector", name: "Officer", desc: "Key branch reviews" }, { id: "supervisor", name: "Supervisor", desc: "Review & sign-off" }];
  function loadLoginPrefs() { try { return JSON.parse(localStorage.getItem("vmbs_login") || "{}") || {}; } catch (e) { return {}; } }
  function saveLoginPrefs() { var L = state.login; try { localStorage.setItem("vmbs_login", JSON.stringify({ role: L.role, first: L.first, last: L.last, branch: L.branch })); } catch (e) {} }
  function ensureLogin() {
    if (state.login) return;
    var p = loadLoginPrefs();
    state.login = { mode: "role", role: p.role === "supervisor" ? "supervisor" : "inspector", first: p.first || "", last: p.last || "", branch: p.branch || "", err: "" };
  }
  function openLogin() { state.login = null; ensureLogin(); showLoginModal(); }
  function readLoginForm() {
    var L = state.login; if (!L) return;
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : undefined; };
    var v;
    if ((v = g("login-first")) != null) L.first = v;
    if ((v = g("login-last")) != null) L.last = v;
    if ((v = g("login-branch")) != null) L.branch = v;
  }
  var LOGIN_MARK = '<span class="loginmark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>';
  function showLoginModal() {
    ensureLogin();
    var L = state.login;
    var header = '<div class="row mid gap10">' + LOGIN_MARK + '<div><div class="loginbrand">Branch Tracker</div><div class="sub13">Defects · standards · sign-off</div></div></div>';
    var errHtml = L.err ? '<div class="errmsg" style="margin-top:12px">' + esc(L.err) + "</div>" : "";
    var inner;
    if (L.mode === "admin") {
      inner = header +
        '<div class="h2l" style="margin:18px 4px 8px">Admin sign-in</div>' +
        '<input class="login-in" id="login-pw" type="password" style="margin-bottom:0" autocomplete="current-password" placeholder="Admin password">' +
        errHtml +
        '<button class="cta" style="margin-top:14px" data-action="login-submit">Sign in as admin</button>' +
        '<button class="linkbtn" data-action="role-login-back">← Back to staff sign-in</button>';
    } else {
      var roleObj = LOGIN_ROLES.filter(function (r) { return r.id === L.role; })[0] || LOGIN_ROLES[0];
      var roleList = LOGIN_ROLES.map(function (r) {
        return '<button class="roleopt' + (L.role === r.id ? " on" : "") + '" data-action="pick-role" data-id="' + r.id + '"><span class="roleopt-n">' + esc(r.name) + '</span><span class="roleopt-d">' + esc(r.desc) + "</span></button>";
      }).join("");
      var branches = (MODELS.defects || MODELS.opstd || {}).branches || [];
      var branchOpts = '<option value="">' + (L.role === "supervisor" ? "All branches" : "Choose branch…") + "</option>" + branches.map(function (b) { return '<option value="' + esc(b) + '"' + (L.branch === b ? " selected" : "") + ">" + esc(b) + "</option>"; }).join("");
      inner = header +
        '<div class="h2l" style="margin:18px 4px 8px">I am…</div><div class="col gap8">' + roleList + "</div>" +
        '<div class="h2l" style="margin:16px 4px 8px">Your name</div>' +
        '<div class="row gap8"><input class="login-in" id="login-first" style="margin-bottom:0" autocapitalize="words" placeholder="First name" value="' + esc(L.first) + '"><input class="login-in" id="login-last" style="margin-bottom:0" autocapitalize="words" placeholder="Last name" value="' + esc(L.last) + '"></div>' +
        '<div class="h2l" style="margin:16px 4px 8px">Your branch</div>' +
        '<select class="sel" id="login-branch" style="width:100%">' + branchOpts + "</select>" +
        '<div class="h2l" style="margin:16px 4px 8px">' + esc(roleObj.name) + ' password</div>' +
        '<input class="login-in" id="login-pw" type="password" style="margin-bottom:0" autocomplete="current-password" placeholder="Shared password for your role">' +
        errHtml +
        '<button class="cta" style="margin-top:14px" data-action="login-submit">Enter as ' + esc(roleObj.name) + "</button>" +
        '<button class="linkbtn" data-action="admin-login">Admin sign-in</button>' +
        '<div class="loginfoot">Your name, role and branch are remembered on this device for next time.</div>';
    }
    document.getElementById("modal-root").innerHTML =
      '<div class="overlay" data-action="modal-close"><div class="modal logincard" data-stop><button class="modalx" data-action="modal-close">✕</button>' + inner + "</div></div>";
    var pw = document.getElementById("login-pw"), first = document.getElementById("login-first");
    var focusEl = (L.mode === "role" && !L.first) ? first : pw;
    if (focusEl) focusEl.focus();
    ["login-first", "login-last", "login-pw"].forEach(function (id) { var e = document.getElementById(id); if (e) e.addEventListener("keydown", function (ev) { if (ev.key === "Enter") submitLogin(); }); });
  }
  function hideModal() { document.getElementById("modal-root").innerHTML = ""; }
  async function submitLogin() {
    var L = state.login; ensureLogin();
    var pw = (document.getElementById("login-pw") || {}).value || "";
    var res;
    if (L.mode === "admin") { res = await api.login("", pw); }
    else { readLoginForm(); res = await api.roleLogin(L.role, (L.first + " " + L.last).trim(), L.branch, pw); }
    if (res.ok) {
      if (L.mode === "role") saveLoginPrefs();
      hideModal();
      // Fresh session → drop any cached submissions/entry from a prior one.
      state.subs = null; state.entry = null; state.reviewId = null; state.acct = null;
      if (state.pendingTab && roleCanSee(tabById(state.pendingTab))) state.tab = state.pendingTab;
      else if (!roleCanSee(tabById(state.tab))) state.tab = navFor()[0] || "pulse";
      state.pendingTab = null;
      persist(); render();
    } else { L.err = res.error; showLoginModal(); }
  }

  // ---- Tabs ----
  // A tab with neither `admin` nor `roles` is public — everyone sees it, signed in or
  // not. `admin:true` marks the Settings tab as the universal login door: always shown
  // but locked (and it prompts sign-in) until an admin is signed in. `roles:[...]` marks
  // a role screen that is hidden entirely unless the signed-in role is listed (admins
  // see every role screen). Inspector Entry and Supervisor Review slot in here next.
  var TABS = [
    { id: "pulse", label: "Pulse", icon: "M3 12h4l3-8 4 16 3-8h4" },
    { id: "register", label: "Register", icon: "M4 6h16M4 12h16M4 18h10" },
    { id: "heatmap", label: "History", icon: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2" },
    { id: "report", label: "Report", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" },
    { id: "settings", label: "Settings", admin: true, icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" },
    { id: "entry", label: "Entry", roles: ["inspector"], icon: "M12 5v14M5 12h14" },
    { id: "mine", label: "Mine", roles: ["inspector"], icon: "M9 5h9M9 12h9M9 19h6M4.5 5h.01M4.5 12h.01M4.5 19h.01" },
    { id: "review", label: "Review", roles: ["supervisor"], icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
  ];
  function tabById(id) { for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i]; return null; }
  // The ordered bottom-nav set per role. Visitors get the dashboards plus the Settings
  // login door; each role gets its screens on top of a slimmer dashboard set; admin sees
  // everything. Report stays reachable from the app-bar ⤓ even when not in the bar.
  var NAV = {
    guest: ["pulse", "register", "heatmap", "report", "settings"],
    inspector: ["entry", "mine", "pulse", "heatmap", "report"],
    supervisor: ["review", "pulse", "register", "heatmap", "report"],
    admin: ["pulse", "register", "heatmap", "review", "entry", "settings"],
  };
  function navFor() { return NAV[role() || "guest"] || NAV.guest; }
  // Whether the current session may open a tab. Public tabs are always allowed; the
  // admin login door needs admin; a role tab needs a matching role (admin sees all).
  function roleCanSee(t) {
    if (!t) return false;
    if (t.admin) return isAdmin();
    if (t.roles) return isAdmin() || (role() && t.roles.indexOf(role()) >= 0);
    return true;
  }
  // The tabs shown in the bar, in role order. roleCanSee still guards each click.
  function visibleTabs() { return navFor().map(tabById).filter(Boolean); }
  function renderTabs() {
    document.getElementById("tabbar").innerHTML = visibleTabs().map(function (t) {
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
    document.getElementById("auth-slot").innerHTML = session
      ? '<button class="userchip" data-action="logout" title="Signed in as ' + esc(ROLE_LABEL[role()] || role()) + (session.username ? " · " + esc(session.username) : "") + ' — tap to sign out">' + esc((session.username || role() || "?").charAt(0).toUpperCase()) + '</button>'
      : '<button class="loginpill" data-action="login"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Login</button>';
    Array.prototype.forEach.call(document.querySelectorAll("#mode-toggle button"), function (b) { b.classList.toggle("on", b.getAttribute("data-mode") === state.mode); });
    renderTabs();
    if (state.tab === "settings") renderSettings();
    else if (state.tab === "entry") renderEntry();
    else if (state.tab === "mine") renderMine();
    else if (state.tab === "review") renderReview();
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
    var repRec = m.record(rows);
    var accScore = m.kind === "defects" && repRec.instances ? Math.round((repRec.instances - repRec.defects) / repRec.instances * 100) : null;
    var cards = (m.kind === "defects"
      ? [["Transactions sampled", fmtNum(repRec.instances), "#1C1416"], ["Defects found", fmtNum(repRec.defects), "#8E0E1F"], ["Defect rate", fmtPct(repRec.defectRate), band.c],
         ["Resolved", fmtPct(repRec.resolutionRate), "#0E8A4D"], ["Recurring", fmtPct(repRec.recurringRate), "#C75F00"], ["Accuracy score", accScore == null ? "—" : String(accScore), scoreBand(accScore).c]]
      : m.statusCards(rows).map(function (c) { return [c.label, c.value, c.color || "#1C1416"]; })
    ).map(function (c) { return '<div class="kf"><div class="kfv" style="color:' + c[2] + '">' + c[1] + '</div><div class="kfl">' + esc(c[0]) + "</div></div>"; }).join("");
    var repTitle = m.kind === "defects" ? (state.branch >= 0 ? "Branch Defect Report" : "Branch Defects Report") : "Operational Standard Report";
    var thead = m.regCols.map(function (c) { return '<th class="' + (c.type === "text" ? "l" : "r") + '">' + esc(c.t) + '</th>'; }).join("");
    var body = recs.map(function (rec) {
      return '<tr>' + m.regCols.map(function (c) { return '<td class="' + (c.type === "text" ? "l" : "r") + '">' + pdfCell(m, rec, c) + '</td>'; }).join("") + '</tr>';
    }).join("");
    var totalRow = '<tr class="total">' + m.regCols.map(function (c) { return '<td class="' + (c.type === "text" ? "l" : "r") + '">' + pdfCell(m, total, c) + '</td>'; }).join("") + '</tr>';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(repTitle) + '</title><style>' +
      '*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1C1416;margin:26px;font-size:13px}' +
      '.top{border-top:4px solid #E4012B;padding-top:14px}.eye{color:#E4012B;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px}' +
      'h1{font-size:24px;margin:0 0 2px;letter-spacing:-.02em}.meta{color:#6E625E;font-size:12px;line-height:1.6;margin-bottom:14px}' +
      '.hl{display:flex;align-items:baseline;gap:10px;margin:12px 0 16px}.hl .v{font-size:38px;font-weight:800;letter-spacing:-.02em}.hl .b{font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;background:' + band.bg + ';color:' + band.c + '}' +
      '.rule{border:none;border-top:1px solid #EEE7E3;margin:16px 0}.h2{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8A7E7A;margin:0 0 10px}' +
      '.kfs{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 18px;margin-bottom:20px}.kf{border-left:3px solid #EEE7E3;padding-left:11px}.kfv{font-size:22px;font-weight:800;letter-spacing:-.01em}.kfl{font-size:11px;color:#6E625E;margin-top:2px}' +
      'table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:7px 9px;border-bottom:1px solid #EEE7E3}th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6E625E;text-align:right}th.l,td.l{text-align:left}th.r,td.r{text-align:right}' +
      'tr.total td{font-weight:800;background:#FAF7F5;border-top:2px solid #EEE7E3}.pill,.statpill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}' +
      '@page{margin:14mm}</style></head><body>' +
      '<div class="top"><div class="eye">VM Building Society · Operational Risk &amp; Audit</div><h1>' + esc(repTitle) + "</h1>" +
      '<div class="meta">' + esc(scope) + " · " + esc(rangeLabel) + "<br>Generated " + esc(genDate) + " · Source: " + esc(m.source) + "</div></div>" +
      '<div class="hl"><span class="v">' + hfmt + '</span><span class="b">' + esc(m.headline.label) + " · " + esc(band.label) + "</span></div>" +
      '<hr class="rule"><div class="h2">Key figures</div><div class="kfs">' + cards + "</div>" +
      '<div class="h2">' + (groupBy === "area" ? "Detail by process area" : "Performance by branch") + "</div>" +
      '<table><thead><tr>' + thead + "</tr></thead><tbody>" + body + totalRow + "</tbody></table>" +
      "</body></html>";
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
  // The appbar download button routes to the Report tab's inline download panel
  // (no popup).
  function openDownloads() {
    state.tab = "report"; state.heatSel = null; state.ui.msg = ""; persist(); render(); window.scrollTo(0, 0);
  }

  // ---- Actions ----
  function val(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  async function handleAction(a, el) {
    var arg = el ? (el.getAttribute("data-id") || el.getAttribute("data-user")) : null;
    if (a === "print") { window.print(); return; }
    if (a === "download-run") { runDownload(); return; }
    if (a === "login") { openLogin(); return; }
    if (a === "pick-role") { ensureLogin(); readLoginForm(); state.login.role = arg; state.login.err = ""; showLoginModal(); return; }
    if (a === "admin-login") { ensureLogin(); readLoginForm(); state.login.mode = "admin"; state.login.err = ""; showLoginModal(); return; }
    if (a === "role-login-back") { ensureLogin(); state.login.mode = "role"; state.login.err = ""; showLoginModal(); return; }
    if (a === "login-submit") { submitLogin(); return; }
    if (a === "modal-close") { hideModal(); state.pendingTab = null; return; }
    if (a === "logout") { await api.logout(); if (!roleCanSee(tabById(state.tab))) state.tab = "pulse"; state.acct = null; state.subs = null; state.entry = null; state.reviewId = null; render(); return; }
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
    if (a === "set-rolepw") {
      var rr2 = arg; if (!rr2) return;
      state.acct = state.acct || {};
      var newpw = val("rolepw-" + rr2);
      var sr = await api.setRolePw(rr2, newpw);
      if (sr.ok) { state.acct.status = sr.status; state.acct.msg = "✓ " + (ROLE_LABEL[rr2] || rr2) + " password set."; state.acct.msgOk = true; }
      else { state.acct.msg = sr.error; state.acct.msgOk = false; }
      renderSettings(); return;
    }
    // ---- Entry (inspector) ----
    if (a === "entry-new") { state.entry = null; state.tab = "entry"; persist(); render(); window.scrollTo(0, 0); return; }
    if (a === "er-def-inc" || a === "er-def-dec") {
      readEntryRow(); var er = state.entry.row; er.defects = Math.max(0, (+er.defects || 0) + (a === "er-def-inc" ? 1 : -1)); renderEntry(); return;
    }
    if (a === "entry-additem") {
      readEntryRow(); var e0 = state.entry, r0 = e0.row;
      if (!r0.area) { e0.msg = "Choose a process area for the transaction."; e0.msgOk = false; renderEntry(); return; }
      if (r0.defects > 0 && !(r0.defectArea || "").trim()) { e0.msg = "Name the defect area for a transaction with a defect."; e0.msgOk = false; renderEntry(); return; }
      e0.items.push({ area: r0.area, txnType: r0.txnType, checks: assign({}, r0.checks), defects: +r0.defects || 0, defectArea: (r0.defectArea || "").trim(), recurring: !!r0.recurring, status: r0.status });
      e0.row = blankRow(); e0.msg = ""; renderEntry(); return;
    }
    if (a === "entry-delitem") { state.entry.items.splice(+arg, 1); renderEntry(); return; }
    if (a === "entry-save" || a === "entry-submit") {
      readEntryForm(); var e = state.entry;
      var body = { action: a === "entry-submit" ? "submit" : "save", id: e.id || undefined, dataset: e.dataset, branch: e.branch, period: e.period };
      if (e.dataset === "defects") body.items = e.items; else { body.values = e.values; body.audit = e.audit; }
      var pr = await api.postSubmission(body);
      if (!pr.ok) { e.msg = pr.error; e.msgOk = false; renderEntry(); return; }
      refreshSubs(pr.submissions);
      if (a === "entry-submit") { state.entry = null; state.tab = "mine"; persist(); render(); window.scrollTo(0, 0); }
      else { e.id = pr.submission.id; e.msg = "✓ Draft saved."; e.msgOk = true; renderEntry(); }
      return;
    }
    // ---- My submissions (inspector) ----
    if (a === "edit-sub") {
      var sub = null; (state.subs || []).forEach(function (x) { if (x.id === arg) sub = x; });
      if (!sub) return;
      state.entry = { id: sub.id, dataset: sub.dataset, branch: sub.branch, period: sub.period, area: sub.area || "", items: (sub.items || []).map(function (it) { return assign({}, it); }), row: blankRow(), values: assign({}, sub.values), audit: sub.audit == null ? "" : sub.audit, msg: sub.status === "returned" && sub.note ? "Returned: " + sub.note : "", msgOk: false };
      state.tab = "entry"; persist(); render(); window.scrollTo(0, 0); return;
    }
    if (a === "del-sub") {
      var dr = await api.postSubmission({ action: "delete", id: arg });
      if (dr.ok) refreshSubs(dr.submissions); render(); return;
    }
    if (a === "goto-published") {
      var ps = null; (state.subs || []).forEach(function (x) { if (x.id === arg) ps = x; });
      if (ps) { state.mode = ps.dataset; state.branch = MODELS[ps.dataset].branches.indexOf(ps.branch); state.area = -1; state.tab = "pulse"; state.heatSel = null; persist(); render(); window.scrollTo(0, 0); }
      return;
    }
    if (a === "sub-open") { showSubModal(arg); return; }
    // ---- Review (supervisor) ----
    if (a === "open-review") { state.reviewId = arg; state.reviewMsg = ""; render(); window.scrollTo(0, 0); return; }
    if (a === "review-back") { state.reviewId = null; state.reviewMsg = ""; render(); window.scrollTo(0, 0); return; }
    if (a === "review-approve" || a === "review-return") {
      var decision = a === "review-return" ? "return" : "approve";
      var note = val("review-note");
      if (decision === "return" && !note.trim()) { state.reviewMsg = "Add a note so the officer knows what to change."; renderReviewDetail(); return; }
      var rv = await api.postSubmission({ action: "review", id: state.reviewId, decision: decision, note: note });
      if (!rv.ok) { state.reviewMsg = rv.error; renderReviewDetail(); return; }
      refreshSubs(rv.submissions);
      if (decision === "approve") await api.refreshData(); // published data now flows into the metrics
      state.reviewId = null; state.reviewMsg = ""; render(); window.scrollTo(0, 0);
      return;
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
  // Officer uploads a Process Critical Review workbook — parsed rows fill the register.
  async function handleReviewUpload(file) {
    ensureEntry(); var e = state.entry;
    e.msg = "Reading " + file.name + "…"; e.msgOk = true; renderEntry();
    var buf;
    try { buf = await file.arrayBuffer(); } catch (x) { e.msg = "Could not read the file."; e.msgOk = false; renderEntry(); return; }
    var res = await api.parseReview(buf);
    if (!res.ok) { e.msg = res.error; e.msgOk = false; renderEntry(); return; }
    res.items.forEach(function (it) { e.items.push(it); });
    e.msg = "✓ Added " + res.stats.rows + " transaction" + (res.stats.rows === 1 ? "" : "s") + " from " + file.name + (res.stats.skipped ? " · " + res.stats.skipped + " row" + (res.stats.skipped === 1 ? "" : "s") + " skipped" : "") + ". Review below, then submit.";
    e.msgOk = true; renderEntry(); window.scrollTo(0, 0);
  }

  // ---- Events ----
  function onClick(e) {
    var t = e.target.closest("[data-mode],[data-tab],[data-branch],[data-area],[data-heat],[data-b][data-p],[data-ba][data-aa],[data-sort],[data-action],[data-dlfmt],[data-revds],[data-revbranch],[data-revsort],[data-stop]");
    if (!t) return;
    if (t.hasAttribute("data-action")) { handleAction(t.getAttribute("data-action"), t); return; }
    if (t.hasAttribute("data-revds")) { state.reviewFilter = state.reviewFilter || { dataset: "all", branch: "all", sort: "oldest" }; state.reviewFilter.dataset = t.getAttribute("data-revds"); renderReview(); return; }
    if (t.hasAttribute("data-revbranch")) { state.reviewFilter = state.reviewFilter || { dataset: "all", branch: "all", sort: "oldest" }; state.reviewFilter.branch = t.getAttribute("data-revbranch"); renderReview(); return; }
    if (t.hasAttribute("data-revsort")) { state.reviewFilter = state.reviewFilter || { dataset: "all", branch: "all", sort: "oldest" }; state.reviewFilter.sort = t.getAttribute("data-revsort"); renderReview(); return; }
    if (t.hasAttribute("data-dlfmt")) {
      if (state.dl) state.dl.format = t.getAttribute("data-dlfmt");
      if (state.tab === "report") renderReport();
      return;
    }
    if (t.hasAttribute("data-stop")) return;
    if (t.hasAttribute("data-mode")) { if (state.mode !== t.getAttribute("data-mode")) { state.mode = t.getAttribute("data-mode"); state.branch = -1; state.area = -1; state.heatSel = null; state.ui.msg = ""; } persist(); render(); return; }
    if (t.hasAttribute("data-tab")) {
      var tab = t.getAttribute("data-tab");
      var tdef = tabById(tab);
      if (tdef && !roleCanSee(tdef)) { state.pendingTab = tab; openLogin(); return; }
      state.tab = tab; state.heatSel = null; state.ui.msg = ""; state.reviewId = null; persist(); render(); window.scrollTo(0, 0); return;
    }
    if (t.hasAttribute("data-heat")) { var k = t.getAttribute("data-heat"); state.heatMetric[state.mode] = isNaN(+k) ? k : +k; state.heatSel = null; persist(); render(); return; }
    if (t.hasAttribute("data-sort")) { var sk = t.getAttribute("data-sort"), key = isNaN(+sk) ? sk : +sk, s = state.sort[state.mode]; if (s.key == key) s.dir *= -1; else state.sort[state.mode] = { key: key, dir: key === "name" ? 1 : -1 }; renderRegister(); return; }
    if (t.hasAttribute("data-b") && t.hasAttribute("data-p")) { var b = +t.getAttribute("data-b"), p = +t.getAttribute("data-p"); state.heatSel = (state.heatSel && state.heatSel.b === b && state.heatSel.p === p) ? null : { b: b, p: p }; renderHeatmap(); return; }
    if (t.hasAttribute("data-ba") && t.hasAttribute("data-aa")) { var ba = +t.getAttribute("data-ba"), aa = +t.getAttribute("data-aa"); state.heatSel = (state.heatSel && state.heatSel.b === ba && state.heatSel.a === aa) ? null : { b: ba, a: aa }; renderHeatmap(); return; }
    if (t.hasAttribute("data-branch")) { state.branch = +t.getAttribute("data-branch"); state.heatSel = null; render(); return; }
    if (t.hasAttribute("data-area")) { state.area = +t.getAttribute("data-area"); state.heatSel = null; render(); return; }
  }
  function onChange(e) {
    if (e.target.id === "year-sel") { state.year = e.target.value; state.heatSel = null; persist(); render(); }
    else if (e.target.id === "rep-month") { state.reportMonth = e.target.value; renderReport(); }
    else if (e.target.id === "dl-from") { if (state.dl) state.dl.from = e.target.value; }
    else if (e.target.id === "dl-to") { if (state.dl) state.dl.to = e.target.value; }
    else if (e.target.id === "upload-input") { var f = e.target.files && e.target.files[0]; if (f) handleUpload(f); e.target.value = ""; }
    else if (e.target.id === "review-upload") { var rf = e.target.files && e.target.files[0]; if (rf) handleReviewUpload(rf); e.target.value = ""; }
    else if (["entry-dataset", "entry-branch", "entry-period"].indexOf(e.target.id) >= 0) { readEntryForm(); readEntryRow(); if (state.entry) state.entry.msg = ""; renderEntry(); }
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
  function onInput(e) { var el = e.target; if (el && el.classList && el.classList.contains("entry-num")) { readEntryForm(); updateEntryPreview(); } }
  var exportBtn = document.getElementById("export-btn");
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("change", onChange);
  document.body.addEventListener("input", onInput);
  if (exportBtn) exportBtn.addEventListener("click", openDownloads);
  render();

  return function teardown() {
    document.body.removeEventListener("click", onClick);
    document.body.removeEventListener("change", onChange);
    document.body.removeEventListener("input", onInput);
    if (exportBtn) exportBtn.removeEventListener("click", openDownloads);
  };
}
