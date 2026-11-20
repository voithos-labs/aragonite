import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import {
	assembleListHalf,
	buildListItemWithContent
} from '#lib/tree-operations/list/list-builders.js';
import { fixtureGrammar } from '#lib/test/harness/fixture-grammar.js';
import type { CstNode } from '#lib/core/nodes.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

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
		const half = assembleListHalf(tplList, items, 5, defaultGrammarView);
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
		const half = assembleListHalf(tplList, items, 7, defaultGrammarView);
		expect(half.children![0].metadata).toMatchObject({ marker: '- ' });
		expect(half.children![1].metadata).toMatchObject({ marker: '- ' });
	});
});
