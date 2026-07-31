/**
 * Pending-registration ledger behind the registration-check seam (`./registration-checks`).
 * Import-leaf on purpose: the registries that enqueue here register built-ins during their own
 * module evaluation, so a back-import would call into this module before its state initializes.
 */
import type { AnyBlockKind } from '../core/nodes';

const pendingKinds = new Set<AnyBlockKind>();
const pendingLateOpeners = new Set<AnyBlockKind>();
let didFirstFlush = false;
let grammarConsumed = false;

/**
 * Record a registration for the next coherence flush. The pending-kinds gate no-ops before the
 * first flush, which validates the bootstrap batch whole. Lateness is recorded UNCONDITIONALLY,
 * ahead of that gate: an editorless `parse()` trips grammar-consumption without flushing, so an
 * opener registered after that is genuinely late and must survive to the first flush (G1.17).
 */
export function enqueueRegistrationCheck(
	kind: AnyBlockKind,
	origin: 'descriptor' | 'opener' = 'descriptor'
): void {
	if (origin === 'opener' && grammarConsumed) pendingLateOpeners.add(kind);
	if (!didFirstFlush) return;
	pendingKinds.add(kind);
}

/** Grammar-consumption latch: the parser's opener-dispatch read trips it. */
export function markGrammarConsumed(): void {
	grammarConsumed = true;
}

export function hasPendingRegistrationChecks(): boolean {
	return pendingKinds.size > 0;
}

export interface RegistrationFlushWork {
	firstFlush: boolean;
	kinds: AnyBlockKind[];
	lateOpeners: AnyBlockKind[];
}

/**
 * Claim the outstanding work, clearing it BEFORE any check runs — draining first is the
 * re-entrancy guard, so a check that re-reads the grammar finds an empty pending set instead of
 * recursing into another flush.
 */
export function takeRegistrationFlushWork(): RegistrationFlushWork | null {
	if (didFirstFlush && pendingKinds.size === 0 && pendingLateOpeners.size === 0) return null;
	const work = {
		firstFlush: !didFirstFlush,
		kinds: [...pendingKinds],
		lateOpeners: [...pendingLateOpeners]
	};
	didFirstFlush = true;
	pendingKinds.clear();
	pendingLateOpeners.clear();
	return work;
}

export function __resetRegistrationChecksForTests(): void {
	pendingKinds.clear();
	pendingLateOpeners.clear();
	didFirstFlush = false;
	grammarConsumed = false;
}
