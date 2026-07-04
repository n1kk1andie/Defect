/* Defect Tracker — vanilla JS, localStorage-backed. No build step required. */
(function () {
  "use strict";

  var STORAGE_KEY = "defect-tracker:v1";
  var THEME_KEY = "defect-tracker:theme";
  var STATUSES = ["Open", "In Progress", "Resolved", "Closed"];
  var SEVERITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  var PRIORITY_RANK = { P0: 4, P1: 3, P2: 2, P3: 1 };

  // ---- State ----
  var defects = [];
  var view = "board"; // "board" | "table"
  var filters = { search: "", status: "", severity: "", assignee: "", sort: "updated-desc" };

  // ---- Persistence ----
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        defects = JSON.parse(raw);
        return;
      }
    } catch (e) {
      console.warn("Failed to read saved data, falling back to seed.", e);
    }
    defects = (window.SEED_DEFECTS || []).map(function (d) { return Object.assign({}, d); });
    save();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defects));
    } catch (e) {
      console.error("Failed to save data.", e);
    }
  }

  // ---- Helpers ----
  function nowISO() { return new Date().toISOString(); }

  function nextId() {
    var max = 0;
    defects.forEach(function (d) {
      var m = /^DEF-(\d+)$/.exec(d.id || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "DEF-" + String(max + 1).padStart(3, "0");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function relativeDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    var diff = Date.now() - d.getTime();
    var day = 86400000;
    if (diff < day) return "today";
    if (diff < 2 * day) return "yesterday";
    if (diff < 7 * day) return Math.floor(diff / day) + "d ago";
    return formatDate(iso);
  }

  function initials(name) {
    if (!name) return "?";
    var parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function avatarColor(name) {
    var palette = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
    var h = 0;
    for (var i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  function statusClass(status) { return "badge-st-" + status.replace(/\s+/g, ""); }

  // ---- Derived data ----
  function assignees() {
    var set = {};
    defects.forEach(function (d) { if (d.assignee) set[d.assignee] = true; });
    return Object.keys(set).sort();
  }

  function components() {
    var set = {};
    defects.forEach(function (d) { if (d.component) set[d.component] = true; });
    return Object.keys(set).sort();
  }

  function visibleDefects() {
    var q = filters.search.trim().toLowerCase();
    var list = defects.filter(function (d) {
      if (filters.status && d.status !== filters.status) return false;
      if (filters.severity && d.severity !== filters.severity) return false;
      if (filters.assignee && d.assignee !== filters.assignee) return false;
      if (q) {
        var hay = [d.id, d.title, d.description, d.component, d.assignee, d.reporter].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    var s = filters.sort;
    list.sort(function (a, b) {
      switch (s) {
        case "created-desc": return cmpDate(b.createdAt, a.createdAt);
        case "created-asc": return cmpDate(a.createdAt, b.createdAt);
        case "severity-desc": return (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
        case "priority-desc": return (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0);
        case "title-asc": return (a.title || "").localeCompare(b.title || "");
        case "updated-desc":
        default: return cmpDate(b.updatedAt, a.updatedAt);
      }
    });
    return list;
  }

  function cmpDate(a, b) {
    return new Date(a || 0).getTime() - new Date(b || 0).getTime();
  }

  // ---- Rendering ----
  function renderStats() {
    var total = defects.length;
    var open = defects.filter(function (d) { return d.status === "Open"; }).length;
    var progress = defects.filter(function (d) { return d.status === "In Progress"; }).length;
    var resolved = defects.filter(function (d) { return d.status === "Resolved" || d.status === "Closed"; }).length;
    var critical = defects.filter(function (d) {
      return d.severity === "Critical" && d.status !== "Closed" && d.status !== "Resolved";
    }).length;

    var cards = [
      { label: "Total defects", value: total, sub: total + " tracked", cls: "" },
      { label: "Open", value: open, sub: "awaiting triage", cls: "accent-open" },
      { label: "In progress", value: progress, sub: "being worked", cls: "accent-progress" },
      { label: "Resolved / Closed", value: resolved, sub: pct(resolved, total) + " of all", cls: "accent-resolved" },
      { label: "Open critical", value: critical, sub: "needs attention", cls: "accent-critical" },
    ];

    document.getElementById("stats").innerHTML = cards.map(function (c) {
      return '<div class="stat-card ' + c.cls + '">' +
        '<div class="stat-label">' + c.label + '</div>' +
        '<div class="stat-value">' + c.value + '</div>' +
        '<div class="stat-sub">' + c.sub + '</div>' +
        '</div>';
    }).join("");
  }

  function pct(n, total) { return total ? Math.round((n / total) * 100) + "%" : "0%"; }

  function cardHtml(d) {
    return '<div class="card" data-id="' + escapeHtml(d.id) + '" draggable="true">' +
      '<div class="card-top">' +
        '<span class="card-id">' + escapeHtml(d.id) + '</span>' +
        '<span class="badge badge-sev-' + escapeHtml(d.severity) + '">' + escapeHtml(d.severity) + '</span>' +
        '<span class="badge badge-pri">' + escapeHtml(d.priority || "") + '</span>' +
      '</div>' +
      '<div class="card-title">' + escapeHtml(d.title) + '</div>' +
      '<div class="card-meta">' +
        (d.component ? '<span>▪ ' + escapeHtml(d.component) + '</span>' : '') +
        (d.assignee
          ? '<span class="card-assignee"><span class="avatar" style="background:' + avatarColor(d.assignee) + '">' + escapeHtml(initials(d.assignee)) + '</span>' + escapeHtml(d.assignee) + '</span>'
          : '<span>Unassigned</span>') +
        '<span title="Updated ' + escapeHtml(formatDate(d.updatedAt)) + '">🕑 ' + escapeHtml(relativeDate(d.updatedAt)) + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderBoard(list) {
    var byStatus = {};
    STATUSES.forEach(function (s) { byStatus[s] = []; });
    list.forEach(function (d) { (byStatus[d.status] || (byStatus[d.status] = [])).push(d); });

    var html = '<div class="board">' + STATUSES.map(function (s) {
      var items = byStatus[s] || [];
      return '<div class="board-col" data-status="' + escapeHtml(s) + '">' +
        '<div class="board-col-head"><span>' + escapeHtml(s) + '</span><span class="count">' + items.length + '</span></div>' +
        items.map(cardHtml).join("") +
      '</div>';
    }).join("") + '</div>';

    document.getElementById("content").innerHTML = list.length ? html : emptyHtml();
    wireBoardDnD();
  }

  function renderTable(list) {
    if (!list.length) {
      document.getElementById("content").innerHTML = emptyHtml();
      return;
    }
    var rows = list.map(function (d) {
      return '<tr data-id="' + escapeHtml(d.id) + '">' +
        '<td class="cell-id">' + escapeHtml(d.id) + '</td>' +
        '<td>' + escapeHtml(d.title) + '</td>' +
        '<td><span class="badge ' + statusClass(d.status) + '">' + escapeHtml(d.status) + '</span></td>' +
        '<td><span class="badge badge-sev-' + escapeHtml(d.severity) + '">' + escapeHtml(d.severity) + '</span></td>' +
        '<td><span class="badge badge-pri">' + escapeHtml(d.priority || "") + '</span></td>' +
        '<td>' + escapeHtml(d.component || "—") + '</td>' +
        '<td>' + escapeHtml(d.assignee || "Unassigned") + '</td>' +
        '<td>' + escapeHtml(formatDate(d.updatedAt)) + '</td>' +
      '</tr>';
    }).join("");

    document.getElementById("content").innerHTML =
      '<div class="table-wrap"><table>' +
      '<thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Severity</th><th>Priority</th><th>Component</th><th>Assignee</th><th>Updated</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function emptyHtml() {
    var hasAny = defects.length > 0;
    return '<div class="empty"><div class="emoji">' + (hasAny ? "🔍" : "🐞") + '</div>' +
      '<h3>' + (hasAny ? "No defects match your filters" : "No defects yet") + '</h3>' +
      '<p>' + (hasAny ? "Try clearing the search or filters." : "Click “+ New Defect” to add one.") + '</p></div>';
  }

  function render() {
    renderStats();
    populateFilterOptions();
    var list = visibleDefects();
    if (view === "board") renderBoard(list); else renderTable(list);
    document.getElementById("view-board").classList.toggle("active", view === "board");
    document.getElementById("view-table").classList.toggle("active", view === "table");
  }

  function populateFilterOptions() {
    var sel = document.getElementById("filter-assignee");
    var current = filters.assignee;
    var opts = ['<option value="">All assignees</option>'].concat(
      assignees().map(function (a) {
        return '<option value="' + escapeHtml(a) + '"' + (a === current ? " selected" : "") + '>' + escapeHtml(a) + '</option>';
      })
    );
    sel.innerHTML = opts.join("");

    document.getElementById("assignee-list").innerHTML = assignees().map(function (a) {
      return '<option value="' + escapeHtml(a) + '"></option>';
    }).join("");
    document.getElementById("component-list").innerHTML = components().map(function (c) {
      return '<option value="' + escapeHtml(c) + '"></option>';
    }).join("");
  }

  // ---- Drag & drop (board) ----
  var dragId = null;
  function wireBoardDnD() {
    document.querySelectorAll(".card").forEach(function (card) {
      card.addEventListener("dragstart", function (e) {
        dragId = card.getAttribute("data-id");
        e.dataTransfer.effectAllowed = "move";
      });
    });
    document.querySelectorAll(".board-col").forEach(function (col) {
      col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("drag-over"); });
      col.addEventListener("dragleave", function () { col.classList.remove("drag-over"); });
      col.addEventListener("drop", function (e) {
        e.preventDefault();
        col.classList.remove("drag-over");
        var status = col.getAttribute("data-status");
        if (dragId && status) {
          var d = defects.find(function (x) { return x.id === dragId; });
          if (d && d.status !== status) {
            d.status = status;
            d.updatedAt = nowISO();
            save();
            render();
            toast(d.id + " → " + status);
          }
        }
        dragId = null;
      });
    });
  }

  // ---- Dialog ----
  function openDialog(defect) {
    var isEdit = !!defect;
    document.getElementById("dialog-title").textContent = isEdit ? "Edit " + defect.id : "New Defect";
    document.getElementById("f-id").value = isEdit ? defect.id : "";
    document.getElementById("f-title").value = isEdit ? defect.title : "";
    document.getElementById("f-description").value = isEdit ? (defect.description || "") : "";
    document.getElementById("f-status").value = isEdit ? defect.status : "Open";
    document.getElementById("f-severity").value = isEdit ? defect.severity : "Medium";
    document.getElementById("f-priority").value = isEdit ? (defect.priority || "P2") : "P2";
    document.getElementById("f-component").value = isEdit ? (defect.component || "") : "";
    document.getElementById("f-assignee").value = isEdit ? (defect.assignee || "") : "";
    document.getElementById("f-reporter").value = isEdit ? (defect.reporter || "") : "";
    document.getElementById("delete-btn").hidden = !isEdit;
    document.getElementById("dialog-backdrop").hidden = false;
    document.getElementById("f-title").focus();
  }

  function closeDialog() {
    document.getElementById("dialog-backdrop").hidden = true;
  }

  function saveFromForm(e) {
    e.preventDefault();
    var id = document.getElementById("f-id").value;
    var data = {
      title: document.getElementById("f-title").value.trim(),
      description: document.getElementById("f-description").value.trim(),
      status: document.getElementById("f-status").value,
      severity: document.getElementById("f-severity").value,
      priority: document.getElementById("f-priority").value,
      component: document.getElementById("f-component").value.trim(),
      assignee: document.getElementById("f-assignee").value.trim(),
      reporter: document.getElementById("f-reporter").value.trim(),
    };
    if (!data.title) return;

    if (id) {
      var d = defects.find(function (x) { return x.id === id; });
      if (d) {
        Object.assign(d, data);
        d.updatedAt = nowISO();
      }
      toast(id + " updated");
    } else {
      var newId = nextId();
      defects.push(Object.assign({ id: newId, createdAt: nowISO(), updatedAt: nowISO() }, data));
      toast(newId + " created");
    }
    save();
    closeDialog();
    render();
  }

  function deleteCurrent() {
    var id = document.getElementById("f-id").value;
    if (!id) return;
    if (!confirm("Delete " + id + "? This cannot be undone.")) return;
    defects = defects.filter(function (x) { return x.id !== id; });
    save();
    closeDialog();
    render();
    toast(id + " deleted");
  }

  // ---- Import / Export ----
  function exportJSON() {
    var blob = new Blob([JSON.stringify(defects, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "defects-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported " + defects.length + " defects");
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("Expected a JSON array of defects");
        // Normalise minimal shape; keep unknown fields.
        defects = data.map(function (d, i) {
          return Object.assign({
            id: d.id || "DEF-" + String(i + 1).padStart(3, "0"),
            title: d.title || "(untitled)",
            status: STATUSES.indexOf(d.status) >= 0 ? d.status : "Open",
            severity: SEVERITY_RANK[d.severity] ? d.severity : "Medium",
            priority: PRIORITY_RANK[d.priority] ? d.priority : "P2",
            createdAt: d.createdAt || nowISO(),
            updatedAt: d.updatedAt || nowISO(),
          }, d);
        });
        save();
        render();
        toast("Imported " + defects.length + " defects");
      } catch (err) {
        alert("Import failed: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ---- Toast ----
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  // ---- Theme ----
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("theme-toggle").textContent = theme === "dark" ? "☀️" : "🌙";
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  // ---- Wiring ----
  function findDefectFromEvent(e) {
    var el = e.target.closest("[data-id]");
    if (!el) return null;
    var id = el.getAttribute("data-id");
    return defects.find(function (x) { return x.id === id; });
  }

  function init() {
    load();

    var savedTheme = "light";
    try { savedTheme = localStorage.getItem(THEME_KEY) || "light"; } catch (e) {}
    applyTheme(savedTheme);

    // Header
    document.getElementById("new-defect-btn").addEventListener("click", function () { openDialog(null); });
    document.getElementById("theme-toggle").addEventListener("click", function () {
      applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
    document.getElementById("export-btn").addEventListener("click", exportJSON);
    document.getElementById("import-btn").addEventListener("click", function () {
      document.getElementById("import-file").click();
    });
    document.getElementById("import-file").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = "";
    });

    // Toolbar
    document.getElementById("search").addEventListener("input", function (e) { filters.search = e.target.value; render(); });
    document.getElementById("filter-status").addEventListener("change", function (e) { filters.status = e.target.value; render(); });
    document.getElementById("filter-severity").addEventListener("change", function (e) { filters.severity = e.target.value; render(); });
    document.getElementById("filter-assignee").addEventListener("change", function (e) { filters.assignee = e.target.value; render(); });
    document.getElementById("sort").addEventListener("change", function (e) { filters.sort = e.target.value; render(); });
    document.getElementById("view-board").addEventListener("click", function () { view = "board"; render(); });
    document.getElementById("view-table").addEventListener("click", function () { view = "table"; render(); });

    // Content click → open editor
    document.getElementById("content").addEventListener("click", function (e) {
      var d = findDefectFromEvent(e);
      if (d) openDialog(d);
    });

    // Dialog
    document.getElementById("defect-form").addEventListener("submit", saveFromForm);
    document.getElementById("dialog-close").addEventListener("click", closeDialog);
    document.getElementById("cancel-btn").addEventListener("click", closeDialog);
    document.getElementById("delete-btn").addEventListener("click", deleteCurrent);
    document.getElementById("dialog-backdrop").addEventListener("click", function (e) {
      if (e.target === this) closeDialog();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !document.getElementById("dialog-backdrop").hidden) closeDialog();
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
