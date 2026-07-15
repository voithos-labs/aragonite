/**
 * Interaction trace — a ring buffer of the inline layer's state transitions.
 *
 * The inline layer rebuilds a block's spans on every keystroke, so cursor
 * capture/restore, reveal open/fold, widget-pool churn, IME composition, and
 * island application are all transient: by the time a field report is read, the
 * state that produced it is gone. This buffer records those transitions as they
 * happen, joining the ops log in the debug panel and the consumer diagnostics
 * door (`getDiagnostics()`).
 *
 * Two shapes fused: the bounded FIFO of `debug/operations-log.ts` and the
 * module-level record gate of `perf/instruments.ts` — but WITHOUT the perf
 * strip's dev/Vitest env fence. `enableInteractionTrace()` arms from anywhere,
 * production included, so a real consumer app can attach the trace to a bug
 * report. Disabled cost is one boolean check per recorder call; the perf gate is
 * the proof.
 *
 * Entries carry cheap primitives only — offsets, lengths, reasons, counts —
 * NEVER node references or raw document text. A trace attached to a bug report
 * must not smuggle the document.
 *
 * v1 LIMITATION: the buffer is module-global, so two editors on one page
 * interleave their entries. Same class as the reveal mount-waiter's per-scope
 * keying (ledgered); revisited at the freeze cut.
 */

export interface InteractionTraceEntry {
	/** `performance.now()` at record time — monotonic, no wall clock. */
	t: number;
	/** Subsystem the transition belongs to (`text-render`, `reveal`, `composition`…). */
	site: string;
	/** The transition within the site (`rebuild`, `open`, `fold`…). */
	kind: string;
	detail?: Record<string, string | number | boolean>;
}

const CAPACITY = 200;

let enabled = false;
let buf: InteractionTraceEntry[] = [];
const listeners = new Set<(entry: InteractionTraceEntry) => void>();

// ── Switch and readout ──────────────────────────────────────────────────────

export function enableInteractionTrace(): void {
	enabled = true;
}

export function disableInteractionTrace(): void {
	enabled = false;
}

export function isInteractionTraceEnabled(): boolean {
	return enabled;
}

/** Empty the buffer without touching the enabled flag — test isolation + the door. */
export function resetInteractionTrace(): void {
	buf = [];
}

export function interactionTraceSnapshot(): InteractionTraceEntry[] {
	return buf.slice();
}

export function subscribeInteractionTrace(
	listener: (entry: InteractionTraceEntry) => void
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function record(site: string, kind: string, detail?: InteractionTraceEntry['detail']): void {
	const entry: InteractionTraceEntry = { t: performance.now(), site, kind, detail };
	buf.push(entry);
	if (buf.length > CAPACITY) buf.splice(0, buf.length - CAPACITY);
	// Snapshot before iterating so a self-disposing subscriber doesn't abort the loop.
	for (const l of [...listeners]) {
		try {
			l(entry);
		} catch (err) {
			console.error('[InteractionTrace] subscriber threw while handling entry:', err);
		}
	}
}

// ── Recorders (one per transition family) ────────────────────────────────────
// Every recorder opens with the disabled gate as its first statement. Callers
// pass primitives they already hold; any detail assembly that would allocate
// stays behind an `isInteractionTraceEnabled()` guard at the call site.

/** A prose block rebuilt its inline DOM. `changed` names the render-key segments
 *  that differed (comma-joined; `renderKeySegmentDiff` computes it at the call site). */
export function traceRebuild(changed: string, force: boolean): void {
	if (!enabled) return;
	record('text-render', 'rebuild', { changed, force });
}

export function traceCursorCapture(walk: number): void {
	if (!enabled) return;
	record('text-render', 'cursor-capture', { walk });
}

export function traceCursorRestore(walk: number): void {
	if (!enabled) return;
	record('text-render', 'cursor-restore', { walk });
}

export function tracePendingCursorSet(source: string, offset: number | null): void {
	if (!enabled) return;
	record('pending-cursor', 'set', { source, offset: offset ?? -1, cleared: offset === null });
}

/** `applied` false = the block lost focus before the effect ran, so the caret
 *  restore was legally skipped (the documented focus-loss bail). */
export function tracePendingCursorConsume(offset: number, applied: boolean): void {
	if (!enabled) return;
	record('pending-cursor', 'consume', { offset, applied });
}

export function traceRevealOpen(tier: 'inline' | 'leaf'): void {
	if (!enabled) return;
	record('reveal', 'open', { tier });
}

export type RevealFoldReason = 'commit' | 'cancel' | 'no-edit' | 'selection-escape' | 'blur';

export function traceRevealFold(reason: RevealFoldReason): void {
	if (!enabled) return;
	record('reveal', 'fold', { reason });
}

/** One record per rebuild bracket: how many pooled widgets were adopted, built
 *  fresh, and swept-destroyed. Counted inside the pool, never per widget. */
export function tracePoolPass(adopt: number, build: number, destroyed: number): void {
	if (!enabled) return;
	record('widget-pool', 'pass', { adopt, build, destroyed });
}

export function traceCompositionStart(): void {
	if (!enabled) return;
	record('composition', 'start');
}

export function traceCompositionEnd(): void {
	if (!enabled) return;
	record('composition', 'end');
}

export function traceIslandsApplied(count: number): void {
	if (!enabled) return;
	record('text-render', 'islands', { count });
}

export function traceStickyCapture(x: number): void {
	if (!enabled) return;
	record('sticky-column', 'capture', { x });
}

export function traceStickyReset(): void {
	if (!enabled) return;
	record('sticky-column', 'reset');
}
