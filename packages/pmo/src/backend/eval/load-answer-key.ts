import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnswerKeyCase } from './types.ts';

const EVAL_DIR = 'hackathon/data/test';

export function resolveEvalAssetRoot(): string {
  if (process.env.PMO_SEED_ASSET_ROOT) return process.env.PMO_SEED_ASSET_ROOT;
  const here = fileURLToPath(new URL('.', import.meta.url));
  return resolve(here, '../../../../..');
}

export function resolveEvalWorkbookPath(
  workbook: string,
  assetRoot = resolveEvalAssetRoot(),
): string {
  return resolve(assetRoot, EVAL_DIR, workbook);
}

export function loadAnswerKeyCases(assetRoot = resolveEvalAssetRoot()): AnswerKeyCase[] {
  const filePath = resolve(assetRoot, EVAL_DIR, 'answer_key.json');
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as AnswerKeyCase[];
}

export function loadEvalWorkbookBuffer(
  workbook: string,
  assetRoot = resolveEvalAssetRoot(),
): Buffer {
  return readFileSync(resolveEvalWorkbookPath(workbook, assetRoot));
}
