// A Pulsus company's dashboards, computed from its own published reviews.
//
// This deployment's dashboards read a consolidated workbook (uploaded, or the
// bundled history) that each approved review is merged into. A company has no
// history of ours to start from: its Branch Defects dataset is built afresh on
// every read from its program (units and process areas, so they show before the
// first review) and the reviews its supervisors have published. Several reviews of
// the same unit, month and area add up rather than overwrite one another.
import { loadProgram, checkWeights } from "@/lib/program";
import { publishedSubmissions, summariseItems } from "@/lib/submissions";

const thisMonth = () => new Date().toISOString().slice(0, 7) + "-01";

export async function companyDefects(): Promise<any> {
  const [program, subs] = await Promise.all([loadProgram(), publishedSubmissions()]);
  const reviews = subs.filter((s) => s.dataset === "defects");
  const branches = Array.from(new Set([...program.units, ...reviews.map((s) => s.branch)]));
  const areas = Array.from(new Set([...program.areas.map((a) => a.name), ...reviews.flatMap((s) => (s.items || []).map((i) => i.area))]));
  const periods = Array.from(new Set(reviews.map((s) => s.period))).sort();
  if (!periods.length) periods.push(thisMonth());
  const weights = checkWeights(program);
  const cells = new Map<string, number[]>();
  for (const s of reviews) {
    const pi = periods.indexOf(s.period), bi = branches.indexOf(s.branch);
    const { byArea } = summariseItems(s.items || [], weights);
    for (const [area, v] of Object.entries(byArea)) {
      const ai = areas.indexOf(area);
      const key = `${pi}|${bi}|${ai}`;
      const row = cells.get(key) || [pi, bi, ai, 0, 0, 0, 0, 0, 0];
      row[3] += v.reviewed; row[4] += v.instances; row[5] += v.defects; row[6] += v.resolvable; row[7] += v.resolved; row[8] += v.recurring;
      cells.set(key, row);
    }
  }
  return {
    meta: { source: "Published reviews", columns: ["periodIdx", "branchIdx", "areaIdx", "reviewed", "instances", "defects", "resolvable", "resolved", "recurring"] },
    periods, branches, areas,
    rows: Array.from(cells.values()).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
  };
}
