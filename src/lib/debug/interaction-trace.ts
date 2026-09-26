/**
 * A fixed-size ring buffer of the inline code's short-lived state changes, read through the
 * debug panel and `getDiagnostics()`. Unlike `perf/instruments.ts` it can be turned on anywhere,
 * production included, so a consumer app can attach it to a bug report; that is why an entry
 * holds only cheap values, never node references or raw document text. The buffer is
 * module-global, so two editors on one page interleave their entries.
 */

export interface InteractionTraceEntry {
	/** `performance.now()` at record time: it only ever goes up, and is not a wall clock. */
	t: number;
	site: string;
	kind: string;
	detail?: Record<string, string | number | boolean>;
}

const CAPACITY = 200;

let enabled = false;
let buf: InteractionTraceEntry[] = [];
// Only ever goes up, so a polling harness costs one read and the ring buffer dropping an
// old entry cannot take back a result it already counted.
let keydownVerdicts = 0;

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

/** Empty the buffer without touching the enabled flag, so tests stay isolated. */
export function resetInteractionTrace(): void {
	buf = [];
	keydownVerdicts = 0;
}

export function interactionTraceKeydownCount(): number {
	return keydownVerdicts;
}

export function interactionTraceSnapshot(): InteractionTraceEntry[] {
	return buf.slice();
}

function record(site: string, kind: string, detail?: InteractionTraceEntry['detail']): void {
	buf.push({ t: performance.now(), site, kind, detail });
	if (buf.length > CAPACITY) buf.splice(0, buf.length - CAPACITY);
}

// ── Recorders (one per transition family) ────────────────────────────────────
// Every recorder starts by returning when recording is off. Building a detail that would
// allocate stays behind an `isInteractionTraceEnabled()` check at the call site.

/** `changed` names the differing render-key segments, comma-joined. */
export function traceRebuild(changed: string, force: boolean): void {
	if (!enabled) return;
	record('text-render', 'rebuild', { changed, force });
}

export function traceCursorCapture(raw: number): void {
	if (!enabled) return;
	record('text-render', 'cursor-capture', { raw });
}

export function traceCursorRestore(raw: number): void {
	if (!enabled) return;
	record('text-render', 'cursor-restore', { raw });
}

export function tracePendingCursorSet(source: string, offset: number | null): void {
	if (!enabled) return;
	record('pending-cursor', 'set', { source, offset: offset ?? -1, cleared: offset === null });
}

/** `applied` false means the block lost focus before the effect ran, so skipping the caret
 *  restore was correct. */
export function tracePendingCursorConsume(offset: number, applied: boolean): void {
	if (!enabled) return;
	record('pending-cursor', 'consume', { offset, applied });
}

/** `construct` holds a `kind:start-end` descriptor; the other levels record the level alone. */
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

/** One record per rebuild, counted once for the pool rather than once per widget. */
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

/** `handled` is the event's own `defaultPrevented`: whether the editor took the keystroke.
 *  Recorded once per keydown, after the block's handler has finished awaiting. */
export function traceKeydownVerdict(key: string, handled: boolean): void {
	if (!enabled) return;
	keydownVerdicts++;
	record('keydown', 'verdict', { key, handled });
}
