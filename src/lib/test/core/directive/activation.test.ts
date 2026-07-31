import { beforeEach, describe, expect, it } from 'vitest';
import type { InvariantViolation } from '$lib/invariants/assert';
import { parse } from '$lib/core/parser';
import { isBlockKindRegistered } from '$lib/schema/block-kind-descriptor';
import { isBlockOpenerRegistered, __removePluginOpenersForTests } from '$lib/schema/block-openers';
import {
	flushPendingRegistrationChecks,
	__resetRegistrationChecksForTests,
	type RegistrationCheckReport
} from '$lib/schema/registration-checks';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '$lib/core/directive/kinds';

// Activation is call-based, so each case resets the opener registry and check latches to
// exercise G1.17 (opener registers before the parse that consumes the grammar) both ways.
function collectRegistrationTags(): string[] {
	const tags: string[] = [];
	const report: RegistrationCheckReport = (tag, check) => {
		const violation: InvariantViolation | null = check();
		if (violation) tags.push(tag);
	};
	flushPendingRegistrationChecks(report);
	return tags;
}

describe('directive grammar activation', () => {
	beforeEach(() => {
		__removePluginOpenersForTests();
		__resetRegistrationChecksForTests();
	});

	it('registers the generic kinds and the shared opener when called', () => {
		activateDirectiveGrammar();
		expect(isBlockKindRegistered(DIRECTIVE_CONTAINER)).toBe(true);
		expect(isBlockKindRegistered(DIRECTIVE_LEAF)).toBe(true);
		expect(isBlockOpenerRegistered(DIRECTIVE_CONTAINER)).toBe(true);
	});

	// Activating before the grammar-consumed latch trips is what keeps the directive
	// opener out of the G1.17 late-opener warn — the startup-before-parse contract.
	it('emits no late-opener warn when activated before a parse consumes the grammar', () => {
		activateDirectiveGrammar();
		parse(':::x\ny\n:::\n');
		expect(collectRegistrationTags()).not.toContain('late-opener-registration');
	});

	// The intended G1.17 catch: activating AFTER a document parsed means the opener
	// arrives too late for already-parsed documents to re-parse, so the dev-warn fires.
	it('warns when activated after a parse has already consumed the grammar', () => {
		flushPendingRegistrationChecks(() => {}); // bootstrap flush → didFirstFlush latch
		parse('plain paragraph\n'); // consumes the grammar (markGrammarConsumed)
		activateDirectiveGrammar();
		expect(collectRegistrationTags()).toContain('late-opener-registration');
	});
});
