/**
 * Pending-registration ledger behind the registration-check seam
 * (`./registration-checks`). Import-leaf on purpose: the registries that
 * enqueue here (block-kind-descriptor, block-openers) register built-ins
 * during their own module evaluation, so the enqueue target must not
 * transitively import them back — the cycle would call into this module
 * before its state initializes.
 */
import type { AnyBlockKind } from '../core/nodes';

const pendingKinds = new Set<AnyBlockKind>();
const pendingLateOpeners = new Set<AnyBlockKind>();
let didFirstFlush = false;
let grammarConsumed = false;

/**
 * Record a registration for the next coherence flush. The pending-kinds gate
 * no-ops before the first flush — the bootstrap batch is validated whole by that
 * flush. Lateness is recorded UNCONDITIONALLY, ahead of that gate: an editorless
 * `parse()` trips grammar-consumption without flushing (`getOrderedOpeners` only
 * flushes when something is already pending), so an opener registered pre-flush
 * after the grammar was consumed is genuinely late and must survive to the first
 * flush (G1.17).
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
 * Claim the outstanding work, clearing it BEFORE any check runs — draining
 * first is the re-entrancy guard: a check that re-reads the grammar finds an
 * empty pending set instead of recursing into another flush. Null when there
 * is nothing to do (first flush already ran, nothing pending since).
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
