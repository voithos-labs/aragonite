/**
 * Where a dev-mode check reports, through `devWarn`: a violation it found, or that it had no DOM
 * to run against. Neither throws, since a false positive must not crash a real editor, and
 * `assertInvariant` skips its check outside a dev build unless `configureEditorEnv` turned dev on.
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
