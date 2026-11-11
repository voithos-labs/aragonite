// A keystroke that stays in its leaf keeps no node for its rollback, however long the lists
// around it: each node the commit frame keeps costs a copy of that node's own lists, and the
// second key of a burst writes nodes its undo entry already copied.
// Miss-analysis: the rollback rows count nothing, so a keep that copied a long list's children on
// every key would have passed them all.
import { describe, expect, it } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import type { EditorActionsDeps } from '#lib/editor-actions/deps.js';
import { makeContainerHarness, makeTopHarness } from '#lib/test/harness/editor-actions.js';

const SIBLINGS = 400;
const list = Array.from({ length: SIBLINGS }, () => '- a\n').join('');
const quotedList = Array.from({ length: SIBLINGS }, () => '> - a\n').join('');

type Type = (text: string) => Promise<boolean>;

/** The nodes the second key of a burst keeps: the first key copied all that the second writes. */
async function keptBySecondKey(deps: EditorActionsDeps, type: Type, text: string) {
	expect(await type(`${text}x\n`)).toBe(true);
	const kept: CstNode[] = [];
	const watch = deps.sharing.watchOwned;
	deps.sharing.watchOwned = (keep) =>
		watch((node) => {
			kept.push(node);
			keep(node);
		});
	expect(await type(`${text}xy\n`)).toBe(true);
	return kept.map((node) => `${node.kind} of ${node.children?.length ?? 0}`);
}

/** Types into child `at` of the container at `path`, `-1` being its last child. */
function inContainer(source: string, path: number[], at: number) {
	const h = makeContainerHarness(source, path);
	const index = at < 0 ? h.getNode().children!.length + at : at;
	const type: Type = (text) =>
		h.bundle.blockEdit.updateBlockContent(index, text, 'authored', 'join-typing', text.length - 1);
	return keptBySecondKey(h.deps, type, 'a');
}

describe(`what a keystroke keeps for its rollback, beside ${SIBLINGS} siblings`, () => {
	it('in the middle item of a list', async () => {
		expect(await inContainer(list, [0, SIBLINGS >> 1], 0)).toEqual([]);
	});

	it('in the last item of a list', async () => {
		expect(await inContainer(list, [0, SIBLINGS - 1], 0)).toEqual([]);
	});

	it('in a paragraph under a long list, both in a quote', async () => {
		expect(await inContainer(`${quotedList}>\n> a\n`, [0], -1)).toEqual([]);
	});

	it('in a top-level paragraph between two long lists', async () => {
		const h = makeTopHarness(`${list}\nzz\n\n${list}`);
		const type: Type = (text) =>
			h.actions.updateBlockContent(1, text, 'authored', 'join-typing', text.length - 1);
		expect(await keptBySecondKey(h.deps, type, 'zz')).toEqual([]);
	});
});
