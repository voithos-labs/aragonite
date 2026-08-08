import { afterEach, describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import { INLINE_KIND_TABLE, type AnyInlineKind } from '$lib/core/nodes';
import type { InvariantViolation } from '$lib/invariants/assert';
import {
	declarePluginInlineKind,
	__clearDeclaredPluginInlineKindsForTests
} from '$lib/schema/plugin-kind';
import {
	registerInlineConstructPolicy,
	getInlineConstructPolicy,
	augmentInlineConstructPolicy,
	isRevealableInlineKind,
	registerLiveSplitRebalancer,
	getLiveSplitRebalancer,
	__resetInlineConstructPoliciesForTests,
	type InlineConstructPolicy,
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
	resetEditorEnv();
	__resetInlineConstructPoliciesForTests();
	__clearDeclaredPluginInlineKindsForTests();
});

describe('built-in rows', () => {
	it.each(['emphasis', 'strong', 'strikethrough', 'inlineCode'] as const)(
		'%s is a symmetric marker pair that closes and reopens across a split',
		(kind) => {
			expect(getInlineConstructPolicy(kind)).toEqual({
				edgeAffinity: 'symmetric-pair',
				autoUnwrapOnEmpty: true,
				splitBehavior: 'close-and-reopen',
				revealable: true
			});
		}
	);

	it('link neither edge extends, but a split still rebalances it', () => {
		expect(getInlineConstructPolicy('link')).toEqual({
			edgeAffinity: 'never-extend',
			autoUnwrapOnEmpty: true,
			splitBehavior: 'close-and-reopen',
			revealable: true
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

	// Task 2 left the angle brackets unstamped so block focus reveals them; a row
	// marking autolink revealable would make them permanently invisible instead.
	it('excludes autolink, which carries no policy row at all', () => {
		expect(getInlineConstructPolicy('autolink')).toBeUndefined();
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

	it('augment merges the patch and leaves the untouched fields alone', () => {
		const kind = declarePluginInlineKind('policy-augment');
		registerInlineConstructPolicy(kind, atomic);
		augmentInlineConstructPolicy(kind, { revealable: true, splitBehavior: 'close-and-reopen' });
		expect(getInlineConstructPolicy(kind)).toEqual({
			...atomic,
			revealable: true,
			splitBehavior: 'close-and-reopen'
		});
	});

	it('augment refuses to mint a row for an unregistered kind', () => {
		const kind = declarePluginInlineKind('policy-unregistered');
		expect(() => augmentInlineConstructPolicy(kind, { revealable: true })).toThrow(
			/not registered/i
		);
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
	});
});

describe('live split rebalancer slot', () => {
	it('ships empty — the value arrives with the live split rewrite', () => {
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
});
