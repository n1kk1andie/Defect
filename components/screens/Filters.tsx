"use client";
// The shared filters: Branch Defects or the scorecard, year, unit and process area.
import { useApp } from "@/components/app-context";
import { Chips, Seg, Select } from "@/components/ui";
import { years } from "@/lib/metrics";

export function ModeToggle() {
  const { data, filters, setFilters } = useApp();
  if (!data.scorecard) return null;
  return (
    <div style={{ maxWidth: 560, marginBottom: 14 }}>
      <Seg label="Dataset" value={filters.mode} onChange={(mode) => setFilters({ mode })} options={[{ value: "defects", label: "Branch Defects" }, { value: "standard", label: data.scorecard.name }]} />
    </div>
  );
}

export function YearSelect({ allowAll = true, periods }: { allowAll?: boolean; periods?: string[] }) {
  const { data, filters, setFilters } = useApp();
  const ys = years(periods ?? (filters.mode === "standard" && data.scorecard ? data.scorecard.periods : data.periods));
  const opts = [...(allowAll ? [{ value: "all", label: "All years" }] : []), ...ys.slice().reverse().map((y) => ({ value: y, label: y }))];
  return <Select label="Year" value={filters.year} onChange={(year) => setFilters({ year })} options={opts} />;
}

export function FilterBar({ areas = true }: { areas?: boolean }) {
  const { data, settings, filters, setFilters } = useApp();
  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      <Chips label={`Filter by ${settings.unitLabel.toLowerCase()}`} value={filters.unit} onChange={(unit) => setFilters({ unit })}
        options={[{ value: -1, label: `All ${settings.unitPlural.toLowerCase()}` }, ...data.units.map((u, i) => ({ value: i, label: u.name }))]} />
      {areas && filters.mode === "defects" && data.areas.length > 1 && (
        <Chips label="Filter by process area" value={filters.area} onChange={(area) => setFilters({ area })}
          options={[{ value: -1, label: "All process areas" }, ...data.areas.map((a, i) => ({ value: i, label: a.name }))]} />
      )}
    </div>
  );
}

export function scopeText(app: ReturnType<typeof useApp>): string {
  const { data, settings, filters } = app;
  const u = filters.unit >= 0 ? data.units[filters.unit]?.name : `All ${settings.unitPlural.toLowerCase()}`;
  const a = filters.mode === "defects" ? (filters.area >= 0 ? data.areas[filters.area]?.name : "all process areas") : null;
  return [u, a, filters.year === "all" ? "all years" : filters.year].filter(Boolean).join(" · ");
}
