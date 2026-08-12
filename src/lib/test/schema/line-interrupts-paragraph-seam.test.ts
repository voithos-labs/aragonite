import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvariantViolation } from '$lib/invariants/assert';
import {
	flushPendingRegistrationChecks,
	hasPendingRegistrationChecks
} from '$lib/schema/registration-checks';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind, type BlockKindRegistration } from '$lib/schema/block-kind-descriptor';
import {
	registerBlockOpener,
	lineInterruptsParagraph,
	type BlockOpener
} from '$lib/schema/block-openers';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// lineInterruptsParagraph reads the same grammar as getOrderedOpeners, so it carries the
// same seam duties — sibling-path parity with the dispatch read.

const leaf: BlockKindRegistration = {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
};

const opener = (priority: number): BlockOpener => ({
	priority,
	tryOpen: () => null,
	interruptsParagraph: false
});

function collector() {
	const violations: { tag: string; violation: InvariantViolation }[] = [];
	const report = (tag: string, check: () => InvariantViolation | null): void => {
		const violation = check();
		if (violation) violations.push({ tag, violation });
	};
	const byTag = (tag: string) => violations.filter((v) => v.tag === tag);
	return { report, byTag };
}

beforeEach(() => __resetSchemaRegistriesForTests());

// The unit setup registers built-in descriptors, never components, so every flush this file
// forces reports the completeness gap; the subject here is what else the flush finds.
afterEach(() => expectDevWarns(['invariant:registry-completeness']));

describe('lineInterruptsParagraph as a grammar-consumption seam', () => {
	it('drains pending registration checks like getOrderedOpeners', () => {
		flushPendingRegistrationChecks();
		const kind = declarePluginKind('interrupt-flushed');
		registerBlockKind(kind, leaf);
		registerBlockOpener(kind, opener(9201));
		expect(hasPendingRegistrationChecks()).toBe(true);

		lineInterruptsParagraph('# h');

		expect(hasPendingRegistrationChecks()).toBe(false);
	});

	it('trips the latch: an opener registered after an interrupt read warns late', () => {
		flushPendingRegistrationChecks();
		lineInterruptsParagraph('# h');

		const kind = declarePluginKind('interrupt-late');
		registerBlockKind(kind, leaf);
		registerBlockOpener(kind, opener(9202));

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toHaveLength(1);
		expect(byTag('late-opener-registration')[0].violation.message).toContain('interrupt-late');
	});
});
