/**
 * Bounds regex find. A pathological pattern spends minutes inside ONE `RegExp.exec`, which
 * no main-thread budget can interrupt, so the only bound is a killable thread. The worker
 * ships as source text through a Blob URL, not a bundler worker import, leaving dist
 * packaging and consumer bundlers untouched. Where that is unavailable (SSR, a CSP-restricted
 * embedder, the test runner) it degrades to a sync scan bounded only BETWEEN texts.
 */

import { execAll, type RawRange } from './matcher';

/** Wall-clock ceiling for one scan: long enough for an honest regex over a large document,
 *  short enough that overrun reads as a stall rather than a freeze. */
export const REGEX_SCAN_DEADLINE_MS = 2000;

export interface RegexScanRequest {
	readonly texts: readonly string[];
	readonly pattern: string;
	readonly flags: string;
	/** Correlation token, echoed back untouched, so the caller can drop a stale outcome. */
	readonly epoch: number;
}

/** `cancelled` covers supersession and release alike — nothing to report either way. */
export type RegexScanFailure = 'timeout' | 'error' | 'cancelled';

export type RegexScanOutcome =
	| { ok: true; epoch: number; ranges: RawRange[][] }
	| { ok: false; epoch: number; reason: RegexScanFailure };

export interface RegexExecutor {
	/** Never rejects; every failure arrives as an `ok: false` outcome. Single-flight: a new
	 *  scan supersedes the one in flight rather than queueing behind a never-returning exec. */
	scan(request: RegexScanRequest): Promise<RegexScanOutcome>;
	/** Terminates the live worker; the next scan respawns one. */
	release(): void;
}

export interface RegexExecutorOptions {
	deadlineMs?: number;
}

// ── Worker ───────────────────────────────────────────────────────────────────

// Self-contained by necessity: a Blob worker has no module graph, so this repeats
// `execAll`'s loop. `regex-executor-parity.test.ts` fails the day they diverge.
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
		// The worker is inside an exec that cannot be asked to stop; termination is the
		// only way to free the thread for the next scan.
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
			// A CSP without `worker-src blob:` throws here. Latch, or every later scan pays
			// the same construction cost to fail the same way.
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
			// An uncompilable pattern is caught inside the worker and posted back, so reaching
			// here means the worker itself is broken (a CSP blocking the blob at load, not at
			// construction). Latch, or regex search stays dead instead of degrading to sync.
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
			// Between texts is the only place this path can bail, and checking before any
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
