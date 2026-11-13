// Sampling plans and their conclusions (the method, seed and population hash, so a selection can be re-checked).
import { listPlans } from "@/lib/samplingPlans";
import { apiJson, withKey } from "@/lib/restApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withKey(req, "sampling:read", async (k) => apiJson({ data: (await listPlans(k.actor)).map((p) => ({
    id: p.id, ref: p.ref, name: p.name, site_id: p.unitId, template_id: p.templateId, period: p.period, method: p.method, confidence: p.confidence, tolerable_rate: p.tdr, expected_rate: p.edr,
    population: p.populationSize, population_sha256: p.populationHash, sample_size: p.sampleSize, seed: p.seed, method_text: p.method_text, status: p.status, inspection_id: p.inspectionId,
    evaluation: p.evaluation ? { deviations: p.evaluation.deviations, rate: p.evaluation.rate, upper_limit: p.evaluation.upper, effective: p.evaluation.effective, conclusion: p.evaluation.conclusion } : null,
  })) }));
}
