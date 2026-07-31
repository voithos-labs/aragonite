import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { augmentBuiltin, tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { findContainerMatchingUnwrap } from '$lib/tree-operations/paste/container-match';
import { findListAbsorb } from '$lib/tree-operations/paste/list-absorb';
import { findListBreakOut } from '$lib/tree-operations/paste/list-break-out';

describe('containerPaste declaration drives the paste-merge decision', () => {
	it('kind without containerPaste (paragraph clipboard) never container-matches', () => {
		const doc = parse('> quoted\n');
		const clip = parse('plain paragraph\n');
		expect(findContainerMatchingUnwrap(doc, [0, 0], 0, clip, false)).toBeNull();
	});

	it('blockquote declares match-any: blockquote clipboard matches blockquote ancestor', () => {
		// Parse never yields an empty quoted paragraph, so the stub is built by hand.
		const doc = parse('> x\n');
		doc.children[0].children![0].raw = '\n';
		const clip = parse('> pasted\n');
		expect(findContainerMatchingUnwrap(doc, [0, 0], 0, clip, false)).not.toBeNull();
	});

	it('list matchesAncestor requires equal ordered flags', () => {
		const doc = parse('- a\n- b\n');
		const sameType = parse('- x\n- y\n');
		const otherType = parse('1. x\n2. y\n');
		expect(findListAbsorb(doc, [0, 1, 0], sameType, 0)).not.toBeNull();
		expect(findListAbsorb(doc, [0, 1, 0], otherType, 0)).toBeNull();
		expect(findListBreakOut(doc, [0, 1, 0], otherType, 0)).not.toBeNull();
		expect(findListBreakOut(doc, [0, 1, 0], sameType, 0)).toBeNull();
	});

	it('blockquote declares siblingAbsorb: false — no absorb path for quote clipboards', () => {
		const doc = parse('- a\n- b\n');
		const quoteClip = parse('> q\n');
		expect(findListAbsorb(doc, [0, 1, 0], quoteClip, 0)).toBeNull();
		expect(findListBreakOut(doc, [0, 1, 0], quoteClip, 0)).toBeNull();
	});
});

describe('the declaration, not kind literals, drives the decision', () => {
	const original = {
		blockquote: tryGetBlockKindDescriptor('blockquote')!,
		list: tryGetBlockKindDescriptor('list')!
	};
	afterEach(() => {
		augmentBuiltin('blockquote', {
			container: { containerPaste: original.blockquote.containerPaste }
		});
		augmentBuiltin('list', { container: { containerPaste: original.list.containerPaste } });
	});

	it('a declining matchesAncestor turns off blockquote container-match', () => {
		augmentBuiltin('blockquote', {
			container: { containerPaste: { matchesAncestor: () => false, siblingAbsorb: false } }
		});
		// The same fixture as the passing blockquote case above, now declined.
		const doc = parse('> x\n');
		doc.children[0].children![0].raw = '\n';
		expect(findContainerMatchingUnwrap(doc, [0, 0], 0, parse('> pasted\n'), false)).toBeNull();
	});

	it('an always-true matchesAncestor flips ordered-mismatch from break-out to absorb', () => {
		augmentBuiltin('list', {
			container: { containerPaste: { matchesAncestor: () => true, siblingAbsorb: true } }
		});
		const doc = parse('- a\n- b\n');
		const otherType = parse('1. x\n2. y\n');
		expect(findListAbsorb(doc, [0, 1, 0], otherType, 0)).not.toBeNull();
		expect(findListBreakOut(doc, [0, 1, 0], otherType, 0)).toBeNull();
	});
});
