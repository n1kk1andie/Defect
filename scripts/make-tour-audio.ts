// Records the demo tour's narration and joins it into ONE recording.
//
//   ELEVENLABS_API_KEY=… npx tsx --tsconfig tsconfig.json scripts/make-tour-audio.ts [voiceId]
//
// Each stop of components/demoTourStops.ts is recorded on its own (kept in
// scripts/tour-audio, named after the stop and a hash of the voice, its settings
// and the words, so changing a line re-records only that stop), then all of them
// are joined, with a short pause between, into public/tour/tour-<hash>.mp3.
// public/tour/manifest.json gives that file and where each stop starts and ends.
//
// Why one recording: a phone (Safari on an iPhone above all) lets a page start
// sound only from a tap. One recording is started once and plays straight
// through; the tour follows it, and Next or Back only moves within it. A new
// recording per stop would have to be started without a tap, which a phone may
// refuse part-way through.
//
// Needs ffmpeg and ffprobe. The key is only used here, never by the app.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { STOPS } from "../components/demoTourStops";

// Lily: the narrator of the Quality demo, a little slower than usual.
const VOICE = process.argv[2] || process.env.TOUR_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku"; // "Lily"
const MODEL = "eleven_multilingual_v2";
const FORMAT = "mp3_44100_64"; // mono speech: small enough for a phone on mobile data
// Stability 50%, similarity 75%, style 15%, speaker boost on, a touch slower.
const SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true, speed: 0.92 };
const GAP = 0.9; // seconds of quiet after each stop, while the page moves on
const KEY = process.env.ELEVENLABS_API_KEY || "";
const PARTS = join(process.cwd(), "scripts", "tour-audio");
const OUT = join(process.cwd(), "public", "tour");
mkdirSync(PARTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

/** What the narrator reads: the stop's own words for speaking, else its caption, in plain speech. */
const spoken = (t: string) => t.replace(/[“”]/g, "").replace(/ · /g, ", ").replace(/\s*→\s*/g, " then ").replace(/\s+/g, " ").trim();
const duration = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

// 1. One recording per stop (only those not already made).
const parts: string[] = [];
for (const s of STOPS) {
  const text = spoken(s.say ?? `${s.title}. ${s.text}`);
  const hash = createHash("sha256").update(JSON.stringify([VOICE, MODEL, FORMAT, SETTINGS, text])).digest("hex").slice(0, 10);
  const name = `${s.id}-${hash}.mp3`;
  const path = join(PARTS, name);
  parts.push(path);
  if (existsSync(path) && statSync(path).size > 1000) { console.log(`= ${name}`); continue; }
  if (!KEY) { console.error(`${s.id} needs recording: set ELEVENLABS_API_KEY.`); process.exit(1); }
  const status = execFileSync("curl", [
    "-s", "-m", "120", "-o", path, "-w", "%{http_code}", "-X", "POST",
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=${FORMAT}`,
    "-H", `xi-api-key: ${KEY}`, "-H", "content-type: application/json", "--data-binary", "@-",
  ], { input: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS }) }).toString();
  if (status !== "200" || statSync(path).size < 1000) { unlinkSync(path); throw new Error(`${s.id}: the voice service answered ${status}`); }
  console.log(`+ ${name}`);
}
for (const f of readdirSync(PARTS)) if (f.endsWith(".mp3") && !parts.some((p) => p.endsWith("/" + f))) { unlinkSync(join(PARTS, f)); console.log(`- ${f}`); }

// 2. Joined into one recording, each stop followed by a short pause; where each stop starts.
const work = join(tmpdir(), "pulsus-tour-" + process.pid);
mkdirSync(work, { recursive: true });
const marks: { id: string; start: number; end: number }[] = [];
let at = 0;
const wavs: string[] = [];
parts.forEach((p, k) => {
  const wav = join(work, `${k}.wav`);
  // Each part decoded to the same format and padded with the pause, so the join is exact.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", p, "-af", `apad=pad_dur=${GAP}`, "-ar", "44100", "-ac", "1", wav]);
  const d = duration(wav);
  marks.push({ id: STOPS[k].id, start: Math.round(at * 1000) / 1000, end: Math.round((at + d - GAP) * 1000) / 1000 });
  at += d;
  wavs.push(wav);
});
const list = join(work, "list.txt");
writeFileSync(list, wavs.map((w) => `file '${w}'`).join("\n"));
const joined = join(work, "tour.mp3");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-ac", "1", "-b:a", "64k", joined]);
const hash = createHash("sha256").update(readFileSync(joined)).digest("hex").slice(0, 10);
const file = `tour-${hash}.mp3`;
writeFileSync(join(OUT, file), readFileSync(joined));
for (const f of readdirSync(OUT)) if (f.endsWith(".mp3") && f !== file) { unlinkSync(join(OUT, f)); console.log(`- public/tour/${f}`); }
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ voice: VOICE, model: MODEL, file, duration: Math.round(at * 1000) / 1000, marks }, null, 2) + "\n");
console.log(`public/tour/${file}: ${marks.length} stops, ${Math.round(at)} s`);
