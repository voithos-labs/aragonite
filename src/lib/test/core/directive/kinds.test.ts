import { beforeEach, describe, expect, it } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { declaredPluginKind } from '#lib/schema/plugin-kind.js';
import {
	getBlockKindDescriptor,
	isBlockKindRegistered
} from '#lib/schema/block-kind-descriptor.js';
import {
	DIRECTIVE_CONTAINER,
	DIRECTIVE_LEAF,
	registerDirectiveKinds
} from '#lib/core/directive/kinds.js';
import { testDirectiveViews } from '#lib/test/harness/test-view.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { readBlocks } from '#lib/core/parser.js';

describe('registerDirectiveKinds', () => {
	it('registers the generic container and leaf fallback kinds', () => {
		registerDirectiveKinds(testDirectiveViews());
		expect(isBlockKindRegistered(DIRECTIVE_CONTAINER)).toBe(true);
		expect(isBlockKindRegistered(DIRECTIVE_LEAF)).toBe(true);
	});

	it('is idempotent: a re-import re-runs it without throwing', () => {
		registerDirectiveKinds(testDirectiveViews());
		expect(() => registerDirectiveKinds(testDirectiveViews())).not.toThrow();
		expect(isBlockKindRegistered(DIRECTIVE_CONTAINER)).toBe(true);
	});
});

// The `::name` fence dims through the heading's marker-prefix mechanism, extended here to
// a non-prose kind.
describe('directiveLeaf render descriptor', () => {
	beforeEach(() => {
		registerDirectiveKinds(testDirectiveViews());
	});

	const leaf = () => getBlockKindDescriptor(declaredPluginKind(DIRECTIVE_LEAF));

	it('marks `::name` and its space as the content-range prefix so only the fence dims', () => {
		const node: CstNode = {
			kind: declaredPluginKind(DIRECTIVE_LEAF),
			leadingTrivia: '',
			raw: '::toc info\n'
		};
		// `::toc ` (6) dims; `info` (6..10) is the editable content.
		expect(leaf().getContentRange!(node)).toEqual({ start: 6, end: 10 });
	});

	it('spans the whole line when the info is empty', () => {
		const node: CstNode = {
			kind: declaredPluginKind(DIRECTIVE_LEAF),
			leadingTrivia: '',
			raw: '::toc\n'
		};
		expect(leaf().getContentRange!(node)).toEqual({ start: 5, end: 5 });
	});

	it('binds Enter to a paragraph split and Backspace/Delete to the not-mergeable walk', () => {
		const command = (chord: string) => leaf().keymap?.find((b) => b.chord === chord)?.command;
		expect(command('Enter')).toBe('block.split');
		expect(command('Backspace')).toBe('block.mergePrev');
		expect(command('Delete')).toBe('block.mergeNext');
	});
});

// The losslessness pin: the writer gives a parse's bytes back from the children and the bytes it
// replaces, opener colons, info, inner blank lines and the closing line included.
describe('the colon writer', () => {
	beforeEach(() => {
		registerDirectiveKinds(testDirectiveViews());
	});

	it.each([
		[':::x t\n\nbody\n\n:::\n', 'the opener colons, its info, inner blank lines and the closer'],
		['::::x\nbody\n::::\n', "the opener line's own colon count"],
		[':::x\nbody\n:::', 'no closer newline for a document-final directive']
	])('gives back %j: %s', (source) => {
		const node = readBlocks(source, { grammar: defaultGrammarView, scope: 'fragment' }).children[0];
		expect(node.kind).toBe(DIRECTIVE_CONTAINER);
		writeContainerRaw(node, defaultGrammarView);
		expect(node.raw).toBe(source);
	});
});
