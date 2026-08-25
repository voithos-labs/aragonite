import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { collector } from '$lib/test/harness/violation-collector';

// lineInterruptsParagraph reads the same grammar as getOrderedOpeners, so it carries the
// same seam duties — sibling-path parity with the dispatch read.

const leaf: BlockKindRegistration = {
	gapEdges: 'none',
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

beforeEach(() => __resetSchemaRegistriesForTests());

// The unit setup registers built-in descriptors, never components, so every flush this file
// forces reports the completeness gap; the subject here is what else the flush finds.
afterEach(() => allowDevWarns(['invariant:registry-completeness']));

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
