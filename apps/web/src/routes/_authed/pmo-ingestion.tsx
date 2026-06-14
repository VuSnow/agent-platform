import { createFileRoute } from '@tanstack/react-router';
import { PmoIngestionAgenticPage } from '@/modules/pmo/pages/pmo-ingestion-agentic-page';

export const Route = createFileRoute('/_authed/pmo-ingestion')({
  component: PmoIngestionAgenticPage,
});
