// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	assembleListHalf,
	buildListItemWithContent,
	splitLeafForPaste
} from '$lib/tree-operations/list/list-builders';
import type { CstNode } from '$lib/core/nodes';

describe('list-builders', () => {
	it('buildListItemWithContent inherits template metadata + sets marker raw via rebuild', () => {
		const tplItem = parse('1. tmpl\n').children[0].children![0];
		const para: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'X\n' };
		const newItem = buildListItemWithContent(tplItem, [para]);
		expect(newItem.kind).toBe('listItem');
		expect(newItem.metadata).toMatchObject({ marker: '1. ' });
		expect(newItem.raw).toBe('1. X\n');
	});

	it('assembleListHalf renumbers ordered halves starting at the given number', () => {
		const tplList = parse('1. a\n2. b\n').children[0];
		const items = [
			buildListItemWithContent(tplList.children![0], [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'x\n' }
			]),
			buildListItemWithContent(tplList.children![0], [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'y\n' }
			])
		];
		const half = assembleListHalf(tplList, items, 5);
		expect(half.children![0].metadata).toMatchObject({ marker: '5. ' });
		expect(half.children![1].metadata).toMatchObject({ marker: '6. ' });
	});

	it('assembleListHalf leaves marker untouched on unordered template even when startNumber != 1', () => {
		const tplList = parse('- a\n- b\n').children[0];
		const items = [
			buildListItemWithContent(tplList.children![0], [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'x\n' }
			]),
			buildListItemWithContent(tplList.children![0], [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'y\n' }
			])
		];
		const half = assembleListHalf(tplList, items, 7);
		expect(half.children![0].metadata).toMatchObject({ marker: '- ' });
		expect(half.children![1].metadata).toMatchObject({ marker: '- ' });
	});

	it('splitLeafForPaste splits raw at offset and trims trailing leading whitespace', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello world\n' };
		const { leadingNode, trailingNode, lineEnding } = splitLeafForPaste(leaf, 5);
		expect(leadingNode!.raw).toBe('Hello\n');
		expect(trailingNode!.raw).toBe('world\n');
		expect(lineEnding).toBe('\n');
	});

	it('splitLeafForPaste at offset 0 returns null leadingNode and full trailing slice', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' };
		const { leadingNode, trailingNode, lineEnding } = splitLeafForPaste(leaf, 0);
		expect(leadingNode).toBeNull();
		expect(trailingNode!.raw).toBe('Hello\n');
		expect(lineEnding).toBe('\n');
	});

	it('splitLeafForPaste at end of content returns null trailingNode and full leading slice', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' };
		const { leadingNode, trailingNode, lineEnding } = splitLeafForPaste(leaf, 5);
		expect(leadingNode!.raw).toBe('Hello\n');
		expect(trailingNode).toBeNull();
		expect(lineEnding).toBe('\n');
	});

	it('splitLeafForPaste preserves \\r\\n line ending when leaf raw is CRLF', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello world\r\n' };
		const { leadingNode, trailingNode, lineEnding } = splitLeafForPaste(leaf, 5);
		expect(lineEnding).toBe('\r\n');
		expect(leadingNode!.raw.endsWith('\r\n')).toBe(true);
		expect(trailingNode!.raw.endsWith('\r\n')).toBe(true);
	});
});
