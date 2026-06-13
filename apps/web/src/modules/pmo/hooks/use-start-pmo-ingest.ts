import { useMutation } from '@tanstack/react-query';
import { pmoApi } from '../api/client';

export interface StartPmoIngestInput {
  file: File;
  reportingPeriodKey?: string;
}

export interface StartPmoIngestResult {
  ingestionSessionId: string;
  fileKey: string;
  runId: string;
}

export function useStartPmoIngest() {
  return useMutation({
    mutationFn: async ({ file, reportingPeriodKey }: StartPmoIngestInput) => {
      const uploaded = await pmoApi.uploadWorkbook(file, reportingPeriodKey);
      const started = await pmoApi.startIngestWorkflow({
        ingestionSessionId: uploaded.ingestion_session_id,
        fileKey: uploaded.s3_key,
        reportingPeriodKey,
      });

      return {
        ingestionSessionId: uploaded.ingestion_session_id,
        fileKey: uploaded.s3_key,
        runId: started.runId,
      } satisfies StartPmoIngestResult;
    },
  });
}
