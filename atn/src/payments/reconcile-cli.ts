import { readFileSync } from 'node:fs';
import {
  reconcilePayments,
  type ReconciliationPayment,
} from './reconcile.js';

const USAGE =
  'Usage: npm run reconcile -- --local <path> --remote <path> [--since <date>] [--json]';

interface CliOptions {
  localPath?: string;
  remotePath?: string;
  since?: string;
  json: boolean;
}

function usageError(message: string): never {
  throw new Error(`${message}\n${USAGE}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { json: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      if (options.json) usageError('Duplicate argument: --json');
      options.json = true;
      continue;
    }

    if (
      argument === '--local' ||
      argument === '--remote' ||
      argument === '--since'
    ) {
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        usageError(`Missing value for ${argument}`);
      }
      index += 1;

      if (argument === '--local') {
        if (options.localPath !== undefined) usageError('Duplicate argument: --local');
        options.localPath = value;
      } else if (argument === '--remote') {
        if (options.remotePath !== undefined) usageError('Duplicate argument: --remote');
        options.remotePath = value;
      } else {
        if (options.since !== undefined) usageError('Duplicate argument: --since');
        options.since = value;
      }
      continue;
    }

    usageError(`Unknown argument: ${argument}`);
  }

  if (options.localPath === undefined) usageError('Missing required argument: --local <path>');
  if (options.remotePath === undefined) usageError('Missing required argument: --remote <path>');
  return options;
}

function readPayments(path: string, source: string): ReconciliationPayment[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${source} JSON file "${path}": ${detail}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${source} file "${path}": ${detail}`);
  }

  if (!Array.isArray(parsed)) {
    throw new TypeError(`${source} input must be a JSON array of reconciliation payments`);
  }

  const payments: ReconciliationPayment[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item: unknown = parsed[index];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new TypeError(`${source} payment at index ${index} must be an object`);
    }

    const payment = item as Record<string, unknown>;
    if (
      typeof payment.reference !== 'string' ||
      typeof payment.amountMicros !== 'number' ||
      typeof payment.currency !== 'string' ||
      typeof payment.status !== 'string'
    ) {
      throw new TypeError(
        `${source} payment at index ${index} must have reference:string, amountMicros:number, currency:string, status:string`,
      );
    }

    payments.push({
      reference: payment.reference,
      amountMicros: payment.amountMicros,
      currency: payment.currency,
      status: payment.status,
    });
  }

  return payments;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.since !== undefined) {
    throw new Error(
      '--since is unsupported: ReconciliationPayment has no date-derived field, so entries cannot be date-filtered.',
    );
  }

  const localPayments = readPayments(options.localPath as string, 'Local');
  const remotePayments = readPayments(options.remotePath as string, 'Remote');
  const report = await reconcilePayments(localPayments, async () => remotePayments);

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    const counts = {
      matched: report.matched.length,
      local_only: report.local_only.length,
      remote_only: report.remote_only.length,
      amount_mismatch: report.amount_mismatch.length,
      status_mismatch: report.status_mismatch.length,
    };
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    process.stdout.write(
      `matched: ${counts.matched}\n` +
        `local_only: ${counts.local_only}\n` +
        `remote_only: ${counts.remote_only}\n` +
        `amount_mismatch: ${counts.amount_mismatch}\n` +
        `status_mismatch: ${counts.status_mismatch}\n` +
        `total: ${total}\n`,
    );
  }

  const discrepancies =
    report.local_only.length +
    report.remote_only.length +
    report.amount_mismatch.length +
    report.status_mismatch.length;
  process.exitCode = discrepancies > 0 ? 1 : 0;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
