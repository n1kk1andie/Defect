// The headline card's colour carries meaning, the same in every Pulsus app:
// black for good (World class, Strong, Healthy; on or above target), amber for
// mixed (Watch, or a summary where some measures are fine and some are not),
// red for not good (Attention, Escalate; below target), and black with "No
// reading yet" when there is nothing to read. The colour is never the only
// signal: the card also shows the band name or the tone label. Pure, so the
// screens and the tests share it.

export type HeroTone = "good" | "mixed" | "bad" | "none";

const GOOD = new Set(["worldClass", "world_class", "world class", "strong", "healthy"]);
const MIXED = new Set(["watch"]);
const BAD = new Set(["attention", "escalate"]);

/** The tone for one band key (or band label); anything unknown or empty reads as "none". */
export function heroTone(band: string | null | undefined): HeroTone {
  if (!band) return "none";
  const k = String(band).trim();
  const l = k.toLowerCase();
  if (GOOD.has(k) || GOOD.has(l)) return "good";
  if (MIXED.has(l)) return "mixed";
  if (BAD.has(l)) return "bad";
  return "none";
}

/** The tone for a card that sums up several measures: all good is good, all
 *  not-good is bad, anything in between (a Watch, or some fine and some not)
 *  is mixed. Measures with no reading are left out; none at all is "none". */
export function heroToneOf(bands: ReadonlyArray<string | null | undefined>): HeroTone {
  const tones = bands.map(heroTone).filter((t) => t !== "none");
  if (!tones.length) return "none";
  if (tones.every((t) => t === "good")) return "good";
  if (tones.every((t) => t === "bad")) return "bad";
  return "mixed";
}

/** Words for the tone, for the chip on the card and for screen readers. */
export const HERO_TONE_LABEL: Record<HeroTone, string> = {
  good: "On track",
  mixed: "Mixed",
  bad: "Needs attention",
  none: "No reading yet",
};

/** The class that colours the card (see `.hero.tone-*` in the stylesheet). */
export const heroToneClass = (t: HeroTone) => `tone-${t}`;
