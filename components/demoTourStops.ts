// The Quality demo's guided tour: where it goes, what it outlines and what it
// says (components/DemoTour.tsx). The narration is recorded from these words by
// scripts/make-tour-audio.ts; changing a line re-records that stop.
//
// The demo is Meridian Financial Group's sample data (lib/demo/seed.ts and its
// companions), generated relative to the current month. The narration names
// only what the sample always shows: six branches, five process areas, Summit
// as the branch in trouble, missing customer verification recurring there,
// Summit's account-opening files failing their sample test.

/** A screen the tour visits (a route in the app's navigation, components/Shell.tsx NAV). */
export type TourPath = "/" | "/inspect" | "/actions" | "/insights" | "/risk" | "/sampling" | "/compare" | "/report" | "/templates" | "/settings";

export interface Stop {
  id: string;
  /** The screen the stop is on. */
  path: TourPath;
  /** Ring the screen's menu item (the stops that move to a new screen). */
  menu?: boolean;
  /**
   * What to outline: the first of these on the page. Each is a CSS selector
   * inside the screen (<main>), "card:Title" for the card or settings group
   * whose heading starts with Title, or "@selector" anywhere on the page
   * (the top bar). None: the rings say it all.
   */
  target: string[];
  title: string;
  /** The caption. */
  text: string;
  /** What the narrator says, when it differs from the caption. */
  say?: string;
}

