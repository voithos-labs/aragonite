/**
 * Dev-runtime invariant channel: routes a violation to devWarn and never throws, since a
 * false positive must not crash a real editor. In production the predicate is not even
 * invoked. Tests call predicates directly rather than going through here.
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
		// `invariant:` namespaces the console marker so the e2e simulation's error
		// collector catches violations without tripping on benign dev warnings.
		devWarn(`invariant:${tag}`, violation.message, violation.detail ?? violation.code);
	}
}
