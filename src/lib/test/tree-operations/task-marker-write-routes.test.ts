// @vitest-environment jsdom
// (the paste route commits through a controller that reads the mounted block-list state.)

/**
 * The wiring, not the rule: a task marker stands in front of a paragraph, and three writes can
 * put another block in that position. `reconcile-task.test.ts` covers what the rule decides; each
 * test here fails when its own call site loses the call.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parse, type CstNode, type ListItemMetadata } from '$lib';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { replaceBlockAtParent } from '$lib/tree-operations/paste/replace-block-at-parent';
import { createBlockEditCore } from '$lib/editor-actions/block-edit-core';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	makeCommitScopeStub,
	makePasteCommit,
	registerStubBlockListState
} from '$lib/test/harness/editor-actions';
import { defaultGrammarView } from '$lib/schema/block-openers';

const TABLE = '| a | b |\n| --- | --- |\n';

/** The first list item of a parsed document, which carries the task metadata. */
function todoItem(source: string): CstNode {
	return parse(source).children[0].children![0];
}

const metaOf = (item: CstNode) => item.metadata as ListItemMetadata;

beforeEach(() => {
	resetPluginPlatformForTests();
});

describe('every write that can replace a to-do’s first block drops the marker with it', () => {
	it('the content write, where a typed delimiter row makes the paragraph a table', () => {
		const item = todoItem('- [ ] alpha\n');

		updateNodeContent({ children: item.children!, ownerKind: item.kind, owner: item }, 0, TABLE);

		expect(item.children![0].kind).toBe('table');
		expect(metaOf(item).taskItem).toBe(false);
		expect(metaOf(item).taskMarker).toBeNull();
	});

	it('the content write keeps the marker of a to-do whose text starts with `#`', () => {
		const item = todoItem('- [ ] # alpha\n');

		updateNodeContent(
			{ children: item.children!, ownerKind: item.kind, owner: item },
			0,
			'# alphaX\n'
		);

		expect(metaOf(item).taskItem).toBe(true);
		expect(metaOf(item).taskMarker).toBe('[ ] ');
	});

	it('the block replace, where the Enter completer puts a table in the position', async () => {
		const item = todoItem('- [ ] alpha\n');
		const { scope } = makeCommitScopeStub(item.children!, { owner: item });

		await createBlockEditCore(scope).replaceBlock(0, parse(TABLE).children);

		expect(item.children![0].kind).toBe('table');
		expect(metaOf(item).taskItem).toBe(false);
		expect(metaOf(item).taskMarker).toBeNull();
	});

	it('the paste splice, where the clipboard lands a table over the paragraph', async () => {
		const { doc, controller } = makePasteCommit('- [ ] alpha\n');
		registerStubBlockListState(doc.children[0].children![0]);

		await replaceBlockAtParent({
			grammar: defaultGrammarView,
			doc,
			blockPath: [0, 0, 0],
			replacement: parse(TABLE).children,
			controller,
			undoEntry: 'own',
			focusReplacementIndex: 0,
			focusOffset: 0,
			source: 'paste-dispatch'
		});

		const item = doc.children[0].children![0];
		expect(item.children![0].kind).toBe('table');
		expect(metaOf(item).taskItem).toBe(false);
		expect(metaOf(item).taskMarker).toBeNull();
	});
});
