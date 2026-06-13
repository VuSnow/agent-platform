interface ApiErrorBody {
  error?: string;
  message?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}) as ApiErrorBody)) as ApiErrorBody;
    throw Object.assign(new Error(body.message ?? res.statusText), {
      status: res.status,
      code: body.error,
    });
  }
  return (await res.json()) as T;
}

export interface UploadWorkbookResponse {
  ingestion_session_id: string;
  s3_key: string;
  status: string;
  filename?: string;
  message?: string;
}

export interface StartIngestWorkflowInput {
  ingestionSessionId: string;
  fileKey: string;
  reportingPeriodKey?: string;
}

export interface StartIngestWorkflowResponse {
  runId: string;
}

export const pmoApi = {
  async uploadWorkbook(file: File, reportingPeriodKey?: string): Promise<UploadWorkbookResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (reportingPeriodKey) {
      formData.append('reporting_period_key', reportingPeriodKey);
    }

    const res = await fetch('/api/pmo/v1/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    return jsonOrThrow<UploadWorkbookResponse>(res);
  },

  async startIngestWorkflow(input: StartIngestWorkflowInput): Promise<StartIngestWorkflowResponse> {
    const res = await fetch('/api/agent/v1/workflows/runs/pmo.ingestData/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });
    return jsonOrThrow<StartIngestWorkflowResponse>(res);
  },
};
