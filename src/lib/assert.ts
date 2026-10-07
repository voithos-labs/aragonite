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

/** The document a dev check reads, or null where there is none. A check that would do more
 *  with a DOM asks here, so a run without one says what it skipped instead of passing quietly. */
export function documentForCheck(check: string): Document | null {
	if (typeof document !== 'undefined') return document;
	devWarn(
		'needs-dom',
		`${check} needs a DOM and there is none here, so it did not run. Under Vitest, give the ` +
			'test file a `// @vitest-environment jsdom` docblock.'
	);
	return null;
}
