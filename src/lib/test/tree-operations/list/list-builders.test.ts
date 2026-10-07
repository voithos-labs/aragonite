import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	assembleListHalf,
	buildListItemWithContent,
	splitLeafForPaste
} from '$lib/tree-operations/list/list-builders';
import { fragmentReaderAt } from '$lib/tree-operations/list/task-paragraph';
import { fixtureGrammar } from '$lib/test/harness/fixture-grammar';
import type { CstNode } from '$lib/core/nodes';
import { defaultGrammarView } from '$lib/schema/block-openers';

/** Both halves read as plain fragments, as they do outside a task item. */
const plainHalves = {
	leading: fragmentReaderAt(undefined, 0, defaultGrammarView),
	trailing: fragmentReaderAt(undefined, 0, defaultGrammarView)
};

describe('list-builders', () => {
	it('buildListItemWithContent inherits template metadata + sets marker raw via rebuild', () => {
		const tplItem = parse('1. tmpl\n').children[0].children![0];
		const para: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'X\n' };
		const newItem = buildListItemWithContent(tplItem, [para], fixtureGrammar);
		expect(newItem.kind).toBe('listItem');
		expect(newItem.metadata).toMatchObject({ marker: '1. ' });
		expect(newItem.raw).toBe('1. X\n');
	});

	it('assembleListHalf renumbers ordered halves starting at the given number', () => {
		const tplList = parse('1. a\n2. b\n').children[0];
		const items = [
			buildListItemWithContent(
				tplList.children![0],
				[{ kind: 'paragraph', leadingTrivia: '', raw: 'x\n' }],
				fixtureGrammar
			),
			buildListItemWithContent(
				tplList.children![0],
				[{ kind: 'paragraph', leadingTrivia: '', raw: 'y\n' }],
				fixtureGrammar
			)
		];
		const half = assembleListHalf(tplList, items, 5);
		expect(half.children![0].metadata).toMatchObject({ marker: '5. ' });
		expect(half.children![1].metadata).toMatchObject({ marker: '6. ' });
	});

	it('assembleListHalf leaves marker untouched on unordered template even when startNumber != 1', () => {
		const tplList = parse('- a\n- b\n').children[0];
		const items = [
			buildListItemWithContent(
				tplList.children![0],
				[{ kind: 'paragraph', leadingTrivia: '', raw: 'x\n' }],
				fixtureGrammar
			),
			buildListItemWithContent(
				tplList.children![0],
				[{ kind: 'paragraph', leadingTrivia: '', raw: 'y\n' }],
				fixtureGrammar
			)
		];
		const half = assembleListHalf(tplList, items, 7);
		expect(half.children![0].metadata).toMatchObject({ marker: '- ' });
		expect(half.children![1].metadata).toMatchObject({ marker: '- ' });
	});

	it('splitLeafForPaste splits raw at offset and keeps every byte', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello world\n' };
		const { leadingNode, trailingNodes, lineEnding } = splitLeafForPaste(
			leaf,
			5,
			'\n',
			undefined,
			plainHalves
		);
		expect(leadingNode!.raw).toBe('Hello\n');
		expect(trailingNodes[0].raw).toBe(' world\n');
		expect(lineEnding).toBe('\n');
	});

	it('splitLeafForPaste at offset 0 returns null leadingNode and full trailing slice', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' };
		const { leadingNode, trailingNodes, lineEnding } = splitLeafForPaste(
			leaf,
			0,
			'\n',
			undefined,
			plainHalves
		);
		expect(leadingNode).toBeNull();
		expect(trailingNodes[0].raw).toBe('Hello\n');
		expect(lineEnding).toBe('\n');
	});

	it('splitLeafForPaste at end of content returns no trailing nodes and the full leading slice', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' };
		const { leadingNode, trailingNodes, lineEnding } = splitLeafForPaste(
			leaf,
			5,
			'\n',
			undefined,
			plainHalves
		);
		expect(leadingNode!.raw).toBe('Hello\n');
		expect(trailingNodes).toEqual([]);
		expect(lineEnding).toBe('\n');
	});

	it('splitLeafForPaste preserves \\r\\n line ending when leaf raw is CRLF', () => {
		const leaf: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'Hello world\r\n' };
		const { leadingNode, trailingNodes, lineEnding } = splitLeafForPaste(
			leaf,
			5,
			'\n',
			undefined,
			plainHalves
		);
		expect(lineEnding).toBe('\r\n');
		expect(leadingNode!.raw.endsWith('\r\n')).toBe(true);
		expect(trailingNodes[0].raw.endsWith('\r\n')).toBe(true);
	});
});
