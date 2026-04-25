// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import {
	buildListHalf,
	buildListItemWithContent,
	orderedBaseOf,
	parseFirstBlock,
	readOrderedSuffix,
	splitLeafRawAtCaret,
	findEnclosingListForPaste
} from '$lib/editor/tree-operations/list/list-builders';
import type { CstNode } from '$lib/editor/core/nodes';

describe('list-builders', () => {
	it('parseFirstBlock returns first block of parsed input', () => {
		const node = parseFirstBlock('# Heading\n');
		expect(node.kind).toBe('heading');
	});

	it('parseFirstBlock falls back to paragraph when input is empty', () => {
		const node = parseFirstBlock('');
		expect(node.kind).toBe('paragraph');
	});

	it('orderedBaseOf reads numeric prefix; defaults to 1', () => {
		expect(orderedBaseOf({ kind: 'listItem', leadingTrivia: '', raw: '', metadata: { marker: '5. ' } } as CstNode)).toBe(5);
		expect(orderedBaseOf({ kind: 'listItem', leadingTrivia: '', raw: '', metadata: { marker: '- ' } } as CstNode)).toBe(1);
		expect(orderedBaseOf(undefined)).toBe(1);
	});

	it('readOrderedSuffix reads suffix from list first item', () => {
		const list = parse('1. a\n').children[0];
		expect(readOrderedSuffix(list)).toBe('. ');
	});

	it('buildListItemWithContent inherits template metadata + sets marker raw via rebuild', () => {
		const tplItem = parse('1. tmpl\n').children[0].children![0];
		const para: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'X\n' };
		const newItem = buildListItemWithContent(tplItem, [para]);
		expect(newItem.kind).toBe('listItem');
		expect(newItem.metadata).toMatchObject({ marker: '1. ' });
		expect(newItem.raw).toBe('1. X\n');
	});

	it('buildListHalf renumbers ordered halves starting at the given number', () => {
		const tplList = parse('1. a\n2. b\n').children[0];
		const items = [
			buildListItemWithContent(tplList.children![0], [{ kind: 'paragraph', leadingTrivia: '', raw: 'x\n' }]),
			buildListItemWithContent(tplList.children![0], [{ kind: 'paragraph', leadingTrivia: '', raw: 'y\n' }])
		];
		const half = buildListHalf(tplList, items, 5);
		expect(half.children![0].metadata).toMatchObject({ marker: '5. ' });
		expect(half.children![1].metadata).toMatchObject({ marker: '6. ' });
	});

	it('splitLeafRawAtCaret splits raw at offset and trims trailing leading whitespace', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello world\n' };
		const { leadingNode, trailingNode, lineEnding } = splitLeafRawAtCaret(leaf, 5);
		expect(leadingNode!.raw).toBe('Hello\n');
		expect(trailingNode!.raw).toBe('world\n');
		expect(lineEnding).toBe('\n');
	});

	it('findEnclosingListForPaste finds nearest list ancestor', () => {
		const doc = parse('- a\n- b\n');
		const result = findEnclosingListForPaste(doc, [0, 0, 0]);
		expect(result).not.toBeNull();
		expect(result!.itemIndex).toBe(0);
		expect(result!.innerIndex).toBe(0);
		expect(result!.listPath).toEqual([0]);
	});

	it('findEnclosingListForPaste returns null when no list ancestor exists', () => {
		const doc = parse('paragraph\n');
		const result = findEnclosingListForPaste(doc, [0]);
		expect(result).toBeNull();
	});
});
