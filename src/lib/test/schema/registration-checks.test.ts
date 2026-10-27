import { describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import { checkLateOpenerRegistration } from '#lib/invariants/registry.js';
import {
	flushPendingRegistrationChecks,
	hasPendingRegistrationChecks
} from '#lib/schema/registration-checks.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import {
	registerBlockKind,
	type BlockKindRegistration
} from '#lib/schema/block-kind-descriptor.js';
import { registerBlockCommand } from '#lib/schema/block-commands.js';
import { getOrderedOpeners, type BlockOpener } from '#lib/schema/block-openers.js';
import { registerChromeLeaf } from '#lib/plugin.js';
import { __resetSchemaRegistriesForTests } from '#lib/schema/registry-reset.js';
import { testClosure } from '#lib/test/harness/closure.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { collector } from '#lib/test/harness/violation-collector.js';
import { testView } from '#lib/test/harness/test-view.js';

const containerGroup = { contract: 'opaque', rebuildRaw: () => {} } as const;

const container: BlockKindRegistration = {
	view: testView(),
	gapEdges: 'none',
	mergeRole: 'container',
	editable: true,
	supportsInline: false,
	closure: testClosure,
	container: containerGroup
};

const leaf: BlockKindRegistration = {
	view: testView(),
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
};

const withChrome = (title: AnyBlockKind, opener?: BlockOpener): BlockKindRegistration => ({
	...container,
	opener,
	container: { ...containerGroup, reservedChrome: { kind: title } }
});

const opener = (priority: number): BlockOpener => ({
	priority,
	tryOpen: () => null,
	interruptsParagraph: false
});

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
		registerBlockKind(kind, { ...leaf, opener: opener(101) });

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toHaveLength(1);
		expect(byTag('late-opener-registration')[0].violation.message).toContain('late-kind');

		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toHaveLength(1);
	});

	it('reports an opener registered pre-flush after an editorless grammar read', () => {
		// A `parse()` with no editor marks the grammar used without running the checks, so
		// `didFirstFlush` stays false and a late opener must still warn (G1.17).
		getOrderedOpeners();
		const kind = declarePluginKind('pre-flush-late');
		registerBlockKind(kind, { ...leaf, opener: opener(9108) });

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toHaveLength(1);
		expect(byTag('late-opener-registration')[0].violation.message).toContain('pre-flush-late');
	});

	it('tolerates forward references in a coherent callout-shaped batch', () => {
		flushPendingRegistrationChecks();
		const calloutKind = declarePluginKind('fwd-container');
		const title = declarePluginKind('fwd-title');
		// Every reference here resolves only once the batch completes, so a check that
		// fires mid-batch reports a gap that never existed.
		registerBlockKind(calloutKind, withChrome(title, opener(9102)));
		registerChromeLeaf(title);

		const { violations, report } = collector();
		flushPendingRegistrationChecks(report);
		expect(violations).toEqual([]);
	});

	it('re-checks opener coherence across batches (duplicate priority)', () => {
		flushPendingRegistrationChecks();
		const first = declarePluginKind('pri-a');
		registerBlockKind(first, { ...leaf, opener: opener(103) });
		flushPendingRegistrationChecks();

		const second = declarePluginKind('pri-b');
		registerBlockKind(second, { ...leaf, opener: opener(103) });

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('opener-registry')[0]?.violation.message).toContain('priority 103');
	});

	it('drains pending checks on the next grammar read', () => {
		flushPendingRegistrationChecks();
		getOrderedOpeners();
		const kind = declarePluginKind('parse-flushed');
		registerBlockKind(kind, { ...leaf, opener: opener(104) });

		getOrderedOpeners();

		const { violations, report } = collector();
		flushPendingRegistrationChecks(report);
		expect(violations).toEqual([]);
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:late-opener-registration');
	});

	it('resets both latches and the pending set via the schema reset', () => {
		flushPendingRegistrationChecks();
		getOrderedOpeners();
		const stale = declarePluginKind('stale-kind');
		registerBlockKind(stale, { ...leaf, opener: opener(9105) });

		__resetSchemaRegistriesForTests();

		// Registrations after a reset count as startup again: both flags are cleared, so they queue
		// nothing and the opener must not warn about being late.
		const fresh = declarePluginKind('post-reset');
		registerBlockKind(fresh, { ...leaf, opener: opener(9106) });
		expect(hasPendingRegistrationChecks()).toBe(false);

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toEqual([]);
	});
});

