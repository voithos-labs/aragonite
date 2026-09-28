/**
 * The registrations waiting to be checked by `./registration-checks`. This module imports no
 * registry on purpose: the registries that add to it register built-ins while their own module is
 * still evaluating, so importing them back would run this module's code before its state exists.
 */
import type { AnyBlockKind } from '../core/nodes';
import { enrollTestReset } from './registry-reset';

const pendingKinds = new Set<AnyBlockKind>();
const pendingLateOpeners = new Set<AnyBlockKind>();
let didFirstFlush = false;
let grammarConsumed = false;

/**
 * Nothing queues before the first check, which covers the whole startup batch, except a late
 * opener: a bare `parse()` uses the grammar without a check, so a later one waits for it (G1.17).
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

function __resetRegistrationChecksForTests(): void {
	pendingKinds.clear();
	pendingLateOpeners.clear();
	didFirstFlush = false;
	grammarConsumed = false;
}
// A flag left behind by a cleared registry would make the next registrations look late.
enrollTestReset(__resetRegistrationChecksForTests);
