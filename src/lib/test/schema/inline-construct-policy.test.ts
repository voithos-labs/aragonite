import { afterEach, describe, expect, it } from 'vitest';
import { configureEditorEnv } from '$lib/env';
import { takeDevWarns } from '../support/warn-gate';
import { INLINE_KIND_TABLE, type AnyInlineKind } from '$lib/core/nodes';
import {
	declarePluginInlineKind,
	__clearDeclaredPluginInlineKindsForTests
} from '$lib/schema/plugin-kind';
import {
	registerInlineConstructPolicy,
	getInlineConstructPolicy,
	getInlineMarkPolicy,
	inlineMarkForCommand,
	isCardEditableInlineKind,
	isRevealableInlineKind,
	listInlineMarks,
	registerLiveSplitRebalancer,
	getLiveSplitRebalancer,
	__resetInlineConstructPoliciesForTests,
	__resetLiveSplitRebalancerForTests,
	type InlineConstructPolicy,
	type InlineMarkPolicy,
	type LiveSplitRebalancer
} from '$lib/schema/inline-construct-policy';
import {
	flushPendingRegistrationChecks,
	checkInlineConstructPoliciesAtMount
} from '$lib/schema/registration-checks';
import { mintCommandId } from '$lib/schema/command-id';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { collector } from '$lib/test/harness/violation-collector';

const atomic: InlineConstructPolicy = {
	edgeAffinity: 'never-extend',
	autoUnwrapOnEmpty: false,
	splitBehavior: 'plain',
	revealable: false
};

const rebalancer = (): LiveSplitRebalancer => () => null;

afterEach(() => {
	__resetInlineConstructPoliciesForTests();
	// A separate reset: clearing the rows deliberately leaves this function registered, so only
	// this suite, which tests that function, clears it between cases.
	__resetLiveSplitRebalancerForTests();
	__clearDeclaredPluginInlineKindsForTests();
});

describe('built-in rows', () => {
	it.each(['emphasis', 'strong', 'strikethrough', 'inlineCode'] as const)(
		'%s is a symmetric marker pair that closes and reopens across a split',
		(kind) => {
			expect(getInlineConstructPolicy(kind)).toMatchObject({
				edgeAffinity: 'symmetric-pair',
				autoUnwrapOnEmpty: true,
				splitBehavior: 'close-and-reopen',
				revealable: true
			});
		}
	);

	// What a mark writes: the run of bytes each chord inserts, and the order several of them nest
	// in.
	it('the markable kinds are the four format chords, outermost first', () => {
		expect(
			listInlineMarks().map(({ kind, mark }) => [kind, mark.markerBytes, mark.command])
		).toEqual([
			['strong', '**', 'format.toggleStrong'],
			['emphasis', '*', 'format.toggleEmphasis'],
			['strikethrough', '~~', 'format.toggleStrikethrough'],
			['inlineCode', '`', 'format.toggleCode']
		]);
	});

	// Inline code is the one kind whose delimiters depend on what they enclose, so it is the one
	// row carrying a wrap function rather than leaning on the marker-content-marker default.
	it('inline code alone sizes its own fence', () => {
		const wrappers = listInlineMarks().filter(({ mark }) => mark.wrapBytes !== undefined);
		expect(wrappers.map(({ kind }) => kind)).toEqual(['inlineCode']);
		expect(wrappers[0].mark.wrapBytes?.('a `b` c')).toBe('``a `b` c``');
	});

	it('a command resolves to the one mark that claims it, and to null otherwise', () => {
		expect(inlineMarkForCommand('format.toggleStrikethrough')?.kind).toBe('strikethrough');
		expect(inlineMarkForCommand('block.split')).toBeNull();
	});

	it('a kind with no mark row reads undefined rather than an empty vocabulary', () => {
		expect(getInlineMarkPolicy('link')).toBeUndefined();
	});

	// The card belongs to one construct. An image's destination has its own editor and an
	// autolink's is the text on screen, so neither uses the card.
	it('the bracketed link alone is card-editable', () => {
		const kinds = Object.keys(INLINE_KIND_TABLE) as AnyInlineKind[];
		expect(kinds.filter(isCardEditableInlineKind)).toEqual(['link']);
	});

	it('link neither edge extends, but a split still rebalances it', () => {
		expect(getInlineConstructPolicy('link')).toEqual({
			edgeAffinity: 'never-extend',
			autoUnwrapOnEmpty: true,
			splitBehavior: 'close-and-reopen',
			revealable: true,
			cardEditable: true
		});
	});

	it('image is atomic: emptying its alt leaves a valid image, and a split moves bytes only', () => {
		expect(getInlineConstructPolicy('image')).toEqual({
			edgeAffinity: 'never-extend',
			autoUnwrapOnEmpty: false,
			splitBehavior: 'plain',
			revealable: true
		});
	});

	it.each(['escape', 'hardLineBreak'] as const)(
		'%s is an atomic marker run that never reveals',
		(kind) => {
			expect(getInlineConstructPolicy(kind)).toEqual(atomic);
		}
	);
});

