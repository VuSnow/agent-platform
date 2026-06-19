import { defineAgentTool, RC_THREAD_ID } from '@seta/agent-sdk';
import { z } from 'zod';
import { prepareChatIngestSession } from '../ingestion/prepare-chat-ingest-session.ts';
import { tenantIdFromContext } from './context.ts';

const inputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  generateReport: z.boolean().optional(),
});

const outputSchema = z.object({
  runId: z.string().nullable(),
  ingestionSessionId: z.string().uuid(),
  message: z.string(),
});

export function makePmoStartIngestTool() {
  return defineAgentTool({
    id: 'pmo_startIngest',
    name: 'Prepare PMO Ingest Plan',
    description: [
      'Prepare the PMO workbook ingest plan for an uploaded workbook session.',
      'Call only when the CURRENT turn context includes <<<PMO_INGEST_SESSION>>> with',
      'ingestionSessionId (workbook uploaded in this chat thread). The tool stops at',
      'Plan Review so the user can approve the plan in the PMO UI. Pass dateFrom/dateTo',
      '(YYYY-MM-DD) when the user names a report date range. Set generateReport true when',
      'the user wants idle/overbook reports after publish.',
    ].join('\n'),
    input: inputSchema,
    output: outputSchema,
    rbac: 'pmo.ingestion.upload',
    execute: async (input, ctx) => {
      const tenantId = tenantIdFromContext(ctx);
      const actor = ctx.requestContext?.get('actor') as { user_id?: string } | undefined;
      const userId = actor?.user_id;
      if (!userId) throw new Error('missing_actor_context');

      const threadId = ctx.requestContext?.get(RC_THREAD_ID) as string | undefined;
      if (!threadId) throw new Error('missing_chat_thread_context');

      const prepared = await prepareChatIngestSession({
        ingestionSessionId: input.ingestionSessionId,
        tenantId,
        chatThreadId: threadId,
        generateReport: input.generateReport ?? true,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      });
      void prepared;

      return {
        runId: null,
        ingestionSessionId: input.ingestionSessionId,
        message:
          'Plan Review is ready. Open the PMO workflow UI to approve the plan and start ingest.',
      };
    },
  });
}
