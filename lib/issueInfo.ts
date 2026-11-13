// Reported issues: the categories, statuses and shapes the browser and server share. Pure.
export const CATEGORIES = ["observation", "hazard", "near_miss", "complaint", "other"] as const;
export type IssueCategory = (typeof CATEGORIES)[number];
export const CATEGORY_INFO: Record<IssueCategory, { label: string; hint: string }> = {
  observation: { label: "Something isn't right", hint: "A standard not being met, a process skipped" },
  hazard: { label: "A hazard", hint: "Something that could hurt someone or damage something" },
  near_miss: { label: "A near miss", hint: "Something nearly went wrong" },
  complaint: { label: "A complaint", hint: "About the service or how you were treated" },
  other: { label: "Something else", hint: "Anything you think the team should know" },
};
export const STATUS_INFO: Record<string, string> = { new: "New", action: "Action raised", inspection: "Inspection scheduled", dismissed: "Closed, no action" };

export interface LinkView { unitId: string; unitName: string; region: string | null; token: string; path: string; url: string; active: boolean; createdAt: string; reports: number }

export interface IssueView {
  id: string; ref: string; unitId: string; unitName: string; category: IssueCategory; description: string; location: string; reporterName: string; reporterContact: string;
  status: string; triageNote: string; triagedBy: string | null; triagedAt: string | null; actionId: string | null; inspectionId: string | null; source: string; createdAt: string;
  photos: { id: string; contentType: string }[];
}
