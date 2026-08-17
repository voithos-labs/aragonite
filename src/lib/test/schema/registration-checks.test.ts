import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { AnyBlockKind } from '$lib/core/nodes';
import type { InvariantViolation } from '$lib/assert';
import { checkLateOpenerRegistration } from '$lib/invariants/registry';
import {
	flushPendingRegistrationChecks,
	hasPendingRegistrationChecks
} from '$lib/schema/registration-checks';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind, type BlockKindRegistration } from '$lib/schema/block-kind-descriptor';
import { registerBlockCommand } from '$lib/schema/block-commands';
import {
	registerBlockOpener,
	getOrderedOpeners,
	type BlockOpener
} from '$lib/schema/block-openers';
import { registerChromeLeaf } from '$lib/editor-actions/plugin/chrome-leaf';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { testClosure } from '$lib/test/support/closure';
import { allowDevWarns, takeDevWarns } from '$lib/test/support/warn-gate';

const containerGroup = { contract: 'opaque', rebuildRaw: () => {} } as const;

const container: BlockKindRegistration = {
	mergeRole: 'container',
	editable: true,
	supportsInline: false,
	closure: testClosure,
	container: containerGroup
};

const leaf: BlockKindRegistration = {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
};

const withChrome = (title: AnyBlockKind): BlockKindRegistration => ({
	...container,
	container: { ...containerGroup, reservedChrome: { kind: title } }
});

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

// registerChromeLeaf also registers a register-once paste surface, which the
// schema reset does not clear; reset it so chrome-leaf batches don't accumulate.
beforeEach(() => {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
});

// The unit setup registers built-in descriptors, never components, so every flush this file
// forces reports the completeness gap; the subject here is what else the flush finds.
afterEach(() => allowDevWarns(['invariant:registry-completeness']));

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

	it('reports an opener registered pre-flush after an editorless grammar read', () => {
		// An editorless `parse()` consumes the grammar without flushing (nothing pending),
		// so `didFirstFlush` stays false — G1.17 pre-flush blindness.
		getOrderedOpeners();
		const kind = declarePluginKind('pre-flush-late');
		registerBlockKind(kind, leaf);
		registerBlockOpener(kind, opener(9108));

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
		registerBlockOpener(calloutKind, opener(9102));
		registerBlockKind(calloutKind, withChrome(title));
		registerChromeLeaf(title, TextEditableBlock);

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
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:late-opener-registration');
	});

	it('resets both latches and the pending set via the schema reset', () => {
		flushPendingRegistrationChecks();
		getOrderedOpeners();
		const stale = declarePluginKind('stale-kind');
		registerBlockKind(stale, leaf);
		registerBlockOpener(stale, opener(9105));

		__resetSchemaRegistriesForTests();

		// Post-reset registrations are bootstrap again: both latches cleared, so they
		// enqueue nothing and the opener must not warn late.
		const fresh = declarePluginKind('post-reset');
		registerBlockKind(fresh, leaf);
		registerBlockOpener(fresh, opener(9106));
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

	it('accepts a pre-mount plugin keymap binding its own minted command', () => {
		const kind = declarePluginKind('pre-mount-command');
		const command = registerBlockCommand(kind, 'toggleThing', () => true);
		registerBlockKind(kind, { ...leaf, keymap: [{ chord: 'Mod+K', command }] });

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('keymap-coherence')).toEqual([]);
	});

	it('accepts a coherent pre-mount callout-shaped batch', () => {
		const title = declarePluginKind('boot-title');
		registerChromeLeaf(title, TextEditableBlock);
		const calloutKind = declarePluginKind('boot-container');
		registerBlockKind(calloutKind, withChrome(title));
		registerBlockOpener(calloutKind, opener(9107));

		const { violations, report } = collector();
		flushPendingRegistrationChecks(report);
		// Built-in components don't load in the unit-test context (see registry.test.ts), so
		// the completeness sweep fires on built-ins; every other check must stay silent.
		expect(violations.filter((v) => v.tag !== 'registry-completeness')).toEqual([]);
	});
});

// Twins of the first-sweep keymap cases at the INCREMENTAL path — the sibling path that
// a first-flush-only scope, or a builtin-only known-command set, would leave unguarded.
describe('keymap coherence at the incremental flush', () => {
	it('accepts a plugin keymap binding its own minted command', () => {
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

// A leaf declaring reservedChrome is unrepresentable through the registration shape, so
// only chrome-kind gaps are constructible here; the not-container branch is covered by
// direct call in test/invariants/reserved-chrome-coherence.test.ts.
describe('reservedChrome coherence at the flush', () => {
	it('flags a chrome kind with no registered component (first-flush sweep)', () => {
		const title = declarePluginKind('rc-descriptor-only');
		registerBlockKind(title, { ...leaf, contextDependentKind: true });
		const calloutKind = declarePluginKind('rc-container');
		registerBlockKind(calloutKind, withChrome(title));

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('reserved-chrome-coherence')).toHaveLength(1);
		expect(byTag('reserved-chrome-coherence')[0].violation.detail).toMatchObject({
			chromeKind: 'rc-descriptor-only',
			missing: 'component'
		});
	});
});

// The predicate is unit-tested in test/invariants/closure-coherence.test.ts; this pins the
// G1.24 wiring, which every predicate test would stay green without.
describe('closure coherence at the flush', () => {
	it('flags a registered kind whose closure is incoherent with its descriptor', () => {
		const kind = declarePluginKind('incoherent-closure');
		// not-mergeable + mergeBackspace inherit-default → G1.24 rule (b).
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
