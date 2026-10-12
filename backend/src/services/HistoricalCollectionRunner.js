import { randomUUID } from 'node:crypto';
import HistoricalCollectionJob from '../models/HistoricalCollectionJob.js';
import {
  collectHistoricalTicks,
  SYMBOLS,
  TARGET_TICKS_PER_SYMBOL
} from './historicalTicks.js';

const JOB_ID = 'historical-collection';
const RETRY_DELAY_MS = 15000;
const LEASE_MS = 120000;
const HEARTBEAT_MS = 20000;
const WORKER_ID = randomUUID();

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function publicStatus(job) {
  if (!job) {
    return {
      running: false,
      startedAt: null,
      finishedAt: null,
      error: null,
      targetPerSymbol: TARGET_TICKS_PER_SYMBOL,
      symbols: SYMBOLS,
      currentSymbol: null,
      results: []
    };
  }

  return {
    running: Boolean(job.running),
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
    targetPerSymbol: job.targetPerSymbol || TARGET_TICKS_PER_SYMBOL,
    symbols: job.symbols?.length ? job.symbols : SYMBOLS,
    currentSymbol: job.currentSymbol || null,
    results: job.results || []
  };
}

export async function getHistoricalCollectionStatus() {
  const job = await HistoricalCollectionJob.findById(JOB_ID).lean();
  return publicStatus(job);
}

async function patchJob(update) {
  return HistoricalCollectionJob.findOneAndUpdate(
    { _id: JOB_ID },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

let workerActive = false;

async function runWorker() {
  if (workerActive) return;
  workerActive = true;
  let heartbeat = null;

  try {
    const now = new Date();
    const claimed = await HistoricalCollectionJob.findOneAndUpdate(
      {
        _id: JOB_ID,
        running: true,
        $or: [
          { workerId: null },
          { workerId: { $exists: false } },
          { leaseUntil: null },
          { leaseUntil: { $lt: now } },
          { workerId: WORKER_ID }
        ]
      },
      {
        $set: {
          workerId: WORKER_ID,
          leaseUntil: new Date(Date.now() + LEASE_MS)
        }
      },
      { new: true }
    ).lean();

    if (!claimed) {
      workerActive = false;
      const retryTimer = setTimeout(() => {
        runWorker().catch((error) => {
          console.error('[HISTORICAL RESUME] Lease retry failed:', error);
        });
      }, 30000);
      retryTimer.unref?.();
      return;
    }

    heartbeat = setInterval(() => {
      HistoricalCollectionJob.updateOne(
        { _id: JOB_ID, running: true, workerId: WORKER_ID },
        { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }
      ).catch((error) => {
        console.error('[HISTORICAL RESUME] Lease heartbeat failed:', error?.message || String(error));
      });
    }, HEARTBEAT_MS);

    let job = claimed;

    const symbols = Array.isArray(job.symbols) && job.symbols.length
      ? job.symbols.filter((symbol) => SYMBOLS.includes(symbol))
      : SYMBOLS;

    for (const symbol of symbols) {
      if (!job.running) break;

      await patchJob({ currentSymbol: symbol, error: null });
      let retry = 0;

      while (true) {
        job = await HistoricalCollectionJob.findById(JOB_ID).lean();
        if (!job?.running) break;

        try {
          const result = await collectHistoricalTicks(
            symbol,
            job.targetPerSymbol || TARGET_TICKS_PER_SYMBOL
          );

          const latest = await HistoricalCollectionJob.findById(JOB_ID).lean();
          const priorResults = (latest?.results || []).filter(
            (item) => item?.symbol !== symbol
          );

          await patchJob({
            results: [...priorResults, result],
            currentSymbol: null,
            error: null
          });

          console.log(
            `[HISTORICAL RESUME] ${symbol}: ${result.total}/${result.target}; complete=${result.complete}; exhausted=${result.exhausted}`
          );
          break;
        } catch (error) {
          retry += 1;
          const message = error?.message || String(error);

          await patchJob({
            currentSymbol: symbol,
            error: `${symbol}: ${message}; retry ${retry} in 15 seconds`
          });

          console.error(
            `[HISTORICAL RESUME] ${symbol} failed; retrying in 15 seconds:`,
            message
          );
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    job = await HistoricalCollectionJob.findById(JOB_ID).lean();
    if (job?.running) {
      await patchJob({
        running: false,
        currentSymbol: null,
        workerId: null,
        leaseUntil: null,
        finishedAt: new Date(),
        error: null
      });
      console.log('[HISTORICAL RESUME] Collection target processing finished.');
    }
  } catch (error) {
    const message = error?.message || String(error);
    console.error('[HISTORICAL RESUME] Worker error:', message);
    await patchJob({
      error: message,
      currentSymbol: null
    }).catch(() => {});
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    workerActive = false;
  }
}

export async function startPersistentHistoricalCollection(
  requestedSymbols = SYMBOLS
) {
  const symbols = [...new Set(requestedSymbols)].filter(
    (symbol) => SYMBOLS.includes(symbol)
  );

  if (!symbols.length) {
    throw new Error('No supported historical symbols were requested.');
  }

  const existing = await HistoricalCollectionJob.findById(JOB_ID).lean();
  if (existing?.running) {
    return {
      started: false,
      status: publicStatus(existing)
    };
  }

  const job = await patchJob({
    running: true,
    startedAt: new Date(),
    finishedAt: null,
    error: null,
    targetPerSymbol: TARGET_TICKS_PER_SYMBOL,
    symbols,
    currentSymbol: null,
    workerId: null,
    leaseUntil: null,
    results: []
  });

  setImmediate(() => {
    runWorker().catch((error) => {
      console.error('[HISTORICAL RESUME] Unhandled worker error:', error);
    });
  });

  return {
    started: true,
    status: publicStatus(job)
  };
}

/**
 * Call only after MongoDB connects. A running job survives a Render
 * restart because its intent and progress are persisted in MongoDB.
 * The collector resumes safely from each symbol's current tick count.
 */
export async function resumeHistoricalCollectionOnStartup() {
  const job = await HistoricalCollectionJob.findById(JOB_ID).lean();
  if (!job?.running) {
    console.log('[HISTORICAL RESUME] No unfinished collection job found.');
    return false;
  }

  console.log(
    '[HISTORICAL RESUME] Resuming persisted collection job after startup.'
  );
  setImmediate(() => {
    runWorker().catch((error) => {
      console.error('[HISTORICAL RESUME] Startup resume failed:', error);
    });
  });
  return true;
}
