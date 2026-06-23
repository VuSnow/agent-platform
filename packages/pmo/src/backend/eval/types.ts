import type { SchemaDetectionResult } from '../ingestion/detect-schema.ts';
import type { NormalizedRow } from '../ingestion/normalize-rows.ts';
import type { RebalanceRecommendationGroup } from '../reporting/recommendations/contracts.ts';
import type { GeneratePmoReportOutput } from '../reporting/report-output.ts';

export interface AnswerKeyFinding {
  memberId: string;
  issueType: string;
  severity: string;
  weekId?: string;
}

export interface AnswerKeyRecommendationGroup {
  sourceMemberId: string;
  weekId: string;
  expectedStatus: string;
  expectedTopTargets: string[];
}

export interface AnswerKeyDataQuality {
  degraded: boolean;
  requiredFlags: string[];
}

export interface AnswerKeyCase {
  caseId: string;
  workbook: string;
  description: string;
  dateRange: { from: string; to: string };
  expectedFindings: AnswerKeyFinding[];
  expectedRecommendationGroups: AnswerKeyRecommendationGroup[];
  expectedDataQuality: AnswerKeyDataQuality;
  evalPrompts: string[];
  notes: string[];
}

export type EvalStageId =
  | 'parse_workbook'
  | 'detect_schema'
  | 'normalize_rows'
  | 'stage_changes'
  | 'publish'
  | 'compute_facts'
  | 'generate_report'
  | 'generate_recommendations';

export interface EvalStageTiming {
  stage: EvalStageId;
  durationMs: number;
  detail?: string;
}

export interface FindingScore {
  precision: number;
  recall: number;
  f1: number;
  matched: AnswerKeyFinding[];
  missed: AnswerKeyFinding[];
  unexpected: AnswerKeyFinding[];
}

export interface RecommendationScore {
  caseHasRecommendations: boolean;
  statusMatch: boolean;
  topTargetHit: boolean;
  expectedStatus: string | null;
  actualStatus: string | null;
  expectedTopTargets: string[];
  actualTopTargets: string[];
}

export interface DataQualityScore {
  degradedMatch: boolean;
  requiredFlagsMatched: string[];
  requiredFlagsMissing: string[];
  unexpectedFlags: string[];
}

export interface SchemaScore {
  pass: boolean;
  workbookConfidence: number;
  unmappedRequiredCount: number;
  validationStatus: string;
}

export interface NormalizeScore {
  pass: boolean;
  errorCount: number;
  duplicateInUploadCount: number;
}

export interface EvalCaseResult {
  caseId: string;
  workbook: string;
  timings: EvalStageTiming[];
  totalDurationMs: number;
  schema: SchemaScore;
  normalize: NormalizeScore;
  findings: FindingScore;
  recommendations: RecommendationScore | null;
  dataQuality: DataQualityScore;
  report?: Pick<GeneratePmoReportOutput, 'summary' | 'findings' | 'recommendations'>;
}

export interface EvalPackSummary {
  runAt: string;
  caseCount: number;
  schemaPassRate: number;
  findingsPrecision: number;
  findingsRecall: number;
  findingsF1: number;
  recommendationHitRate: number;
  stageLatency: Record<
    EvalStageId,
    {
      p50Ms: number;
      p95Ms: number;
      maxMs: number;
    }
  >;
  totalPipelineP50Ms: number;
  totalPipelineP95Ms: number;
  cases: EvalCaseResult[];
}

export interface DeterministicPipelineInput {
  case: AnswerKeyCase;
  workbookBuffer: Buffer;
  tenantId: string;
  ingestionSessionId: string;
}

export interface DeterministicPipelineOutput {
  schema: SchemaDetectionResult;
  normalizedTables: Record<string, NormalizedRow[]>;
  normalizeErrorCount: number;
  duplicateInUploadCount: number;
  report: GeneratePmoReportOutput;
  recommendations: RebalanceRecommendationGroup[];
  timings: EvalStageTiming[];
}
