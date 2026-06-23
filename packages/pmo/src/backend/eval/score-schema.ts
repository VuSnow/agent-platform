import type { SchemaDetectionResult } from '../ingestion/detect-schema.ts';
import type { SchemaScore } from './types.ts';

export function scoreSchema(detected: SchemaDetectionResult): SchemaScore {
  const unmappedRequiredCount = detected.tables.reduce(
    (sum, table) => sum + table.unmappedRequired.length,
    0,
  );
  return {
    pass: unmappedRequiredCount === 0 && detected.validation.workbookConfidence >= 0.9,
    workbookConfidence: detected.validation.workbookConfidence,
    unmappedRequiredCount,
    validationStatus: detected.validation.status,
  };
}
