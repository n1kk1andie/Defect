#!/usr/bin/env python3
"""Convert a Branch Defects Consolidated .xlsx into js/data.js.

Usage:
    pip install openpyxl
    python3 scripts/convert.py path/to/Branch_Defects_Consolidated.xlsx > js/data.js

Expected columns (header row):
    Year, Period, Month, Branch, Process Area, # of Items Reviewed,
    # of Possible Instances, # of Defects, % Defects, # of Resolvable Defects,
    # of Defects Resolved, % Defects Resolved, # of Recurring Defects,
    % of Recurring Defects

Notes:
    - The spreadsheet 'Month' column is ignored (it is mislabeled). Month is
      derived from the ISO 'Period' date in the app.
    - Provided percentage columns are ignored; the app recomputes all rates from
      the raw counts. Only the raw counts are emitted here.
    - Branches/areas/periods are de-duplicated and rows reference them by index
      to keep the file small.
"""
import sys
import json
import openpyxl


# Canonical branch names, so labels read identically across datasets.
BRANCH_NORMALIZE = {"Duke St": "Duke Street"}


def branch(name):
    return BRANCH_NORMALIZE.get(name, name)


def num(v):
    return int(v) if isinstance(v, (int, float)) else 0


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    hdr = rows[0]
    data = rows[1:]
    ci = {h: i for i, h in enumerate(hdr)}

    def col(name):
        return ci[name]

    periods = sorted({str(r[col("Period")])[:10] for r in data})
    branches = sorted({branch(r[col("Branch")]) for r in data})
    areas = sorted({r[col("Process Area")] for r in data})
    pI = {p: i for i, p in enumerate(periods)}
    bI = {b: i for i, b in enumerate(branches)}
    aI = {a: i for i, a in enumerate(areas)}

    out_rows = []
    for r in data:
        out_rows.append([
            pI[str(r[col("Period")])[:10]],
            bI[branch(r[col("Branch")])],
            aI[r[col("Process Area")]],
            num(r[col("# of Items Reviewed")]),
            num(r[col("# of Possible Instances")]),
            num(r[col("# of Defects")]),
            num(r[col("# of Resolvable Defects")]),
            num(r[col("# of Defects Resolved")]),
            num(r[col("# of Recurring Defects")]),
        ])

    payload = {
        "meta": {
            "source": path.split("/")[-1],
            "columns": ["periodIdx", "branchIdx", "areaIdx", "reviewed", "instances",
                        "defects", "resolvable", "resolved", "recurring"],
            "note": "Percentages are recomputed from raw counts in-app. The spreadsheet's "
                    "'Month' column was dropped (mislabeled); month is derived from Period.",
        },
        "periods": periods,
        "branches": branches,
        "areas": areas,
        "rows": out_rows,
    }

    sys.stdout.write("/* Auto-generated from %s. Do not edit by hand. */\n" % payload["meta"]["source"])
    sys.stdout.write("window.DEFECT_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python3 scripts/convert.py <xlsx> > js/data.js")
    main(sys.argv[1])
