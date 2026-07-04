/* VM Building Society — Branch Defects & Operational Standard Tracker.
   Vanilla JS, no build step. Design-consistent with the VMBS Risk & Audit app.

   Two datasets flow through one set of screens (Pulse / Heatmap / Register) via a
   small "model" abstraction so the UI code stays shared. */
(function () {
  "use strict";

  var STORAGE = "vmbs-tracker:v2";
  var MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---- Formatters ----
  function fmtPct(v) { return v == null || isNaN(v) ? "—" : (v * 100).toFixed(1) + "%"; }
  function fmtScore(v) { return v == null || isNaN(v) ? "—" : Number(v).toFixed(1); }
  function fmtNum(v) { return v == null || isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ---- Shared RAG palettes (reuse the Risk app band colours) ----
  var GREEN = { c: "#0E8A4D", bg: "#E5F4EC" }, AMBER = { c: "#A07208", bg: "#FBF2DC" },
      ORANGE = { c: "#C75F00", bg: "#FCEBD9" }, RED = { c: "#8E0E1F", bg: "#F9E2E5" },
      GREY = { c: "#8A7E7A", bg: "#F1ECE9" };

  // Defect rate: LOWER is better.
  function defectBand(v) {
    if (v == null) return withLabel(GREY, "Not tracked");
    if (v < 0.02) return withLabel(GREEN, "On Target");
    if (v < 0.05) return withLabel(AMBER, "Within Limit");
    if (v < 0.10) return withLabel(ORANGE, "Elevated");
    return withLabel(RED, "Breach");
  }
  // Operational standard score (0–100): HIGHER is better. Mirrors the Risk app's world-class scale.
  function scoreBand(v) {
    if (v == null) return withLabel(GREY, "Not tracked");
    if (v >= 95) return withLabel(GREEN, "World Class");
    if (v >= 90) return withLabel(AMBER, "Industry Average");
    if (v >= 80) return withLabel(ORANGE, "Non-Competitive");
    return withLabel(RED, "Unacceptable");
  }
  function withLabel(base, label) { return { c: base.c, bg: base.bg, label: label }; }

  function heatDefect(v) { return v == null ? "#EFE9E6" : v < 0.02 ? "#0E8A4D" : v < 0.05 ? "#E3B341" : v < 0.10 ? "#E07B00" : "#B5142A"; }
  function heatRes(v) { return v == null ? "#EFE9E6" : v >= 0.95 ? "#0E8A4D" : v >= 0.80 ? "#E3B341" : v >= 0.60 ? "#E07B00" : "#B5142A"; }
  function heatRecurring(v) { return v == null ? "#EFE9E6" : v < 0.10 ? "#0E8A4D" : v < 0.25 ? "#E3B341" : v < 0.50 ? "#E07B00" : "#B5142A"; }
  function heatScore(v) { return v == null ? "#EFE9E6" : v >= 95 ? "#0E8A4D" : v >= 90 ? "#E3B341" : v >= 80 ? "#E07B00" : "#B5142A"; }

  var LEG_DEFECT = [["#0E8A4D", "<2%"], ["#E3B341", "2–5%"], ["#E07B00", "5–10%"], ["#B5142A", "≥10%"], ["#EFE9E6", "n/a"]];
  var LEG_RES = [["#0E8A4D", "≥95%"], ["#E3B341", "80–95%"], ["#E07B00", "60–80%"], ["#B5142A", "<60%"], ["#EFE9E6", "n/a"]];
  var LEG_RECUR = [["#0E8A4D", "<10%"], ["#E3B341", "10–25%"], ["#E07B00", "25–50%"], ["#B5142A", "≥50%"], ["#EFE9E6", "n/a"]];
  var LEG_SCORE = [["#0E8A4D", "≥95 World Class"], ["#E3B341", "90–95 Industry"], ["#E07B00", "80–90 Non-Comp."], ["#B5142A", "<80 Unaccept."], ["#EFE9E6", "n/a"]];

  // Audit letter grades (best → worst) with colours. Derived from the raw Audit Score,
  // which mixes a 2024 1–5 scale with a 2025+ 20–100 (D..A) scale.
  var GRADES = [
    { g: "A", c: "#0E8A4D" }, { g: "B+", c: "#6BA644" }, { g: "B", c: "#E3B341" },
    { g: "C", c: "#E07B00" }, { g: "D", c: "#B5142A" }, { g: "F", c: "#6E0715" },
  ];
  var GRADE_C = {}; GRADES.forEach(function (x) { GRADE_C[x.g] = x.c; });
  function auditGrade(s) {
    if (s == null) return null;
    if (s <= 5) return ({ 5: "A", 4: "B", 3: "C", 2: "D", 1: "F" })[Math.round(s)] || null;
    if (s >= 100) return "A"; if (s >= 80) return "B+"; if (s >= 60) return "B";
    if (s >= 40) return "C"; if (s >= 20) return "D"; return "F";
  }

  function periodObjs(isoList) {
    return isoList.map(function (iso) {
      var y = iso.slice(0, 4), m = parseInt(iso.slice(5, 7), 10) - 1;
      return { iso: iso, year: y, monIdx: m, label: MON3[m] + " '" + y.slice(2), full: MON3[m] + " " + y };
    });
  }
  function yearsOf(periods) { return periods.reduce(function (a, p) { if (a.indexOf(p.year) < 0) a.push(p.year); return a; }, []); }

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
    function aggregate(rows, key) {
      var m = metric(key), n = 0, d = 0;
      rows.forEach(function (r) { n += r[m.num]; d += r[m.den]; });
      return d ? n / d : null;
    }
    function record(rows) {
      var a = { reviewed: 0, instances: 0, defects: 0, resolvable: 0, resolved: 0, recurring: 0 };
      rows.forEach(function (r) {
        a.reviewed += r[C.REVIEWED]; a.instances += r[C.INSTANCES]; a.defects += r[C.DEFECTS];
        a.resolvable += r[C.RESOLVABLE]; a.resolved += r[C.RESOLVED]; a.recurring += r[C.RECURRING];
      });
      a.defectRate = a.instances ? a.defects / a.instances : null;
      a.resolutionRate = a.resolvable ? a.resolved / a.resolvable : null;
      a.recurringRate = a.defects ? a.recurring / a.defects : null;
      return a;
    }
    function cellValue(bi, pi, key, f) {
      return aggregate(D.rows.filter(function (r) {
        return r[C.P] === pi && r[C.B] === bi && (f.area < 0 || r[C.A] === f.area);
      }), key);
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
      return [
        { value: fmtNum(a.reviewed), label: "Files reviewed" },
        { value: fmtNum(a.defects), label: "Defects found", color: "#8E0E1F" },
        { value: fmtPct(a.resolutionRate), label: "Defects resolved", color: "#0E8A4D" },
        { value: fmtPct(a.recurringRate), label: "Recurring", color: "#C75F00" },
      ];
    }
    function heroSub(rows) {
      var a = record(rows), b = defectBand(a.defectRate);
      return fmtNum(a.defects) + " defects across " + fmtNum(a.instances) + " possible instances · " + b.label;
    }
    function secondaryBreakdown(f) {
      return {
        title: "By process area",
        cards: D.areas.map(function (name, i) {
          var a = record(filterRows(assign(f, { area: i })));
          return { name: name, value: fmtPct(a.defectRate), band: defectBand(a.defectRate), sub: fmtNum(a.defects) + " / " + fmtNum(a.instances) };
        }).sort(function (x, y) { return parseFloat(y.value) - parseFloat(x.value); }),
      };
    }
    var REG_COLS = [
      { k: "name", t: "Branch", type: "text" },
      { k: "reviewed", t: "Reviewed", type: "num" },
      { k: "instances", t: "Instances", type: "num" },
      { k: "defects", t: "Defects", type: "num" },
      { k: "defectRate", t: "Rate", type: "bandpct", band: defectBand },
      { k: "resolved", t: "Resolved", type: "num" },
      { k: "resolutionRate", t: "Res %", type: "pct" },
      { k: "recurring", t: "Recurring", type: "num" },
    ];

    return {
      kind: "defects", label: "Branch Defects", branches: D.branches, periods: periods, years: yearsOf(periods),
      lastActive: lastActive, hasArea: true, areas: D.areas,
      headline: METRICS[0], metrics: METRICS, metric: metric,
      filterRows: filterRows, aggregate: aggregate, record: record, cellValue: cellValue, cellDetail: cellDetail,
      statusCards: statusCards, heroSub: heroSub, secondaryBreakdown: secondaryBreakdown,
      regCols: REG_COLS, regField: function (rec, k) { return rec[k]; },
      source: "Branch_Defects_Consolidated_2024–2026",
    };
  }

  // ===================== OPERATIONAL STANDARD MODEL =====================
  function buildOpStd() {
    var O = window.OPSTD_DATA;
    var periods = periodObjs(O.periods);
    var nMetric = O.metrics.length;
    // Fast lookup: period*100 + branch -> row
    var lut = {};
    O.rows.forEach(function (r) { lut[r[0] * 100 + r[1]] = r; });
    var auditByKey = {};
    O.rows.forEach(function (r, i) { auditByKey[r[0] * 100 + r[1]] = O.auditRaw[i]; });
    var lastActive = periods.length - 1;

    function matches(r, f) {
      if (f.year !== "all" && periods[r[0]].year !== f.year) return false;
      if (f.branch >= 0 && r[1] !== f.branch) return false;
      if (f.period != null && r[0] !== f.period) return false;
      return true;
    }
    function filterRows(f) { return O.rows.filter(function (r) { return matches(r, f); }); }

    // metric key = numeric index into O.metrics
    var METRICS = O.metrics.map(function (m, i) {
      return { key: i, label: m.label, full: m.key, betterHigh: true, heat: heatScore, band: scoreBand, legend: LEG_SCORE };
    });
    function metric(k) { return METRICS[k] || METRICS[0]; }
    function mean(vals) { var s = 0, n = 0; vals.forEach(function (v) { if (v != null) { s += v; n++; } }); return n ? s / n : null; }
    function aggregate(rows, key) { return mean(rows.map(function (r) { return r[2 + key]; })); }
    function record(rows) {
      var rec = {};
      for (var i = 0; i < nMetric; i++) rec[i] = mean(rows.map(function (r) { return r[2 + i]; }));
      return rec;
    }
    function cellValue(bi, pi, key) { var r = lut[pi * 100 + bi]; return r ? r[2 + key] : null; }
    function cellDetail(bi, pi) {
      var r = lut[pi * 100 + bi];
      if (!r) return '<span class="sub13">No data.</span>';
      return METRICS.map(function (m) {
        var v = r[2 + m.key], b = scoreBand(v);
        return '<span style="font-size:12px;color:' + b.c + '">' + esc(m.label) + ": " + fmtScore(v) + "</span>";
      }).join("");
    }
    function statusCards(rows) {
      // Average SLA (1), Procurement (4), Avg Procedure Compliance (6), Complaints Resolved (7)
      return [1, 4, 6, 7].map(function (i) {
        var v = aggregate(rows, i);
        return { value: fmtScore(v), label: METRICS[i].label, color: scoreBand(v).c };
      });
    }
    function heroSub(rows) {
      var v = aggregate(rows, 0), b = scoreBand(v);
      var filled = 0, total = rows.length;
      rows.forEach(function (r) { if (r[2] != null) filled++; });
      return filled + " of " + total + " branch-months scored · overall standard tracked from May 2025 · " + b.label;
    }
    function secondaryBreakdown(f) {
      var rows = filterRows(f);
      return {
        title: "By standard",
        cards: METRICS.slice(1).map(function (m) {
          var v = aggregate(rows, m.key);
          return { name: m.label, value: fmtScore(v), band: scoreBand(v), sub: "avg score" };
        }).sort(function (x, y) { return parseFloat(x.value) - parseFloat(y.value); }),
      };
    }
    var REG_COLS = [{ k: "name", t: "Branch", type: "text" }].concat(METRICS.map(function (m, i) {
      return { k: i, t: m.label, type: i === 0 ? "bandscore" : "score", band: scoreBand };
    }));

    // Audit grade distribution as a stacked bar per month (grades derived from the raw
    // Audit Score, since the numeric scale is mixed/messy across years).
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
        // stack A (bottom) → F (top) via column-reverse
        var segs = GRADES.map(function (gr) {
          var n = d.counts[gr.g];
          if (!n) return "";
          var h = (n / maxTotal) * CHART_H;
          return '<div style="width:100%;height:' + h + "px;background:" + gr.c +
            ';display:flex;align-items:center;justify-content:center;overflow:hidden">' +
            (h >= 12 ? '<span style="font-size:8px;font-weight:800;color:#fff;line-height:1">' + n + "</span>" : "") + "</div>";
        }).join("");
        var tip = GRADES.filter(function (gr) { return d.counts[gr.g]; }).map(function (gr) { return gr.g + ":" + d.counts[gr.g]; }).join("  ");
        return '<div title="' + esc(d.x.p.full + " — " + (tip || "no grade")) + '" style="display:flex;flex-direction:column;align-items:center;width:' + BAR_W + 'px;flex-shrink:0">' +
          '<div style="width:100%;display:flex;flex-direction:column-reverse;border-radius:3px;overflow:hidden">' + segs + "</div>" +
          (d.total ? '<div style="font-size:8px;font-weight:800;color:#1C1416;margin-top:2px;line-height:1">' + d.total + "</div>" : "") + "</div>";
      }).join("");

      // year group labels
      var yearGroups = [];
      months.forEach(function (x) { var g = yearGroups[yearGroups.length - 1]; if (!g || g.yr !== x.p.year) yearGroups.push({ yr: x.p.year, count: 1, start: x }); else g.count++; });
      var yearRow = '<div style="display:flex;padding-left:' + NAME_PAD + 'px;margin-top:4px">' + yearGroups.map(function (g, gi) {
        return '<div style="width:' + (g.count * COL) + "px;flex-shrink:0;border-left:" + (gi > 0 ? "2px solid rgba(228,1,43,.2)" : "none") +
          ';font-family:Sora;font-size:10px;font-weight:800;color:var(--red);text-align:center">' + g.yr + "</div>";
      }).join("") + "</div>";
      var monRow = '<div style="display:flex;padding-left:' + NAME_PAD + 'px">' + months.map(function (x) {
        return '<div style="width:' + COL + 'px;flex-shrink:0;font-size:8px;color:#A89C97;text-align:center;font-weight:600">' + MON3[x.p.monIdx] + "</div>";
      }).join("") + "</div>";

      var legend = '<div class="legend">' + GRADES.map(function (gr) { return '<span><i class="sw" style="background:' + gr.c + '"></i>' + gr.g + "</span>"; }).join("") + "</div>";
      var totalW = months.length * COL + 8;

      return '<div class="h2l">Audit grades by month</div>' +
        '<div class="sub13" style="margin:0 4px 10px">Letter grade derived from the audit score each month, stacked across branches ' +
        '(2024 used a 1–5 scale; 2025+ used A–D). Number on each bar is branches graded that month.</div>' + legend +
        '<div class="card" style="overflow-x:auto;padding:14px 12px 10px"><div style="min-width:' + totalW + 'px">' +
          '<div style="display:flex;align-items:flex-end;height:' + CHART_H + 'px;gap:' + GAP + "px;padding-left:" + NAME_PAD + 'px">' + bars + "</div>" +
          monRow + yearRow +
        "</div></div>";
    }

    return {
      kind: "opstd", label: "Operational Standard", branches: O.branches, periods: periods, years: yearsOf(periods),
      lastActive: lastActive, hasArea: false, areas: [],
      headline: METRICS[0], metrics: METRICS, metric: metric,
      filterRows: filterRows, aggregate: aggregate, record: record, cellValue: cellValue, cellDetail: cellDetail,
      statusCards: statusCards, heroSub: heroSub, secondaryBreakdown: secondaryBreakdown, extraSection: extraSection,
      regCols: REG_COLS, regField: function (rec, k) { return rec[k]; },
      source: "Operational_Standards_Consolidated_2024–2026",
    };
  }

  function assign(f, over) { var o = {}; for (var k in f) o[k] = f[k]; for (var k2 in over) o[k2] = over[k2]; return o; }

  // ---- Models ----
  var MODELS = { defects: buildDefects(), opstd: window.OPSTD_DATA ? buildOpStd() : null };

  // ---- State ----
  var state = {
    mode: "defects", tab: "pulse",
    year: "all", branch: -1, area: -1,
    heatMetric: { defects: "defectRate", opstd: 0 },
    sort: { defects: { key: "defects", dir: -1 }, opstd: { key: 0, dir: -1 } },
    heatSel: null,
  };
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE) || "{}");
    ["mode", "tab", "year"].forEach(function (k) { if (saved[k] != null) state[k] = saved[k]; });
    if (saved.heatMetric) state.heatMetric = saved.heatMetric;
  } catch (e) {}
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify({ mode: state.mode, tab: state.tab, year: state.year, heatMetric: state.heatMetric })); } catch (e) {}
  }
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
    var yearOpts = '<option value="all"' + (state.year === "all" ? " selected" : "") + '>All years</option>' +
      m.years.map(function (y) { return '<option value="' + y + '"' + (state.year === y ? " selected" : "") + '>' + y + '</option>'; }).join("");
    var branchChips = '<button class="chip' + (state.branch < 0 ? " on" : "") + '" data-branch="-1">All branches</button>' +
      m.branches.map(function (b, i) { return '<button class="chip' + (state.branch === i ? " on" : "") + '" data-branch="' + i + '">' + esc(b) + '</button>'; }).join("");
    var html = '<div class="row between mid" style="margin:2px 4px 8px;gap:8px">' +
      '<div class="period-select-label">Filters</div>' +
      '<select class="sel" id="year-sel">' + yearOpts + '</select></div>' +
      '<div class="chips"' + (m.hasArea ? ' style="margin-bottom:6px"' : "") + '>' + branchChips + '</div>';
    if (m.hasArea) {
      html += '<div class="chips">' +
        '<button class="chip' + (state.area < 0 ? " on" : "") + '" data-area="-1">All process areas</button>' +
        m.areas.map(function (a, i) { return '<button class="chip' + (state.area === i ? " on" : "") + '" data-area="' + i + '">' + esc(a) + '</button>'; }).join("") +
        '</div>';
    }
    return html;
  }
  function statusCard(c) {
    return '<div class="card"><div class="num"' + (c.color ? ' style="color:' + c.color + '"' : "") + '>' + c.value + '</div>' +
      '<div class="sub" style="margin-top:2px">' + esc(c.label) + '</div></div>';
  }
  function legendRow(items) {
    return '<div class="legend">' + items.map(function (it) { return '<span><i class="sw" style="background:' + it[0] + '"></i>' + it[1] + '</span>'; }).join("") + '</div>';
  }
  function footer(m) {
    return '<div style="font-size:11px;color:#A89C97;text-align:center;margin:22px 0 8px">' +
      'VMBS ' + esc(m.label) + ' · Source: ' + esc(m.source) + ' · ' + m.branches.length + ' branches</div>';
  }

  function activeMonths(m) {
    return m.periods.map(function (p, pi) { return { p: p, pi: pi }; })
      .filter(function (x) { return x.pi <= m.lastActive && (state.year === "all" || x.p.year === state.year); });
  }

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
      return '<button class="card btncard"' + (m.kind === "defects" ? ' data-area="' + m.areas.indexOf(c.name) + '"' : "") + '>' +
        '<div class="row between mid"><div style="flex:1;padding-right:10px"><div class="t13">' + esc(c.name) + '</div>' +
        '<div class="sub" style="margin-top:3px">' + esc(c.sub) + '</div></div>' +
        '<span class="statpill" style="background:' + c.band.bg + ';color:' + c.band.c + '">' + c.value + '</span></div></button>';
    }).join("");

    // Branch breakdown by headline metric, worst first.
    var per = m.branches.map(function (name, i) {
      var a = m.aggregate(m.filterRows(assign(f, { branch: i })), m.headline.key);
      return { i: i, name: name, v: a };
    }).filter(function (x) { return x.v != null; });
    per.sort(function (x, y) { return m.headline.betterHigh ? x.v - y.v : y.v - x.v; });
    var branchCards = per.slice(0, state.branch < 0 ? 6 : 16).map(function (x) {
      var b = (m.headline.band || defectBand)(x.v);
      return '<button class="card btncard" data-branch="' + x.i + '">' +
        '<div class="row between mid"><div style="flex:1;padding-right:10px"><div class="t14">' + esc(x.name) + '</div>' +
        '<div class="sub" style="margin-top:3px">' + esc(m.headline.label) + '</div></div>' +
        '<span class="statpill" style="background:' + b.bg + ';color:' + b.c + '">' + (m.kind === "opstd" ? fmtScore(x.v) : fmtPct(x.v)) + '</span></div></button>';
    }).join("");

    document.getElementById("content").innerHTML =
      filterChips(m) +
      '<div class="hero"><div class="row between base"><span class="eyebrow">' + esc(m.headline.label.toUpperCase()) + '</span>' +
        '<span class="dim12">' + esc(scopeLabel(m)) + '</span></div>' +
        '<div class="big">' + hfmt + '</div><div class="dim13">' + esc(m.heroSub(rows)) + '</div></div>' +
      '<div class="grid-status">' + status + '</div>' +
      '<div class="h2l">' + esc(m.headline.label) + ' trend</div><div class="card">' + sparkline(m) + '</div>' +
      (m.extraSection ? m.extraSection(f) : "") +
      '<div class="h2l">' + esc(sb.title) + '</div><div class="grid-cats">' + sbCards + '</div>' +
      '<div class="h2l">' + (state.branch < 0 ? "Branches by " + esc(m.headline.label.toLowerCase()) : "Branch detail") + '</div>' +
      '<div class="grid-cats">' + (branchCards || '<div class="card"><div class="sub13">No data for this scope.</div></div>') + '</div>' +
      footer(m);
  }

  function sparkline(m) {
    var f = filters();
    var data = activeMonths(m).map(function (x) {
      return { label: x.p.label, v: m.aggregate(m.filterRows(assign(f, { period: x.pi })), m.headline.key) };
    });
    var max = Math.max.apply(null, data.map(function (d) { return d.v || 0; }).concat(m.kind === "opstd" ? 100 : 0.001));
    var bars = data.map(function (d) {
      var h = d.v ? Math.max(2, (d.v / max) * 40) : 2;
      var b = (m.headline.band || defectBand)(d.v);
      var val = m.kind === "opstd" ? fmtScore(d.v) : fmtPct(d.v);
      return '<div class="sparkbar" title="' + esc(d.label) + ": " + val + '" style="height:' + h + "px;background:" + (d.v == null ? "#E8E1DD" : b.c) + '"></div>';
    }).join("");
    var first = data[0], last = data[data.length - 1];
    return '<div class="row between base"><span class="sub">' + esc(first ? first.label : "") + '</span>' +
      '<span class="sub">' + esc(last ? last.label : "") + '</span></div><div class="spark">' + bars + '</div>' +
      '<div class="sub" style="margin-top:6px">Bar colour reflects the RAG band for that month. Data through ' + esc(m.periods[m.lastActive].full) + '.</div>';
  }

  // ---- Screen: Heatmap ----
  function renderHeatmap() {
    var m = model();
    var mk = state.heatMetric[state.mode];
    var metric = m.metric(mk);
    var months = activeMonths(m);
    var CELL_W = 22, CELL_H = 16, NAME_W = 130;
    var f = filters();

    var yearGroups = [];
    months.forEach(function (x) { var g = yearGroups[yearGroups.length - 1]; if (!g || g.yr !== x.p.year) yearGroups.push({ yr: x.p.year, count: 1 }); else g.count++; });

    var headerYears = '<div style="display:flex;padding-left:' + NAME_W + 'px">' + yearGroups.map(function (g, gi) {
      return '<div style="width:' + (g.count * (CELL_W + 2)) + "px;flex-shrink:0;border-left:" + (gi > 0 ? "2px solid rgba(228,1,43,.2)" : "none") +
        ';font-family:Sora;font-size:11px;font-weight:800;color:var(--red);text-align:center">' + g.yr + "</div>";
    }).join("") + "</div>";
    var headerMonths = '<div style="display:flex;padding-left:' + NAME_W + 'px;margin-bottom:2px">' + months.map(function (x) {
      return '<div style="width:' + (CELL_W + 2) + 'px;flex-shrink:0;font-size:8px;color:#A89C97;text-align:center;font-weight:600">' + MON3[x.p.monIdx] + "</div>";
    }).join("") + "</div>";

    var rows = m.branches.map(function (bname, bi) {
      if (state.branch >= 0 && bi !== state.branch) return "";
      var cells = months.map(function (x) {
        var v = m.cellValue(bi, x.pi, mk, f);
        var selq = state.heatSel && state.heatSel.b === bi && state.heatSel.p === x.pi;
        return '<div class="hmcell" data-b="' + bi + '" data-p="' + x.pi + '" style="width:' + CELL_W + "px;height:" + CELL_H + "px;background:" + metric.heat(v) +
          (selq ? ";outline:2px solid var(--ink);outline-offset:-1px;z-index:1" : "") + '"></div>';
      }).join("");
      return '<div style="display:flex;align-items:center;margin-bottom:2px"><div class="hmname" style="width:' + NAME_W + 'px">' + esc(bname) + "</div>" + cells + "</div>";
    }).join("");

    var metricChips = m.metrics.map(function (mm) {
      return '<button class="chip' + (mk === mm.key ? " on" : "") + '" data-heat="' + mm.key + '">' + esc(mm.label) + "</button>";
    }).join("");

    document.getElementById("content").innerHTML =
      filterChips(m) +
      '<div class="h2l">' + esc(metric.label) + ' heatmap</div>' +
      '<div class="chips" style="margin-bottom:8px">' + metricChips + "</div>" +
      '<div class="sub13" style="margin:0 4px 10px">Each cell is a branch’s ' + esc(metric.label.toLowerCase()) + ' for that month' +
        (m.hasArea && state.area >= 0 ? " in " + esc(m.areas[state.area]) : "") + ". Tap a cell for detail.</div>" +
      legendRow(metric.legend) +
      '<div class="card" style="overflow-x:auto;padding:12px"><div style="min-width:' + (NAME_W + months.length * (CELL_W + 2)) + 'px">' +
        headerYears + headerMonths + rows + "</div></div>" +
      '<div id="heat-detail"></div>' + footer(m);
    renderHeatDetail();
  }
  function renderHeatDetail() {
    var el = document.getElementById("heat-detail");
    if (!el) return;
    if (!state.heatSel) { el.innerHTML = ""; return; }
    var m = model(), b = state.heatSel.b, p = state.heatSel.p;
    el.innerHTML = '<div class="notebox" style="margin-top:12px"><div class="b t13">' + esc(m.branches[b]) + " · " + esc(m.periods[p].full) + "</div>" +
      '<div class="row gap8 wrap" style="margin-top:6px">' + m.cellDetail(b, p, filters()) + "</div></div>";
  }

  // ---- Screen: Register ----
  function renderRegister() {
    var m = model(), f = filters();
    var groupBy = m.hasArea && state.branch >= 0 ? "area" : "branch";
    var groups = {};
    m.filterRows(f).forEach(function (r) {
      var key = groupBy === "area" ? r[2] : r[1];
      (groups[key] || (groups[key] = [])).push(r);
    });
    var rows = Object.keys(groups).map(function (k) {
      var rec = m.record(groups[k]);
      rec.name = groupBy === "area" ? m.areas[k] : m.branches[k];
      return rec;
    });

    var sort = state.sort[state.mode];
    rows.sort(function (x, y) {
      if (sort.key === "name") return sort.dir * String(x.name).localeCompare(String(y.name));
      var xv = x[sort.key] == null ? -Infinity : x[sort.key], yv = y[sort.key] == null ? -Infinity : y[sort.key];
      return sort.dir * (xv - yv);
    });

    var total = m.record(m.filterRows(f));
    total.name = groupBy === "area" ? "All areas" : "All branches";

    var thead = "<tr>" + m.regCols.map(function (c) {
      return '<th data-sort="' + c.k + '" class="' + (sort.key == c.k ? "sorted" : "") + '">' + esc(c.t) + (sort.key == c.k ? (sort.dir < 0 ? " ▾" : " ▴") : "") + "</th>";
    }).join("") + "</tr>";

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
    function rowHtml(rec, isTotal) {
      return "<tr" + (isTotal ? ' class="total"' : "") + ">" + m.regCols.map(function (c) { return cell(rec, c); }).join("") + "</tr>";
    }

    document.getElementById("content").innerHTML =
      filterChips(m) +
      '<div class="h2l">Consolidated register · by ' + groupBy + "</div>" +
      '<div class="sub13" style="margin:0 4px 6px">' + esc(scopeLabel(m)) + " · " + rows.length + " rows · tap a column to sort.</div>" +
      '<div class="tbl-wrap"><table class="reg"><thead>' + thead + "</thead><tbody>" +
        rows.map(function (r) { return rowHtml(r, false); }).join("") + rowHtml(total, true) + "</tbody></table></div>" +
      footer(m);
  }

  // ---- Tabs ----
  var TABS = [
    { id: "pulse", label: "Pulse", icon: "M3 12h4l3-8 4 16 3-8h4" },
    { id: "heatmap", label: "Heatmap", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
    { id: "register", label: "Register", icon: "M4 6h16M4 12h16M4 18h10" },
  ];
  function renderTabs() {
    document.getElementById("tabbar").innerHTML = TABS.map(function (t) {
      return '<button class="tabbtn' + (state.tab === t.id ? " on" : "") + '" data-tab="' + t.id + '">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + t.icon + '"/></svg>' +
        "<span>" + t.label + "</span></button>";
    }).join("");
  }

  // ---- Dispatch ----
  function render() {
    var m = model();
    if (!m) { // opstd data missing
      document.getElementById("content").innerHTML = '<div class="card awaiting"><div class="t15">Operational Standard</div><div class="sub13">Dataset not loaded.</div></div>';
      document.getElementById("tabbar").style.display = "none";
      return;
    }
    document.getElementById("tabbar").style.display = "";
    document.getElementById("appbar-sub").textContent = m.label + " · Latest data " + m.periods[m.lastActive].full;
    Array.prototype.forEach.call(document.querySelectorAll("#mode-toggle button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-mode") === state.mode);
    });
    renderTabs();
    if (state.tab === "heatmap") renderHeatmap();
    else if (state.tab === "register") renderRegister();
    else renderPulse();
  }

  // ---- CSV export ----
  function exportCSV() {
    var m = model(), f = filters();
    var lines, name;
    if (m.kind === "defects") {
      lines = ["Period,Branch,Process Area,Items Reviewed,Possible Instances,Defects,Defect Rate,Resolvable,Resolved,Resolution Rate,Recurring,Recurring Rate"];
      m.filterRows(f).forEach(function (r) {
        var dr = r[4] ? r[5] / r[4] : "", rr = r[6] ? r[7] / r[6] : "", rc = r[5] ? r[8] / r[5] : "";
        lines.push([m.periods[r[0]].iso, '"' + m.branches[r[1]] + '"', '"' + m.areas[r[2]] + '"', r[3], r[4], r[5], dr, r[6], r[7], rr, r[8], rc].join(","));
      });
      name = "branch-defects";
    } else {
      lines = ["Period,Branch," + m.metrics.map(function (x) { return '"' + x.label + '"'; }).join(",")];
      m.filterRows(f).forEach(function (r) {
        lines.push([m.periods[r[0]].iso, '"' + m.branches[r[1]] + '"'].concat(m.metrics.map(function (x) { return r[2 + x.key] == null ? "" : r[2 + x.key]; })).join(","));
      });
      name = "operational-standard";
    }
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = name + "-" + state.year + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Events ----
  function onClick(e) {
    var t = e.target.closest("[data-mode],[data-tab],[data-branch],[data-area],[data-heat],[data-b][data-p],[data-sort]");
    if (!t) return;
    if (t.hasAttribute("data-mode")) { if (state.mode !== t.getAttribute("data-mode")) { state.mode = t.getAttribute("data-mode"); state.branch = -1; state.area = -1; state.heatSel = null; } persist(); render(); return; }
    if (t.hasAttribute("data-tab")) { state.tab = t.getAttribute("data-tab"); state.heatSel = null; persist(); render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute("data-heat")) { var k = t.getAttribute("data-heat"); state.heatMetric[state.mode] = isNaN(+k) ? k : +k; state.heatSel = null; persist(); render(); return; }
    if (t.hasAttribute("data-sort")) {
      var sk = t.getAttribute("data-sort"); var key = isNaN(+sk) ? sk : +sk;
      var s = state.sort[state.mode];
      if (s.key == key) s.dir *= -1; else state.sort[state.mode] = { key: key, dir: key === "name" ? 1 : -1 };
      renderRegister(); return;
    }
    if (t.hasAttribute("data-b") && t.hasAttribute("data-p")) {
      var b = +t.getAttribute("data-b"), p = +t.getAttribute("data-p");
      state.heatSel = (state.heatSel && state.heatSel.b === b && state.heatSel.p === p) ? null : { b: b, p: p };
      renderHeatmap(); return;
    }
    if (t.hasAttribute("data-branch")) { state.branch = +t.getAttribute("data-branch"); state.heatSel = null; render(); return; }
    if (t.hasAttribute("data-area")) { state.area = +t.getAttribute("data-area"); state.heatSel = null; render(); return; }
  }
  function onChange(e) { if (e.target.id === "year-sel") { state.year = e.target.value; state.heatSel = null; persist(); render(); } }

  function init() {
    document.getElementById("content").addEventListener("click", onClick);
    document.getElementById("mode-toggle").addEventListener("click", onClick);
    document.getElementById("tabbar").addEventListener("click", onClick);
    document.getElementById("content").addEventListener("change", onChange);
    document.getElementById("export-btn").addEventListener("click", exportCSV);
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