describe('revealable membership', () => {
	// The kinds preview-inline may show markers for, so a change here is a change in what
	// preview-inline does.
	it('is exactly the six marker-bearing constructs', () => {
		const kinds = Object.keys(INLINE_KIND_TABLE) as AnyInlineKind[];
		expect(kinds.filter(isRevealableInlineKind)).toEqual([
			'emphasis',
			'strong',
			'strikethrough',
			'inlineCode',
			'link',
			'image'
		]);
	});

	// The autolink has a row but is not revealable: its brackets hide with the block rather than
	// according to where the caret is (a revealable row would hide them for good), and the row is
	// what the typing code reads to keep a character from landing between them.
	it('excludes autolink, which is rowed but not revealable', () => {
		expect(getInlineConstructPolicy('autolink')?.edgeAffinity).toBe('never-extend');
		expect(isRevealableInlineKind('autolink')).toBe(false);
	});
});

describe('registration lifecycle', () => {
	it('a registered kind reads back its row; an unregistered one reads undefined', () => {
		const kind = declarePluginInlineKind('policy-roundtrip');
		registerInlineConstructPolicy(kind, atomic);
		expect(getInlineConstructPolicy(kind)).toEqual(atomic);
		expect(getInlineConstructPolicy(declarePluginInlineKind('policy-absent'))).toBeUndefined();
	});

	it('throws on a duplicate registration under test', () => {
		const kind = declarePluginInlineKind('policy-dup');
		registerInlineConstructPolicy(kind, atomic);
		expect(() => registerInlineConstructPolicy(kind, atomic)).toThrow(/already registered/i);
	});

	// Miss-analysis: the combined reset's own test lists the published register-once registries,
	// and this one is not on the plugin barrel yet, so no case pointed the schema reset at it,
	// leaving a suite that registers a row unable to re-run its setup.
	it('drops its plugin rows through the schema registry reset', () => {
		const kind = declarePluginInlineKind('policy-schema-reset');
		registerInlineConstructPolicy(kind, atomic);
		__resetSchemaRegistriesForTests();
		expect(getInlineConstructPolicy(kind)).toBeUndefined();
		expect(() => registerInlineConstructPolicy(kind, atomic)).not.toThrow();
	});

	it('replaces instead of throwing on a dev server', () => {
		const kind = declarePluginInlineKind('policy-dev');
		registerInlineConstructPolicy(kind, atomic);
		configureEditorEnv({ isDev: true, isTest: false });
		expect(() =>
			registerInlineConstructPolicy(kind, { ...atomic, revealable: true })
		).not.toThrow();
		expect(getInlineConstructPolicy(kind)?.revealable).toBe(true);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['registry']);
	});

	// Registration refuses the row rather than accepting one G1.31 would only warn about. The dev
	// server forgives a duplicate, never an invalid row: a re-run would submit the same one.
	const claimsCard = (name: string) => () =>
		registerInlineConstructPolicy(declarePluginInlineKind(name), {
			...atomic,
			revealable: true,
			mark: { nestingRank: 99, markerBytes: '++', command: 'link.openCard' }
		});

	it('throws on a mark claiming a built-in command id', () => {
		expect(claimsCard('policy-builtin-command')).toThrow(/link\.openCard/);
	});

	it('throws on that same claim under the dev valve', () => {
		configureEditorEnv({ isDev: true, isTest: false });
		expect(claimsCard('policy-builtin-command-dev')).toThrow(/link\.openCard/);
	});
});

