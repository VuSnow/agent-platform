import type { CleaningSummary } from '../../../scripts/lib/mock-cleaning-outcomes.ts';
import type { MemberAnalysis } from '../analytics/findings.ts';
import type { MemberWeekFact, WeekRow } from '../analytics/types.ts';
import type { AnswerKeyFinding } from './types.ts';

const CORE_ISSUE_TYPES = new Set(['overbook', 'idle', 'mismatch_under', 'mismatch_over']);

function findingKey(finding: AnswerKeyFinding): string {
  return `${finding.memberId}|${finding.issueType}|${finding.weekId ?? ''}`;
}

function expectedUsesType(expected: AnswerKeyFinding[], issueType: string): boolean {
  return expected.some((finding) => finding.issueType === issueType);
}

export function deriveActualFindings(input: {
  expected: AnswerKeyFinding[];
  reportFindings: Array<{ memberId: string; issueType: string }>;
  analyses: MemberAnalysis[];
  memberFacts: MemberWeekFact[];
  weeks: WeekRow[];
  cleaning: CleaningSummary;
}): AnswerKeyFinding[] {
  const actual: AnswerKeyFinding[] = [];

  for (const finding of input.reportFindings) {
    if (CORE_ISSUE_TYPES.has(finding.issueType)) {
      actual.push({
        memberId: finding.memberId,
        issueType: finding.issueType,
        severity: 'Medium',
      });
    }
  }

  if (expectedUsesType(input.expected, 'idle_candidate')) {
    for (const finding of input.reportFindings) {
      if (finding.issueType === 'idle') {
        actual.push({
          memberId: finding.memberId,
          issueType: 'idle_candidate',
          severity: 'Info',
        });
      }
    }
  }

  if (expectedUsesType(input.expected, 'edge_exclude')) {
    for (const analysis of input.analyses) {
      for (const excluded of analysis.excludedWeeks) {
        if (excluded.reason === 'approved_leave' || excluded.reason === 'approved_ot') {
          const expectedForMember = input.expected.some(
            (finding) =>
              finding.issueType === 'edge_exclude' &&
              finding.memberId === analysis.memberId &&
              (finding.weekId ? finding.weekId === excluded.weekId : true),
          );
          if (expectedForMember) {
            actual.push({
              memberId: analysis.memberId,
              issueType: 'edge_exclude',
              severity: 'Info',
              weekId: excluded.weekId,
            });
          }
        }
      }
    }
  }

  if (expectedUsesType(input.expected, 'edge_holiday')) {
    for (const expected of input.expected.filter(
      (finding) => finding.issueType === 'edge_holiday',
    )) {
      const weekId = expected.weekId ?? expected.memberId;
      const week = input.weeks.find((row) => row.week_id === weekId);
      if (week && (week.holiday_hours_ft ?? 0) > 0) {
        actual.push({
          memberId: expected.memberId,
          issueType: 'edge_holiday',
          severity: 'Info',
          weekId,
        });
      }
    }
  }

  if (expectedUsesType(input.expected, 'edge_onboard_missing')) {
    for (const expected of input.expected.filter(
      (finding) => finding.issueType === 'edge_onboard_missing',
    )) {
      const hasPreHire = input.memberFacts.some(
        (fact) =>
          fact.memberId === expected.memberId &&
          fact.weekId === expected.weekId &&
          fact.scopeStatus === 'PRE_HIRE',
      );
      if (hasPreHire) {
        actual.push({
          memberId: expected.memberId,
          issueType: 'edge_onboard_missing',
          severity: 'Info',
          weekId: expected.weekId,
        });
      }
    }
  }

  if (expectedUsesType(input.expected, 'data_duplicate')) {
    for (const expected of input.expected.filter(
      (finding) => finding.issueType === 'data_duplicate',
    )) {
      const hasDuplicate = input.cleaning.raDuplicates.some(
        (row) => row.memberId === expected.memberId,
      );
      if (hasDuplicate) {
        actual.push({
          memberId: expected.memberId,
          issueType: 'data_duplicate',
          severity: 'High',
        });
      }
    }
  }

  if (expectedUsesType(input.expected, 'guardrail_parttime')) {
    for (const expected of input.expected.filter(
      (finding) => finding.issueType === 'guardrail_parttime',
    )) {
      const memberFacts = input.memberFacts.filter((fact) => fact.memberId === expected.memberId);
      const stdHours = memberFacts[0]?.availableHours ?? 40;
      const hasFalseIdle = input.reportFindings.some(
        (finding) => finding.memberId === expected.memberId && finding.issueType === 'idle',
      );
      if (stdHours < 40 && !hasFalseIdle) {
        actual.push({
          memberId: expected.memberId,
          issueType: 'guardrail_parttime',
          severity: 'Info',
        });
      }
    }
  }

  return actual;
}

export function scoreFindings(
  expected: AnswerKeyFinding[],
  actual: AnswerKeyFinding[],
): {
  precision: number;
  recall: number;
  f1: number;
  matched: AnswerKeyFinding[];
  missed: AnswerKeyFinding[];
  unexpected: AnswerKeyFinding[];
} {
  const expectedKeys = new Set(expected.map(findingKey));
  const actualKeys = new Set(actual.map(findingKey));

  const matched = expected.filter((finding) => actualKeys.has(findingKey(finding)));
  const missed = expected.filter((finding) => !actualKeys.has(findingKey(finding)));
  const unexpected = actual.filter((finding) => !expectedKeys.has(findingKey(finding)));

  const precision =
    actual.length === 0 ? (expected.length === 0 ? 1 : 0) : matched.length / actual.length;
  const recall = expected.length === 0 ? 1 : matched.length / expected.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1, matched, missed, unexpected };
}

export function findingsFromReport(
  findings: Array<{ memberId: string; issueType: string; ragColor?: string }>,
): AnswerKeyFinding[] {
  return findings.map((finding) => ({
    memberId: finding.memberId,
    issueType: finding.issueType,
    severity:
      finding.ragColor === 'red' ? 'High' : finding.ragColor === 'yellow' ? 'Medium' : 'Info',
  }));
}

export { findingKey };
