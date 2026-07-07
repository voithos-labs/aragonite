import { describe, expect, it, beforeEach } from 'vitest';
import type { AnyBlockKind } from '$lib/core/nodes';
import type { InvariantViolation } from '$lib/invariants/assert';
import { checkLateOpenerRegistration } from '$lib/invariants/registry';
import { flushPendingRegistrationChecks } from '$lib/schema/registration-checks';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind, type BlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import {
	registerBlockOpener,
	getOrderedOpeners,
	type BlockOpener
} from '$lib/schema/block-openers';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

const leaf: BlockKindDescriptor = {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: false
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
	return { violations, report, byTag };
}

beforeEach(() => __resetSchemaRegistriesForTests());

describe('checkLateOpenerRegistration', () => {
	it('passes while the grammar is unconsumed', () => {
		expect(checkLateOpenerRegistration('x' as AnyBlockKind, false)).toBeNull();
	});

	it('fires once documents have parsed, naming the kind', () => {
		const violation = checkLateOpenerRegistration('x' as AnyBlockKind, true);
		expect(violation?.message).toContain('opener for "x" registered after documents were parsed');
	});
});

describe('flushPendingRegistrationChecks', () => {
	it('reports a late opener exactly once, only at the flush', () => {
		flushPendingRegistrationChecks();
		getOrderedOpeners();
		const kind = declarePluginKind('late-kind');
		registerBlockKind(kind, leaf);
		registerBlockOpener(kind, opener(101));

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toHaveLength(1);
		expect(byTag('late-opener-registration')[0].violation.message).toContain('late-kind');

		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toHaveLength(1);
	});

	it('tolerates forward references inside a registration batch', () => {
		flushPendingRegistrationChecks();
		const container = declarePluginKind('fwd-container');
		const title = declarePluginKind('fwd-title');
		// Opener lands before its descriptor; reservedChrome names a kind
		// registered later in the same batch — nothing may fire mid-batch.
		registerBlockOpener(container, opener(102));
		registerBlockKind(container, {
			...leaf,
			mergeRole: 'container',
			isContainer: true,
			containerContract: 'opaque',
			rebuildRaw: () => {},
			reservedChrome: { kind: title }
		});
		registerBlockKind(title, { ...leaf, contextDependentKind: true });

		const { violations, report } = collector();
		flushPendingRegistrationChecks(report);
		expect(violations).toEqual([]);
	});

	it('re-checks opener coherence across batches (duplicate priority)', () => {
		flushPendingRegistrationChecks();
		const first = declarePluginKind('pri-a');
		registerBlockKind(first, leaf);
		registerBlockOpener(first, opener(103));
		flushPendingRegistrationChecks();

		const second = declarePluginKind('pri-b');
		registerBlockKind(second, leaf);
		registerBlockOpener(second, opener(103));

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('opener-registry')[0]?.violation.message).toContain('priority 103');
	});

	it('drains pending checks on the next grammar read', () => {
		flushPendingRegistrationChecks();
		getOrderedOpeners();
		const kind = declarePluginKind('parse-flushed');
		registerBlockKind(kind, leaf);
		registerBlockOpener(kind, opener(104));

		getOrderedOpeners();

		const { violations, report } = collector();
		flushPendingRegistrationChecks(report);
		expect(violations).toEqual([]);
	});

	it('resets both latches and the pending set via the schema reset', () => {
		flushPendingRegistrationChecks();
		getOrderedOpeners();
		const stale = declarePluginKind('stale-kind');
		registerBlockKind(stale, leaf);
		registerBlockOpener(stale, opener(105));

		__resetSchemaRegistriesForTests();

		// Post-reset registrations are bootstrap again: not enqueued, so the
		// broken keymap below must NOT surface (first-flush latch cleared), and
		// the opener must NOT warn late (grammar latch cleared).
		const fresh = declarePluginKind('post-reset');
		registerBlockKind(fresh, {
			...leaf,
			keymap: [{ chord: 'Mod+B', command: 'no.such.command' as never }]
		});
		registerBlockOpener(fresh, opener(106));

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toEqual([]);
		expect(byTag('keymap-coherence')).toEqual([]);
	});
});
