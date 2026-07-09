import { describe, expect, it } from 'vitest';
import type { InvariantViolation } from '$lib/invariants/assert';
import { parse } from '$lib/core/parser';
import { isBlockKindRegistered } from '$lib/schema/block-kind-descriptor';
import { isBlockOpenerRegistered } from '$lib/schema/block-openers';
import {
	flushPendingRegistrationChecks,
	type RegistrationCheckReport
} from '$lib/schema/registration-checks';
import '$lib/core/directive/register'; // module-load activation (side effect under test)
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '$lib/core/directive/kinds';

describe('directive activation seam', () => {
	it('registers the generic kinds and the shared opener at module load', () => {
		expect(isBlockKindRegistered(DIRECTIVE_CONTAINER)).toBe(true);
		expect(isBlockKindRegistered(DIRECTIVE_LEAF)).toBe(true);
		expect(isBlockOpenerRegistered(DIRECTIVE_CONTAINER)).toBe(true);
	});

	// Registering at load — before the grammar-consumed latch trips — is what keeps
	// the directive opener out of the G1.17 late-opener warn. Lazy activation
	// (registering on first `registerDirective`) would trip it once documents parse.
	it('emits no late-opener warn when a parse consumes the grammar after activation', () => {
		parse(':::x\ny\n:::\n');
		const tags: string[] = [];
		const report: RegistrationCheckReport = (tag, check) => {
			const violation: InvariantViolation | null = check();
			if (violation) tags.push(tag);
		};
		flushPendingRegistrationChecks(report);
		expect(tags).not.toContain('late-opener-registration');
	});
});