describe('live split rebalancer slot', () => {
	// A parse-only startup loads the descriptors and never the component layer, so nothing is
	// registered there and `splitNode` falls back to cutting the bytes.
	it('is empty until the editor layer registers into it', () => {
		expect(getLiveSplitRebalancer()).toBeUndefined();
	});

	it('reads back the registered function', () => {
		const fn = rebalancer();
		registerLiveSplitRebalancer(fn);
		expect(getLiveSplitRebalancer()).toBe(fn);
	});

	it('throws on a second registration under test', () => {
		registerLiveSplitRebalancer(rebalancer());
		expect(() => registerLiveSplitRebalancer(rebalancer())).toThrow(/already registered/i);
	});

	it('replaces instead of throwing on a dev server', () => {
		registerLiveSplitRebalancer(rebalancer());
		configureEditorEnv({ isDev: true, isTest: false });
		const second = rebalancer();
		expect(() => registerLiveSplitRebalancer(second)).not.toThrow();
		expect(getLiveSplitRebalancer()).toBe(second);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['registry']);
	});

	// Miss-analysis: a reset that clears this function silently disables live splits, since
	// `registerBuiltInBlocks` returns early on its already-registered flag and nothing re-adds it.
	it('survives the plugin-row reset, being a built-in registration', () => {
		const fn = rebalancer();
		registerLiveSplitRebalancer(fn);
		__resetInlineConstructPoliciesForTests();
		expect(getLiveSplitRebalancer()).toBe(fn);
	});
});

describe('coherence check scope', () => {
	const incoherent = (name: string) => {
		const kind = declarePluginInlineKind(name);
		registerInlineConstructPolicy(kind, { ...atomic, splitBehavior: 'close-and-reopen' });
		return kind;
	};

	// The parser's getOrderedOpeners empties the same queue inside parse-only unit tests, where
	// the component layer that registers the policy's functions is absent.
	it('stays out of the registration flush the parser also drains', () => {
		incoherent('scope-parser');
		const { report, byTag } = collector();
		flushPendingRegistrationChecks(report);
		expect(byTag('inline-construct-policy')).toEqual([]);
	});

	it('fires at the mount check for the same row', () => {
		incoherent('scope-mount');
		const { report, byTag } = collector();
		checkInlineConstructPoliciesAtMount(report);
		expect(byTag('inline-construct-policy')).toHaveLength(1);
		expect(byTag('inline-construct-policy')[0].violation.detail).toMatchObject({
			kind: 'scope-mount'
		});
	});

	it('passes over the shipped built-in rows', () => {
		const { report, byTag } = collector();
		checkInlineConstructPoliciesAtMount(report);
		expect(byTag('inline-construct-policy')).toEqual([]);
	});

	// The checks standing in for an exhaustive union of marks: two rows with the same rank leave
	// which mark wraps the other up to registration order, and two with the same command make one
	// keypress two toggles. Registration accepts both; a mark on a built-in id it refuses outright.
	const markRow = (mark: InlineMarkPolicy): InlineConstructPolicy => ({
		...atomic,
		revealable: true,
		mark
	});
	// Created properly rather than cast: a mark row's command is an `AnyCommandId`, and
	// `mintCommandId` is the only way to get the plugin half of it.
	const tiedCommand = mintCommandId('spec.toggleTied');
	const sharedCommand = mintCommandId('spec.toggleShared');

	it('fires when a plugin row ties a built-in mark on its nesting rank', () => {
		registerInlineConstructPolicy(
			declarePluginInlineKind('mark-tie-rank'),
			markRow({ nestingRank: 0, markerBytes: '++', command: tiedCommand })
		);
		const { report, byTag } = collector();
		checkInlineConstructPoliciesAtMount(report);
		expect(byTag('inline-construct-policy')).toHaveLength(1);
		expect(byTag('inline-construct-policy')[0].violation.detail).toHaveProperty('nestingRank');
	});

	// One plugin's two kinds pointing at the same id it created: the collision still possible now
	// that a built-in id cannot be taken at all.
	it('fires when two plugin rows claim one command', () => {
		for (const [name, nestingRank] of [
			['mark-tie-first', 98],
			['mark-tie-second', 99]
		] as const) {
			registerInlineConstructPolicy(
				declarePluginInlineKind(name),
				markRow({ nestingRank, markerBytes: '++', command: sharedCommand })
			);
		}
		const { report, byTag } = collector();
		checkInlineConstructPoliciesAtMount(report);
		expect(byTag('inline-construct-policy')).toHaveLength(1);
		expect(byTag('inline-construct-policy')[0].violation.detail).toHaveProperty('command');
	});
});