// The first flush sweeps the live registry, not just the built-in ALL_BLOCK_KINDS, so a
// plugin registered before the first mount is validated like any other.
describe('registry-derived first-flush sweep', () => {
	it('flags a pre-mount plugin keymap binding an unknown command', () => {
		const kind = declarePluginKind('pre-mount-keymap');
		registerBlockKind(kind, {
			...leaf,
			keymap: [{ chord: 'Mod+B', command: 'no.such.command' as never }]
		});

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('keymap-coherence')).toHaveLength(1);
		expect(byTag('keymap-coherence')[0].violation.message).toContain('pre-mount-keymap');
	});

	it('accepts a pre-mount plugin keymap binding its own created command', () => {
		const kind = declarePluginKind('pre-mount-command');
		const command = registerBlockCommand(kind, 'toggleThing', () => true);
		registerBlockKind(kind, { ...leaf, keymap: [{ chord: 'Mod+K', command }] });

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('keymap-coherence')).toEqual([]);
	});

	it('accepts a coherent pre-mount callout-shaped batch', () => {
		const title = declarePluginKind('boot-title');
		registerChromeLeaf(title);
		const calloutKind = declarePluginKind('boot-container');
		registerBlockKind(calloutKind, withChrome(title, opener(9107)));

		const { violations, report } = collector();
		flushPendingRegistrationChecks(report);
		expect(violations).toEqual([]);
	});
});

// The same keymap cases on the later, incremental path: the sibling path a first-run-only check,
// or a known-command set holding only built-ins, would leave unguarded.
describe('keymap coherence at the incremental flush', () => {
	it('accepts a plugin keymap binding its own created command', () => {
		flushPendingRegistrationChecks();
		const kind = declarePluginKind('inc-minted');
		const command = registerBlockCommand(kind, 'toggleIncThing', () => true);
		registerBlockKind(kind, { ...leaf, keymap: [{ chord: 'Mod+K', command }] });

		const { violations, report } = collector();
		flushPendingRegistrationChecks(report);
		expect(violations).toEqual([]);
	});

	it('flags a keymap naming an unminted plugin-shaped id', () => {
		flushPendingRegistrationChecks();
		const kind = declarePluginKind('inc-unminted');
		registerBlockKind(kind, {
			...leaf,
			keymap: [{ chord: 'Mod+K', command: 'plugin.never-minted' as never }]
		});

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('keymap-coherence')).toHaveLength(1);
		expect(byTag('keymap-coherence')[0].violation.message).toBe(
			'kind "inc-unminted" binds chord "Mod+K" to unknown command "plugin.never-minted"'
		);
	});
});

// The predicate is unit-tested in test/invariants/reserved-chrome-coherence.test.ts; this case
// checks that the flush actually runs it (G1.18).
describe('reservedChrome coherence at the flush', () => {
	it('flags a chrome kind that was declared but never registered (first-flush sweep)', () => {
		const title = declarePluginKind('rc-declared-only');
		const calloutKind = declarePluginKind('rc-container');
		registerBlockKind(calloutKind, withChrome(title));

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('reserved-chrome-coherence')).toHaveLength(1);
		expect(byTag('reserved-chrome-coherence')[0].violation.detail).toMatchObject({
			chromeKind: 'rc-declared-only',
			missing: 'descriptor'
		});
	});
});

// The predicate is unit-tested in test/invariants/closure-coherence.test.ts; these cases check
// that the flush actually runs it (G1.24).
describe('closure coherence at the flush', () => {
	it('flags a registered kind whose closure is incoherent with its descriptor', () => {
		const kind = declarePluginKind('incoherent-closure');
		// A not-mergeable kind has no default merge for `mergeBackspace` to inherit (G1.24).
		registerBlockKind(kind, {
			...leaf,
			closure: { ...testClosure, mergeBackspace: { mode: 'inherit-default' } }
		});

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('closure-coherence')).toHaveLength(1);
		expect(byTag('closure-coherence')[0].violation.detail).toMatchObject({
			kind: 'incoherent-closure',
			column: 'mergeBackspace'
		});
	});
});
