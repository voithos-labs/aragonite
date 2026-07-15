import { describe, expect, it, beforeEach } from 'vitest';
import type { AnyBlockKind } from '$lib/core/nodes';
import type { InvariantViolation } from '$lib/invariants/assert';
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

	it('tolerates forward references in a coherent callout-shaped batch', () => {
		flushPendingRegistrationChecks();
		const calloutKind = declarePluginKind('fwd-container');
		const title = declarePluginKind('fwd-title');
		// Opener lands before its descriptor; reservedChrome names a chrome kind
		// registered later in the same batch via registerChromeLeaf — nothing may
		// fire mid-batch, and the completed batch is fully coherent.
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
	});

	it('resets both latches and the pending set via the schema reset', () => {
		flushPendingRegistrationChecks();
		getOrderedOpeners();
		const stale = declarePluginKind('stale-kind');
		registerBlockKind(stale, leaf);
		registerBlockOpener(stale, opener(9105));

		__resetSchemaRegistriesForTests();

		// Post-reset registrations are bootstrap again: the first-flush latch is
		// cleared, so they no-op the enqueue (nothing pending) rather than queueing
		// as incremental, and the opener must NOT warn late (grammar latch cleared).
		const fresh = declarePluginKind('post-reset');
		registerBlockKind(fresh, leaf);
		registerBlockOpener(fresh, opener(9106));
		expect(hasPendingRegistrationChecks()).toBe(false);

		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('late-opener-registration')).toEqual([]);
	});
});

// The first flush sweeps the live registry (getAllRegisteredKinds), not just the
// built-in ALL_BLOCK_KINDS, so a plugin registered before the first mount is
// validated like any other — closing the pre-mount coverage gap.
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
		// Built-in components don't load in the unit-test context (see
		// registry.test.ts), so the first-flush completeness sweep fires on
		// built-ins here; every other check — the batch's own included — is silent.
		expect(violations.filter((v) => v.tag !== 'registry-completeness')).toEqual([]);
	});
});

// Twins of the first-sweep keymap cases at the INCREMENTAL path: a regression
// that scoped keymap coherence to the first flush, or fed the incremental path
// a builtin-only known-command set, must fail here.
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

// A leaf declaring reservedChrome is unrepresentable through the registration
// shape (the grouped `container` field owns it), so only the chrome-kind gaps
// remain constructible here; the not-container predicate branch stays covered
// by direct call in test/invariants/reserved-chrome-coherence.test.ts.
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
