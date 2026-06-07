/**
 * Dev-runtime invariant channel. Runs a predicate in dev and routes a violation
 * to devWarn (never throws — a false positive must not crash a real editor).
 * No-op in production: the predicate is not even invoked. Tests call predicates
 * directly and assert on the returned violation; they never go through here, so
 * devWarn's Vitest suppression is irrelevant to enforcement.
 */
import { devWarn } from '../dev-warn';

export interface InvariantViolation {
	code: string;
	message: string;
	detail?: unknown;
}

export function assertInvariant(tag: string, check: () => InvariantViolation | null): void {
	if (!import.meta.env.DEV) return;
	const violation = check();
	if (violation) {
		devWarn(tag, violation.message, violation.detail ?? violation.code);
	}
}
