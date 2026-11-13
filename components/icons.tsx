// Line icons (24px grid, 1.8 stroke), drawn for Pulsus Quality. Decorative by
// default: the control around an icon carries the accessible name.
import type { SVGProps } from "react";

const P: Record<string, string> = {
  pulse: "M3 12h4l2.5-6 4 12 2.5-6H21",
  register: "M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM6 6h12v14H6zM9 11h6M9 15h4",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2",
  insights: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  review: "M5 4h14v16H5zM9 9l2 2 4-4M9 15h6",
  actions: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM9 12l2 2 4-4",
  report: "M6 3h9l5 5v13H6zM14 3v6h6M9 17v-3M12 17v-6M15 17v-4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  alert: "M12 3l10 18H2zM12 10v4M12 17.5v.5",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  check: "M5 12l5 5L20 7",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  database: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  palette: "M12 22a10 10 0 1 1 10-10c0 2.8-2.2 3-4 3h-1.5a1.5 1.5 0 0 0-1 2.6A1.5 1.5 0 0 1 14.5 22zM7.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM10.5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM15.5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  building: "M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h2M14 9h2M8 13h2M14 13h2",
  card: "M2 6h20v12H2zM2 10h20",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  scroll: "M8 3h11v15a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2h11v2a3 3 0 0 0 3 3M8 3a3 3 0 0 0-3 3v10M11 8h5M11 12h5",
  stamp: "M5 21h14M6 17h12v-3a2 2 0 0 0-2-2h-2l-.5-3.5a2.5 2.5 0 1 0-3 0L10 12H8a2 2 0 0 0-2 2z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  more: "M5 12h.01M12 12h.01M19 12h.01M4 5h16M4 19h16",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  layers: "M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5",
  clipboard: "M9 3h6v3H9zM7 5H5v16h14V5h-2M9 12l2 2 4-4",
  hash: "M5 9h14M5 15h14M10 4L8 20M16 4l-2 16",
  calendar: "M4 6h16v15H4zM4 10h16M9 3v4M15 3v4",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  checks: "M3 6l2 2 4-4M3 14l2 2 4-4M12 6h9M12 14h9",
  text: "M4 6h16M4 12h16M4 18h10",
  toggle: "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zM16 12h.01",
  pin: "M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  wifi: "M2 9a16 16 0 0 1 20 0M5 12.5a11 11 0 0 1 14 0M8.5 16a6 6 0 0 1 7 0M12 19.5h.01",
  play: "M7 4l13 8-13 8z",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
};

export type IconName = keyof typeof P;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={P[name]} />
    </svg>
  );
}
