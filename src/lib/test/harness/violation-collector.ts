/**
 * Collects what an invariant check reports, tagged by the call site that ran it, so a suite can
 * assert "this check fired for this reason" rather than reading a console channel.
 */
import type { InvariantViolation } from '../../assert';

export interface TaggedViolation {
	tag: string;
	violation: InvariantViolation;
}

export interface ViolationCollector {
	violations: TaggedViolation[];
	report: (tag: string, check: () => InvariantViolation | null) => void;
	byTag: (tag: string) => TaggedViolation[];
}

export function collector(): ViolationCollector {
	const violations: TaggedViolation[] = [];
	const report = (tag: string, check: () => InvariantViolation | null): void => {
		const violation = check();
		if (violation) violations.push({ tag, violation });
	};
	return { violations, report, byTag: (tag) => violations.filter((v) => v.tag === tag) };
}
