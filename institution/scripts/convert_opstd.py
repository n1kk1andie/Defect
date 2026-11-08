#!/usr/bin/env python3
"""Convert an Operational Standards Consolidated .xlsx into js/opstd.js.

Usage:
    pip install openpyxl
    python3 scripts/convert_opstd.py path/to/Operational_Standards_Consolidated.xlsx > js/opstd.js

The sheet has one row per Year × Month × Branch with a set of 0–100 performance
scores (higher is better). Only clean numeric score columns are emitted; messy
columns are dropped:
    - 'Audit Score' mixes letter-grade codes (3/4/5) with 0–100 scores → dropped.
    - 'Compliance to Risk Metrics' holds free-text formula strings → dropped.
Non-numeric cells (e.g. "N/A (Queuing system down…)") become null.
"""
import sys
import json
import openpyxl

MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]

# (sheet column, short label) in display order. First entry is the headline metric.
METRICS = [
    ("Operational Standard Score", "Op Standard Score"),
    ("Average SLA Score", "Average SLA"),
    ("% Queue SLA Adherence", "Queue SLA"),
    ("Onboarding SLA", "Onboarding SLA"),
    ("Procurement Score", "Procurement"),
    ("Compliance to Major Procedure Policy", "Major Procedure"),
    ("Avg Compliance to Major Procedure Policy", "Avg Procedure Compliance"),
    ("Customer Complaints Resolved", "Complaints Resolved"),
    ("Audit Resolution", "Audit Resolution"),
]


# Canonical branch names, so labels read identically across datasets.
BRANCH_NORMALIZE = {"Duke St": "Duke Street"}


def branch(name):
    return BRANCH_NORMALIZE.get(name, name)


def numOrNull(v):
    return round(float(v), 2) if isinstance(v, (int, float)) else None


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    hdr = rows[0]
    data = rows[1:]
    ci = {h: i for i, h in enumerate(hdr)}

    def iso(r):
        y = str(r[ci["Year"]])
        m = MONTHS.index(r[ci["Month"]]) + 1
        return "%s-%02d-01" % (y, m)

    periods = sorted({iso(r) for r in data})
    branches = sorted({branch(r[ci["Branch"]]) for r in data})
    pI = {p: i for i, p in enumerate(periods)}
    bI = {b: i for i, b in enumerate(branches)}

    out_rows = []
    audit_raw = []
    for r in data:
        row = [pI[iso(r)], bI[branch(r[ci["Branch"]])]]
        for col, _ in METRICS:
            row.append(numOrNull(r[ci[col]]))
        out_rows.append(row)
        audit_raw.append(numOrNull(r[ci["Audit Score"]]))

    payload = {
        "meta": {
            "source": path.split("/")[-1],
            "columns": ["periodIdx", "branchIdx"] + [m[0] for m in METRICS],
            "note": "0–100 performance scores; higher is better. Non-numeric cells are null. "
                    "'Compliance to Risk Metrics' dropped (free-text). 'Audit Score' kept only as "
                    "raw values in auditRaw[] (mixed scales) — the app derives a letter grade from it.",
            "auditGradeMap": "2024 used a 1-5 scale (5=A,4=B,3=C,2=D,1=F); 2025+ used 100=A,80=B+,60=B,40=C,20=D.",
        },
        "metrics": [{"key": m[0], "label": m[1]} for m in METRICS],
        "periods": periods,
        "branches": branches,
        "rows": out_rows,
        "auditRaw": audit_raw,
    }

    sys.stdout.write(json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python3 scripts/convert_opstd.py <xlsx> > js/opstd.js")
    main(sys.argv[1])
