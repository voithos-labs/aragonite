/**
 * Bounds regex find. A pathological pattern (`(a+)+$` over ~30 characters) spends
 * minutes inside ONE `RegExp.exec` call, and no main-thread budget can interrupt
 * a single exec — the only bound is a thread that can be killed. So regex scans
 * run in a worker with a hard deadline; literal search never comes here and stays
 * synchronous.
 *
 * The worker ships as source text through a Blob URL rather than a bundler worker
 * import, so dist packaging and consumer bundlers are untouched. Where that is
 * unavailable (SSR, a CSP-restricted embedder, the unit-test runner) the same
 * interface falls back to a synchronous scan whose deadline can only be checked
 * BETWEEN texts — one pathological exec is unbounded there, which is precisely the
 * gap the worker exists to close.
 */

import { execAll, type RawRange } from './matcher';

/** Wall-clock ceiling for one scan. Long enough that an honest regex over a large
 *  document finishes, short enough that overrun reads as a stall, not a freeze. */
export const REGEX_SCAN_DEADLINE_MS = 2000;

export interface RegexScanRequest {
	readonly texts: readonly string[];
	readonly pattern: string;
	readonly flags: string;
	/** Correlation token, echoed back untouched. The caller compares it against its
	 *  own current epoch and drops anything stale. */
	readonly epoch: number;
}

/** `cancelled` covers both supersession and release: the caller asked for something
 *  else, so there is nothing to report. */
export type RegexScanFailure = 'timeout' | 'error' | 'cancelled';

export type RegexScanOutcome =
	| { ok: true; epoch: number; ranges: RawRange[][] }
	| { ok: false; epoch: number; reason: RegexScanFailure };

export interface RegexExecutor {
	/** Never rejects — every failure arrives as an `ok: false` outcome, so no caller
	 *  can leak an unhandled rejection. Single-flight: a new scan supersedes the one
	 *  in flight rather than queueing behind an exec that may never return. */
	scan(request: RegexScanRequest): Promise<RegexScanOutcome>;
	/** Terminates the live worker. The next scan respawns one, so a closed find bar
	 *  costs nothing without costing the seam. */
	release(): void;
}

export interface RegexExecutorOptions {
	deadlineMs?: number;
}

// ── Worker ───────────────────────────────────────────────────────────────────

// Self-contained by necessity: a Blob worker has no module graph, so this repeats
// `execAll`'s loop. `regex-executor-parity.test.ts` runs both over the same inputs
// and fails the day they diverge.
const WORKER_SOURCE = `
self.onmessage = (event) => {
	const { texts, pattern, flags, epoch } = event.data;
	let re;
	try {
		re = new RegExp(pattern, flags);
	} catch {
		self.postMessage({ epoch, ok: false });
		return;
	}
	const ranges = [];
	for (const text of texts) {
		const found = [];
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(text)) !== null) {
			found.push({ start: m.index, end: m.index + m[0].length, groups: [...m] });
			if (m.index === re.lastIndex) re.lastIndex++;
		}
		ranges.push(found);
	}
	self.postMessage({ epoch, ok: true, ranges });
};
`;

/** Exported for the parity test; the executor is the only runtime reader. */
export const regexScanWorkerSource = WORKER_SOURCE;

interface WorkerReply {
	epoch: number;
	ok: boolean;
	ranges?: RawRange[][];
}

// ── Executor ─────────────────────────────────────────────────────────────────

