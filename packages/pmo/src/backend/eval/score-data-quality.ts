import type { CleaningSummary } from '../../../scripts/lib/mock-cleaning-outcomes.ts';
import type { RebalanceRecommendationGroup } from '../reporting/recommendations/contracts.ts';
import type { AnswerKeyDataQuality, DataQualityScore } from './types.ts';

function deriveDataQualityFlags(input: {
  cleaning: CleaningSummary;
  recommendationGroups: RebalanceRecommendationGroup[];
}): string[] {
  const flags: string[] = [];
  if (input.cleaning.resourceAllocation.duplicatesRemoved > 0) {
    flags.push('duplicate_resource_allocation');
  }
  if (input.cleaning.timesheet.rawRows > input.cleaning.timesheet.cleanRows) {
    flags.push('duplicate_timesheet_log');
  }

  const recommendationFlags = input.recommendationGroups.flatMap((group) => group.dataQualityFlags);
  if (
    recommendationFlags.includes('insufficient_capacity') ||
    recommendationFlags.includes('insufficient_transferable_hours') ||
    input.recommendationGroups.some((group) => group.status === 'no_valid_rebalance_found')
  ) {
    flags.push('insufficient_capacity_or_transferable_hours');
  }

  return [...new Set(flags)].sort();
}

export function scoreDataQuality(
  expected: AnswerKeyDataQuality,
  actualFlags: string[],
): DataQualityScore {
  const required = [...expected.requiredFlags].sort();
  const actual = [...actualFlags].sort();
  const requiredFlagsMatched = required.filter((flag) => actual.includes(flag));
  const requiredFlagsMissing = required.filter((flag) => !actual.includes(flag));
  const unexpectedFlags = actual.filter((flag) => !required.includes(flag));

  const duplicateDegraded = actual.some((flag) => flag.startsWith('duplicate_'));
  const degradedMatch = expected.degraded === duplicateDegraded;

  return {
    degradedMatch,
    requiredFlagsMatched,
    requiredFlagsMissing,
    unexpectedFlags,
  };
}

export function buildActualDataQualityFlags(input: {
  cleaning: CleaningSummary;
  recommendationGroups: RebalanceRecommendationGroup[];
}): string[] {
  return deriveDataQualityFlags(input);
}
