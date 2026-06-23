import type { RebalanceRecommendationGroup } from '../reporting/recommendations/contracts.ts';
import type { AnswerKeyCase, RecommendationScore } from './types.ts';

export function scoreRecommendations(
  evalCase: AnswerKeyCase,
  groups: RebalanceRecommendationGroup[],
): RecommendationScore | null {
  const expectedGroups = evalCase.expectedRecommendationGroups;
  if (expectedGroups.length === 0) return null;

  const sourceMemberId = expectedGroups[0]?.sourceMemberId;
  const expectedStatus = expectedGroups[0]?.expectedStatus ?? null;
  const expectedTopTargets = [
    ...new Set(expectedGroups.flatMap((group) => group.expectedTopTargets)),
  ];

  const sourceGroups = groups.filter((group) => group.sourceMemberId === sourceMemberId);
  const primaryGroup = sourceGroups[0];
  const actualStatus = primaryGroup?.status ?? 'no_valid_rebalance_found';
  const actualTopTargets = primaryGroup?.recommendations.map((row) => row.targetMemberId) ?? [];

  const statusMatch = actualStatus === expectedStatus;
  const topTargetHit =
    expectedTopTargets.length === 0
      ? actualTopTargets.length === 0
      : expectedTopTargets.some((target) => actualTopTargets[0] === target);

  return {
    caseHasRecommendations: true,
    statusMatch,
    topTargetHit,
    expectedStatus,
    actualStatus,
    expectedTopTargets,
    actualTopTargets: actualTopTargets.slice(0, 3),
  };
}

export function recommendationHitRate(scores: RecommendationScore[]): number {
  const withExpectations = scores.filter((score) => score.caseHasRecommendations);
  if (withExpectations.length === 0) return 1;
  const hits = withExpectations.filter((score) => score.statusMatch && score.topTargetHit);
  return hits.length / withExpectations.length;
}