export function createRegexExecutor(options: RegexExecutorOptions = {}): RegexExecutor {
	const deadlineMs = options.deadlineMs ?? REGEX_SCAN_DEADLINE_MS;

	let worker: Worker | null = null;
	let workerUnavailable = false;
	let pending: { epoch: number; resolve: (outcome: RegexScanOutcome) => void } | null = null;
	let deadline: ReturnType<typeof setTimeout> | null = null;

	function clearDeadline(): void {
		if (deadline === null) return;
		clearTimeout(deadline);
		deadline = null;
	}

	function killWorker(): void {
		clearDeadline();
		worker?.terminate();
		worker = null;
	}

	function settle(outcome: RegexScanOutcome): void {
		const settled = pending;
		pending = null;
		clearDeadline();
		settled?.resolve(outcome);
	}

	function abandonPending(): void {
		if (!pending) return;
		const { epoch } = pending;
		// The worker is inside an exec that cannot be asked to stop; termination is
		// the only way to free the thread for the next scan.
		killWorker();
		settle({ ok: false, epoch, reason: 'cancelled' });
	}

	function ensureWorker(): Worker | null {
		if (worker) return worker;
		if (workerUnavailable) return null;
		if (
			typeof Worker === 'undefined' ||
			typeof Blob === 'undefined' ||
			typeof URL === 'undefined' ||
			typeof URL.createObjectURL !== 'function'
		) {
			workerUnavailable = true;
			return null;
		}
		try {
			const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
			worker = new Worker(url);
			URL.revokeObjectURL(url); // the worker holds its own reference past revocation
			return worker;
		} catch {
			// A CSP without `worker-src blob:` throws here. Stop retrying: every later
			// scan would pay the same construction cost to fail the same way.
			workerUnavailable = true;
			return null;
		}
	}

	function runOnWorker(request: RegexScanRequest, target: Worker): Promise<RegexScanOutcome> {
		return new Promise((resolve) => {
			pending = { epoch: request.epoch, resolve };

			target.onmessage = (event: MessageEvent<WorkerReply>) => {
				const reply = event.data;
				if (!pending || reply.epoch !== pending.epoch) return; // a killed worker's late reply
				settle(
					reply.ok && reply.ranges
						? { ok: true, epoch: reply.epoch, ranges: reply.ranges }
						: { ok: false, epoch: reply.epoch, reason: 'error' }
				);
			};
			// A worker error and a deadline overrun are the same event to the caller:
			// the scan failed and the thread is not trustworthy, so it goes. A pattern
			// that will not compile is caught inside the worker and posted back, so
			// reaching here means the worker itself is broken — a CSP that blocks the
			// blob at load rather than at construction lands here rather than in the
			// catch below. Latch, or every later scan respawns to fail identically and
			// regex search stays dead instead of degrading to the synchronous path.
			const fail = () => {
				const epoch = pending?.epoch ?? request.epoch;
				workerUnavailable = true;
				killWorker();
				settle({ ok: false, epoch, reason: 'error' });
			};
			target.onerror = fail;
			target.onmessageerror = fail;

			deadline = setTimeout(() => {
				const epoch = pending?.epoch ?? request.epoch;
				killWorker();
				settle({ ok: false, epoch, reason: 'timeout' });
			}, deadlineMs);

			target.postMessage({
				texts: request.texts,
				pattern: request.pattern,
				flags: request.flags,
				epoch: request.epoch
			});
		});
	}

	function scanSync(request: RegexScanRequest): RegexScanOutcome {
		let re: RegExp;
		try {
			re = new RegExp(request.pattern, request.flags);
		} catch {
			return { ok: false, epoch: request.epoch, reason: 'error' };
		}
		const startedAt = Date.now();
		const ranges: RawRange[][] = [];
		for (let i = 0; i < request.texts.length; i++) {
			// Between texts is the only place this path can bail. Checking before any
			// work would be vacuous, so the first text always runs.
			if (i > 0 && Date.now() - startedAt > deadlineMs) {
				return { ok: false, epoch: request.epoch, reason: 'timeout' };
			}
			ranges.push(execAll(re, request.texts[i]));
		}
		return { ok: true, epoch: request.epoch, ranges };
	}

	return {
		scan(request) {
			abandonPending();
			const target = ensureWorker();
			if (!target) return Promise.resolve(scanSync(request));
			return runOnWorker(request, target);
		},
		release() {
			abandonPending();
			killWorker();
		}
	};
}
