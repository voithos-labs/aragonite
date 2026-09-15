/**
 * The registrations waiting to be checked by `./registration-checks`. This module imports nothing
 * on purpose: the registries that add to it register built-ins while their own module is still
 * evaluating, so importing them back would run this module's code before its state exists.
 */
import type { AnyBlockKind } from '../core/nodes';

const pendingKinds = new Set<AnyBlockKind>();
const pendingLateOpeners = new Set<AnyBlockKind>();
let didFirstFlush = false;
let grammarConsumed = false;

/**
 * Record a registration for the next check. Nothing is added before the first check, which
 * validates the whole startup batch at once. A late opener is recorded whatever happens: a
 * `parse()` with no editor marks the grammar used without running a check, so an opener registered
 * after that really is late and has to survive until the first check (G1.17).
 */
export function enqueueRegistrationCheck(
	kind: AnyBlockKind,
	origin: 'descriptor' | 'opener' = 'descriptor'
): void {
	if (origin === 'opener' && grammarConsumed) pendingLateOpeners.add(kind);
	if (!didFirstFlush) return;
	pendingKinds.add(kind);
}

/** Marks the grammar as used; the parser sets it the first time it reads the opener order. */
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
 * Take the outstanding work and clear it before any check runs: clearing first is what keeps a
 * check that re-reads the grammar from starting another round of checks.
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
