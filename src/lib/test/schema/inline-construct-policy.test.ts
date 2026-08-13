import { afterEach, describe, expect, it } from 'vitest';
import { configureEditorEnv } from '$lib/env';
import { takeDevWarns } from '../support/warn-gate';
import { INLINE_KIND_TABLE, type AnyInlineKind } from '$lib/core/nodes';
import type { InvariantViolation } from '$lib/invariants/assert';
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

const atomic: InlineConstructPolicy = {
	edgeAffinity: 'never-extend',
	autoUnwrapOnEmpty: false,
	splitBehavior: 'plain',
	revealable: false
};

const rebalancer = (): LiveSplitRebalancer => () => null;

function collector() {
	const violations: { tag: string; violation: InvariantViolation }[] = [];
	const report = (tag: string, check: () => InvariantViolation | null): void => {
		const violation = check();
		if (violation) violations.push({ tag, violation });
	};
	return { report, byTag: (tag: string) => violations.filter((v) => v.tag === tag) };
}

afterEach(() => {
	__resetInlineConstructPoliciesForTests();
	// Separate door: the row reset deliberately leaves the slot alone, so only this suite —
	// which tests the slot itself — empties it between cases.
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

	// The mark vocabulary the toggle seams used to hold as two hand-written tables: the byte run
	// each chord writes, and the order a set of them nests in.
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

	// The card is one construct's door. An image's destination has its own editor and an
	// autolink's is the text on screen, so neither claims the card.
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
	// The pin on construct-reveal's former module-private REVEALABLE_KINDS: the table
	// replaced it, so any drift here is a behavior change in preview-inline.
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

	// The autolink is rowed but not revealable: its brackets hide with the block rather than by
	// caret proximity (a revealable row would make them permanently invisible), and the row is
	// what the typing seat reads to keep a byte out from between them.
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
});

describe('live split rebalancer slot', () => {
	// A parse-only bootstrap loads the descriptors and never the component layer, so the slot
	// stands empty there and `splitNode` falls back to the byte-literal cut.
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

	// Miss-analysis: a reset that drops the slot retires live splits silently, since
	// `registerBuiltInBlocks` short-circuits on its idempotence flag and nothing re-registers.
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

	// The parser's getOrderedOpeners drains the same queue inside parse-only unit tests,
	// where the component layer that patches the policy's hooks in is absent.
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

	// The guards that replaced the mark union's exhaustiveness: a rank tie leaves which mark
	// wraps the other to registration order, and a command tie makes one press two toggles.
	const tie = (mark: InlineMarkPolicy): InlineMarkPolicy => mark;
	it.each([
		// `block.split` is claimed by no mark row, so the first case ties on the rank alone.
		['nestingRank', tie({ nestingRank: 0, markerBytes: '++', command: 'block.split' })],
		['command', tie({ nestingRank: 99, markerBytes: '++', command: 'format.toggleStrong' })]
	])('fires when a plugin row ties a built-in mark on %s', (column, mark) => {
		const kind = declarePluginInlineKind(`mark-tie-${column}`);
		registerInlineConstructPolicy(kind, { ...atomic, revealable: true, mark });
		const { report, byTag } = collector();
		checkInlineConstructPoliciesAtMount(report);
		expect(byTag('inline-construct-policy')).toHaveLength(1);
		expect(byTag('inline-construct-policy')[0].violation.detail).toHaveProperty(column);
	});

	// `link.openCard` ties with no mark row, so nothing above catches it — and it is the id whose
	// two surfaces rank the mark lookup differently: the cell consults marks first, prose last.
	it('fires when a plugin row claims a built-in command no mark row holds', () => {
		const kind = declarePluginInlineKind('mark-builtin-command');
		registerInlineConstructPolicy(kind, {
			...atomic,
			revealable: true,
			mark: tie({ nestingRank: 99, markerBytes: '++', command: 'link.openCard' })
		});
		const { report, byTag } = collector();
		checkInlineConstructPoliciesAtMount(report);
		expect(byTag('inline-construct-policy')).toHaveLength(1);
		expect(byTag('inline-construct-policy')[0].violation.message).toContain('link.openCard');
	});
});
