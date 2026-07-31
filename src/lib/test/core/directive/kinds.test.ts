import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CstNode } from '$lib/core/nodes';
import { setPluginMetadata } from '$lib/core/nodes';
import { declaredPluginKind } from '$lib/schema/plugin-kind';
import { getBlockKindDescriptor, isBlockKindRegistered } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import {
	DIRECTIVE_CONTAINER,
	DIRECTIVE_LEAF,
	registerDirectiveKinds,
	rebuildDirectiveContainerRaw,
	type DirectiveContainerMetadata
} from '$lib/core/directive/kinds';

describe('registerDirectiveKinds', () => {
	afterEach(() => __resetSchemaRegistriesForTests());

	it('registers the generic container and leaf fallback kinds', () => {
		registerDirectiveKinds();
		expect(isBlockKindRegistered(DIRECTIVE_CONTAINER)).toBe(true);
		expect(isBlockKindRegistered(DIRECTIVE_LEAF)).toBe(true);
	});

	it('is idempotent — a re-import re-runs it without throwing', () => {
		registerDirectiveKinds();
		expect(() => registerDirectiveKinds()).not.toThrow();
		expect(isBlockKindRegistered(DIRECTIVE_CONTAINER)).toBe(true);
	});
});

// The `::name` fence dims through the heading's marker-prefix mechanism, extended here to
// a non-prose kind.
describe('directiveLeaf render descriptor', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerDirectiveKinds();
	});
	afterEach(() => __resetSchemaRegistriesForTests());

	const leaf = () => getBlockKindDescriptor(declaredPluginKind(DIRECTIVE_LEAF));

	it('marks `::name` as the content-range prefix so only the fence dims', () => {
		const node: CstNode = {
			kind: declaredPluginKind(DIRECTIVE_LEAF),
			leadingTrivia: '',
			raw: '::toc info\n'
		};
		// `::toc` (5) dims; ` info` (5..10) is the editable content.
		expect(leaf().getContentRange!(node)).toEqual({ start: 5, end: 10 });
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

// The losslessness pin: the opener writes `raw` verbatim, so only the inverse — rebuild
// from the captured metadata + children after a structural edit — can prove the capture.
describe('rebuildDirectiveContainerRaw', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerDirectiveKinds();
	});
	afterEach(() => __resetSchemaRegistriesForTests());

	const build = (
		meta: DirectiveContainerMetadata,
		fields: Pick<CstNode, 'innerPrefix' | 'children' | 'innerSuffix'>
	): CstNode => {
		const node: CstNode = {
			kind: declaredPluginKind(DIRECTIVE_CONTAINER),
			leadingTrivia: '',
			raw: '',
			...fields
		};
		setPluginMetadata<DirectiveContainerMetadata>(node, meta);
		return node;
	};

	const paragraph = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

	it('re-emits opener colons, verbatim info, inner trivia, and the closer', () => {
		const node = build(
			{
				name: 'x',
				colonCount: 3,
				info: ' t',
				closerColonCount: 3,
				closerNewline: true,
				lineEnding: '\n'
			},
			{ innerPrefix: '\n', children: [paragraph('body\n')], innerSuffix: '\n' }
		);
		rebuildDirectiveContainerRaw(node);
		expect(node.raw).toBe(':::x t\n\nbody\n\n:::\n');
	});

	it('widens the opener and closer to a deeper colon count', () => {
		const node = build(
			{
				name: 'x',
				colonCount: 4,
				info: '',
				closerColonCount: 4,
				closerNewline: true,
				lineEnding: '\n'
			},
			{ innerPrefix: '', children: [paragraph('body\n')], innerSuffix: '' }
		);
		rebuildDirectiveContainerRaw(node);
		expect(node.raw).toBe('::::x\nbody\n::::\n');
	});

	it('drops the closer newline for a document-final directive', () => {
		const node = build(
			{
				name: 'x',
				colonCount: 3,
				info: '',
				closerColonCount: 3,
				closerNewline: false,
				lineEnding: '\n'
			},
			{ innerPrefix: '', children: [paragraph('body\n')], innerSuffix: '' }
		);
		rebuildDirectiveContainerRaw(node);
		expect(node.raw).toBe(':::x\nbody\n:::');
	});
});
