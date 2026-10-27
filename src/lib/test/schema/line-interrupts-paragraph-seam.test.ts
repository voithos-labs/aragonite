import { describe, expect, it } from 'vitest';
import {
	flushPendingRegistrationChecks,
	hasPendingRegistrationChecks
} from '#lib/schema/registration-checks.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import {
	registerBlockKind,
	type BlockKindRegistration
} from '#lib/schema/block-kind-descriptor.js';
import { lineInterruptsParagraph, type BlockOpener } from '#lib/schema/block-openers.js';
import { testClosure } from '#lib/test/harness/closure.js';
import { collector } from '#lib/test/harness/violation-collector.js';
import { testView } from '#lib/test/harness/test-view.js';

// lineInterruptsParagraph reads the same grammar as getOrderedOpeners, so it has the same duties
// around pending registrations: the two sibling paths must behave alike.

const leaf: BlockKindRegistration = {
	view: testView(),
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

describe('lineInterruptsParagraph as a grammar-consumption join', () => {
	it('drains pending registration checks like getOrderedOpeners', () => {
		flushPendingRegistrationChecks();
		const kind = declarePluginKind('interrupt-flushed');
		registerBlockKind(kind, { ...leaf, opener: opener(9201) });
		expect(hasPendingRegistrationChecks()).toBe(true);

		lineInterruptsParagraph('# h');

		expect(hasPendingRegistrationChecks()).toBe(false);
	});

	it('trips the latch: an opener registered after an interrupt read warns late', () => {
		flushPendingRegistrationChecks();
		lineInterruptsParagraph('# h');

		const kind = declarePluginKind('interrupt-late');
		registerBlockKind(kind, { ...leaf, opener: opener(9202) });

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toHaveLength(1);
		expect(byTag('late-opener-registration')[0].violation.message).toContain('interrupt-late');
	});
});