export const STOPS: Stop[] = [
  {
    id: "welcome", path: "/", target: ["section.hero", "section.card[aria-label$='score']"],
    title: "Welcome to Pulsus Quality",
    text: "Quality reviews, inspections and checklists, and the corrective actions that follow, for every branch in one place. This is Meridian Financial Group, a fictional financial institution. About five minutes; pause, go back or close at any time.",
    say: "Hello, and welcome to Pulsus Quality. It brings your quality reviews, inspections and checklists, and the corrective actions that follow, into one place, for every branch. You're looking at Meridian Financial Group, a fictional financial institution. The tour takes about five minutes, and you can pause, go back, or close it whenever you like.",
  },
  {
    id: "start", path: "/", target: ['[data-tour="start"]'],
    title: "Six steps to follow",
    text: "Everything this tour covers, as six steps. Each one opens its screen and is ticked once you have seen it, so you can follow along now or come back to it later.",
    say: "Here's what we'll walk through, as six steps: where quality stands, inspections, actions, what keeps coming back, risk, and the report. Each step opens its screen, and is ticked once you've seen it, so you can follow along now, or come back to it later.",
  },
  {
    id: "pulse", path: "/", target: [".stack > .grid.g4", "section.hero"],
    title: "Where quality stands",
    text: "Pulse shows the defect rate across six branches and five process areas: the files reviewed, the defects found, how many are resolved and how many keep recurring. The defect rate is banded from World class to Escalate. Switch to the Operational Standard for the monthly scorecard.",
    say: "Let's start with Pulse. It shows the defect rate across six branches and five process areas: the files reviewed, the defects found, how many have been resolved, and how many keep recurring. The defect rate is banded, from world class to escalate. And one switch takes you to the Operational Standard, the monthly scorecard.",
  },
  {
    id: "branches", path: "/", target: ["card:Branches by defect rate", "card:Operational Standard score by", ".stack > .card"],
    title: "Branch by branch",
    text: "Every branch, worst first, and every process area. Summit stands out, well above the rest. Tap a branch to focus the dashboards on it.",
    say: "Then branch by branch, worst first. Summit stands out, well above the rest. Tap any branch, and the dashboards focus on it.",
  },
  {
    id: "inspect", path: "/inspect", menu: true, target: ["section.card.flush", ".grid.g4"],
    title: "Go and see",
    text: "Inspections, field visits and file reviews, on a phone and even without a signal: check in at the branch, answer, photograph and sign. Nothing counts until a supervisor who didn't carry it out approves it, and on approval every critical failure raises its own corrective action.",
    say: "Inspect is where the checking happens: inspections, field visits, and file reviews, on a phone, even without a signal. Check in at the branch, answer, photograph, and sign. Nothing counts until a supervisor who didn't carry it out approves it. And when they do, every critical failure raises its own corrective action.",
  },
  {
    id: "actions", path: "/actions", menu: true, target: ["card:Action register", ".grid.g4"],
    title: "Turn findings into action",
    text: "Every action has an owner, a due date and a root cause, with five whys or a fishbone. The owner submits it with evidence, and someone who didn't raise it or own it verifies it. An effectiveness check can confirm later that the fix held.",
    say: "Actions turns findings into fixes. Each one has an owner, a due date, and a root cause, worked through with five whys or a fishbone. The owner submits it with evidence, and someone who didn't raise it, or own it, verifies it. Later, an effectiveness check can confirm that the fix really held.",
  },
  {
    id: "insights", path: "/insights", menu: true, target: ["card:Recurring issues detected", "card:Branch watchlist"],
    title: "What keeps coming back",
    text: "The same defect at the same branch for three months running is flagged. At Summit it is missing customer verification on card applications. Each one can become a preventive action, or be sent to Pulsus Risk.",
    say: "Insights finds what keeps coming back: the same defect, at the same branch, three months running. At Summit, it's missing customer verification on card applications. Each one can become a preventive action, or be sent to Pulsus Risk.",
  },
  {
    id: "risk", path: "/risk", menu: true, target: ["card:League table", ".bandbar"],
    title: "Every branch, ranked by risk",
    text: "A score from 0 to 100 for each branch, from inspection scores, critical failures, sampling deviations, overdue actions, repeat findings, time since the last visit and factors you enter, such as staff turnover, with the reasons. The band sets how often to visit. Summit is at the top.",
    say: "Risk scores every branch from nought to a hundred: inspection scores, critical failures, sampling deviations, overdue actions, repeat findings, the time since the last visit, and factors you enter, such as staff turnover, with the reasons spelled out. The band sets how often to visit, and Summit is at the top.",
  },
  {
    id: "sampling", path: "/sampling", menu: true, target: ["section.card.flush"],
    title: "Test a sample, know the population",
    text: "For file reviews: the sample size from the population, your confidence and the tolerable deviation rate, a random selection anyone can re-run, and the result projected to every file. Summit's account-opening files fail the test; Harbour's pass.",
    say: "Sampling is for file reviews. It works out the sample size from the population, your confidence, and the tolerable deviation rate. It picks a random selection anyone can re-run, and projects the result to every file. Here, Summit's account-opening files fail the test, and Harbour's pass.",
  },
  {
    id: "compare", path: "/compare", menu: true, target: ["card:Benchmark", "card:By "],
    title: "Side by side, fairly",
    text: "Every branch rolled up to its subsidiary, region or group, side by side, and each one benchmarked against the median branch.",
    say: "Compare rolls every branch up to its subsidiary, region, or group, side by side, and benchmarks each one against the median branch.",
  },
  {
    id: "report", path: "/report", menu: true, target: [".card.no-print", ".grid.g4"],
    title: "Ready for the committee",
    text: "The executive report, ready to print or save as PDF, and the committee report as PDF or Excel: inspection results, the risk league table and watchlist, missed visits, sampling conclusions, the most-failed questions and the actions position.",
    say: "Report has the executive report, ready to print or save as a PDF. And the committee report, as PDF or Excel: inspection results, the risk league table and watchlist, missed visits, sampling conclusions, the most-failed questions, and where the actions stand.",
  },
  {
    id: "templates", path: "/templates", menu: true, target: [".tgrid"],
    title: "Your checklists, built in minutes",
    text: "Every inspection starts from a template: build your own with weights, critical items and logic, import one from Excel, or start from a library of 29 templates across five sectors. Each published version is locked.",
    say: "Every inspection starts from a template. Build your own, with weights, critical items, and logic. Import the one you already keep in Excel. Or start from a library of twenty-nine templates, across five sectors. Each published version is locked.",
  },
  {
    id: "roles", path: "/templates", target: ["@.topbar button.avatar"],
    title: "Try it as one of the team",
    text: "Choose a person from the menu at the top right. Inspectors carry out inspections and key reviews; supervisors approve them and verify actions; branch managers work their branch's actions. The quality admin supports the set-up. Nobody signs off their own work.",
    say: "You can try the demo as one of the team, from the menu at the top right. Inspectors carry out the inspections and key the reviews. Supervisors approve them, and verify the actions. Branch managers work the actions for their branch. The quality admin supports the set-up. And nobody signs off their own work.",
  },
  {
    id: "data", path: "/settings", menu: true, target: ["card:Data", ".sgroup"],
    title: "Where the data comes from",
    text: "Inspections and reviews are captured here. Past history and the scorecard come in from your Excel workbooks, and locations, people and actions in bulk from Excel or CSV, each previewed before it is imported. Other systems connect through the REST API.",
    say: "Where does the data come from? Inspections and reviews are captured right here. Past history and the scorecard come in from your Excel workbooks, and locations, people, and actions in bulk, from Excel or CSV, each one previewed before it's imported. Other systems connect through the REST API.",
  },
  {
    id: "end", path: "/", target: ["section.hero", "section.card[aria-label$='score']"],
    title: "Over to you",
    text: "Explore at your own pace: follow the Getting started steps, pick a branch or a year, or try a different person from the menu at the top right. Watch this tour again from ▶ Tour at the top.",
    say: "That's the tour. Explore at your own pace: follow the Getting started steps, pick a branch or a year, or try the demo as a different person. Thank you for watching.",
  },
];
