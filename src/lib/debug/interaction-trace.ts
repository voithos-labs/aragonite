/**
 * Bounded ring buffer of the inline layer's transient state transitions, read through the debug
 * panel and `getDiagnostics()`. Unlike `perf/instruments.ts` it arms from anywhere, production
 * included, so a consumer app can attach it to a bug report — which is why entries carry cheap
 * primitives ONLY, never node references or raw document text. The buffer is module-global, so
 * two editors on one page interleave.
 */

export interface InteractionTraceEntry {
	/** `performance.now()` at record time — monotonic, no wall clock. */
	t: number;
	site: string;
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

/** Empty the buffer without touching the enabled flag — test isolation. */
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
// Every recorder opens with the disabled gate. Detail assembly that would allocate stays
// behind an `isInteractionTraceEnabled()` guard at the call site.

/** `changed` names the differing render-key segments, comma-joined. */
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

/** `applied` false = the block lost focus before the effect ran, so the caret restore was
 *  legally skipped. */
export function tracePendingCursorConsume(offset: number, applied: boolean): void {
	if (!enabled) return;
	record('pending-cursor', 'consume', { offset, applied });
}

/** `construct` carries a `kind:start-end` descriptor; other tiers record the tier alone. */
export function traceRevealOpen(tier: 'inline' | 'leaf' | 'construct', construct?: string): void {
	if (!enabled) return;
	record('reveal', 'open', construct === undefined ? { tier } : { tier, construct });
}

export type RevealFoldReason =
	'commit' | 'cancel' | 'no-edit' | 'selection-escape' | 'blur' | 'caret-exit';

export function traceRevealFold(reason: RevealFoldReason, construct?: string): void {
	if (!enabled) return;
	record('reveal', 'fold', construct === undefined ? { reason } : { reason, construct });
}

/** One record per rebuild bracket, counted inside the pool rather than per widget. */
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
