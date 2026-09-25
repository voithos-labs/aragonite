/**
 * Where a dev-mode invariant check reports: it sends a violation to `devWarn` and never
 * throws, since a false positive must not crash a real editor. Outside a dev build, unless
 * `configureEditorEnv` turned dev on, the check is not even run. Tests call the predicates
 * directly rather than going through here.
 */
import { isDevChecks } from './env';
import { devWarn } from './dev-warn';

export interface InvariantViolation {
	code: string;
	message: string;
	detail?: unknown;
}

export function assertInvariant(tag: string, check: () => InvariantViolation | null): void {
	if (!isDevChecks()) return;
	const violation = check();
	if (violation) {
		// `invariant:` namespaces the console marker so the e2e simulation's error
		// collector catches violations without tripping on benign dev warnings.
		devWarn(`invariant:${tag}`, violation.message, violation.detail ?? violation.code);
	}
}
