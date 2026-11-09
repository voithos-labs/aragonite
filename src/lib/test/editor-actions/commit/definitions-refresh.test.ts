// Miss-analysis: every rescan test asked by op name, and no row drove a byte splice, which names any op.
// Link definitions are read again after a write only when a block it took out or put in holds one:
// each route that emits `edit` says which blocks it replaced, or that it can't tell.

import { describe, expect, it } from 'vitest';
import { lrdMapCouldChange } from '#lib/components/link-reference-map.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { createSearchReplace } from '#lib/editor-actions/search-replace.js';
import { makeNestedHarness, makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { changesBetween, type ByteChange } from '#lib/tree-operations/byte-changes.js';
import { createGrammarView } from '#lib/schema/block-openers.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { assignIds } from '#lib/block-id.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import type { EditEvent } from '#lib/editor-events.js';

type Harness = Pick<ReturnType<typeof makeTopHarness>, 'events' | 'replaced'>;

const last = new Map<Harness, EditEvent>();
function watched<H extends Harness>(h: H): H {
	h.events.on('edit', (e) => last.set(h, e));
	return h;
}

/** Whether the last write read the definitions again. */
function rescans(h: Harness): boolean {
	return lrdMapCouldChange(h.replaced.at(-1)!);
}

// A draft's write, and one naming a keystroke's op: the answer comes from the bytes, not the name.
const SPLICE_OPS = [
	{ kind: 'replaceBlock', detail: { source: 'draft' } },
	{ kind: 'input' }
] as const;

/** `source` spliced to `after` through the byte splice, by `changes` when they're given. */
async function spliced(
	source: string,
	after: string,
	op: (typeof SPLICE_OPS)[number] = SPLICE_OPS[0],
	changes: readonly ByteChange[] = changesBetween(source, after)
): Promise<ReturnType<typeof makeTopHarness>> {
	const h = watched(makeTopHarness(source));
	const wrote = await h.controller.commitSource({
		changes,
		caret: 'keep',
		op,
		snapshot: { path: docPathFrom([0]), offset: 0 }
	});
	expect(wrote).toBe(true);
	expect(serialize(h.deps.doc)).toBe(after);
	return h;
}

// A definition whose destination sits in a quote inside its item, and the same item freed of it.
const QUOTED = '- a\n- b\n- [x]:\n  > /u\n- d\n';
const FREED = '- a\n- b\n- [x]:\n  /u\n- d\n';
// Two changes, so neither writes nor takes the `[x]:` line, which would read the whole list again.
const ADD_AND_FREE: ByteChange[] = [
	{ from: QUOTED.indexOf('\n- [x]'), to: QUOTED.indexOf('\n- [x]'), insert: '\n- c' },
	{ from: QUOTED.indexOf('> '), to: QUOTED.indexOf('> ') + 2, insert: '' }
];

describe.each(SPLICE_OPS)('a byte splice named $kind', (op) => {
	it.each([
		['a paragraph', 'one\n\n[x]: /u\n\ntwo\n', 'one\n\n[x]: /u\n\ntwoo\n'],
		[
			'a long list, item by item',
			'- a\n- b\n- c\n- d\n\n[x]: /u\n',
			'- a\n- b\n- cc\n- d\n\n[x]: /u\n'
		]
	])('text spliced into %s reads no definitions', async (_, source, after) => {
		expect(rescans(await spliced(source, after, op))).toBe(false);
	});

	it.each([
		['writing one', 'one\n\ntwo\n', 'one\n\n[y]: /v\n\ntwo\n'],
		['taking one', 'one\n\n[x]: /u\n\ntwo\n', 'one\n\ntwo\n'],
		['editing its destination', 'one\n\n[x]: /u\n', 'one\n\n[x]: /uu\n'],
		// Each writes and takes no `]:`, and the block at the change was no definition.
		['finishing its title on the next line', '[x]: /u\n"tit\n', '[x]: /u\n"title"\n'],
		['freeing its destination from a quote', '[x]:\n> quote\n', '[x]:\nquote\n'],
		['freeing its destination from a list', '[x]:\n- /u\n', '[x]:\n/u\n']
	])('%s reads the definitions', async (_, source, after) => {
		expect(rescans(await spliced(source, after, op))).toBe(true);
	});

	// Inside a list the splice reads a few items again, so each side of that read is asked.
	it.each([
		['freeing a destination inside an item', QUOTED, FREED, undefined],
		['quoting the destination an item read', FREED, QUOTED, undefined],
		[
			'adding an item above one it frees',
			QUOTED,
			'- a\n- b\n- c\n- [x]:\n  /u\n- d\n',
			ADD_AND_FREE
		]
	])('%s reads the definitions from the items it read again', async (_, source, after, changes) => {
		const h = await spliced(source, after, op, changes);
		const replaced = h.replaced.at(-1)!;
		expect(replaced !== 'unknown' && replaced.before.every((b) => b.kind === 'listItem')).toBe(
			true
		);
		expect(rescans(h)).toBe(true);
	});

	it('inside a long list names the items it read again, not the list', async () => {
		const h = await spliced('- a\n- b\n- c\n- d\n', '- a\n- b\n- cc\n- d\n', op);
		const replaced = h.replaced.at(-1)!;
		const blocks = replaced === 'unknown' ? [] : [...replaced.before, ...replaced.after];
		expect(blocks.length).toBeGreaterThan(0);
		expect(blocks.every((block) => block.kind === 'listItem')).toBe(true);
	});
});

describe('typing in place reads them only in a definition', () => {
	it.each([
		['a paragraph beside one', 'see [x][x]\n\n[x]: /u\n', 0, 'see [x][x]!\n', false],
		['a definition', 'see [x][x]\n\n[x]: /u\n', 1, '[x]: /uu\n', true]
	])('%s', async (_, source, index, text, expected) => {
		const h = watched(makeTopHarness(source));
		await h.actions.updateBlockContent(index, text, 'authored', 'join-typing', 1);
		expect(last.get(h)?.op).toBe('input');
		expect(rescans(h)).toBe(expected);
	});

	it.each([
		['a paragraph inside a quote', '> see [d][d]\n', 'see [d][d]!\n', false],
		['a definition inside a quote', '> [a]: /url\n', '[a]: /url2\n', true]
	])('%s', async (_, source, text, expected) => {
		const h = watched(makeNestedHarness(source, { index: 0 }));
		await h.bundle.blockEdit.updateBlockContent(0, text, 'authored', 'join-typing', 1);
		expect(last.get(h)?.op).toBe('input');
		expect(rescans(h)).toBe(expected);
	});
});

describe('a structural commit', () => {
	it("checking a to-do beside a definition reads none: only the item's own line changed", async () => {
		const h = watched(makeNestedHarness('- [ ] a\n- [ ] b\n\n[x]: /u\n', { index: 0 }));
		await h.bundle.blockEdit.updateBlockMetadata(1, { taskChecked: true, taskMarker: '[x] ' });
		expect(serialize(h.deps.doc)).toBe('- [ ] a\n- [x] b\n\n[x]: /u\n');
		expect(last.get(h)?.op).toBe('metadataUpdate');
		expect(rescans(h)).toBe(false);
	});

	it('one that splices a list reads them', async () => {
		const h = watched(makeTopHarness('one\n\n[x]: /u\n'));
		await h.controller.commitStructural({
			snapshot: { path: docPathFrom([0]), offset: 0 },
			op: { kind: 'delete', eventPath: docPathFrom([1]) },
			mutate: (children) => {
				children.splice(1, 1);
				return { op: 'delete', at: 1, count: 1 };
			}
		});
		expect(serialize(h.deps.doc)).toBe('one\n');
		expect(rescans(h)).toBe(true);
	});

	it('one that owns a list and drops the item holding one reads them', async () => {
		const h = watched(makeTopHarness('- a\n- [x]: /u\n\nb\n'));
		await h.controller.commitStructural({
			snapshot: { path: docPathFrom([0]), offset: 0 },
			op: { kind: 'delete', eventPath: docPathFrom([0]) },
			mutate: (_, scope) => {
				const [list] = scope.own([0]);
				list.children = list.children!.slice(0, 1);
				list.childIds = list.childIds?.slice(0, 1);
				return { op: 'noop' };
			}
		});
		expect(serialize(h.deps.doc)).toBe('- a\n\nb\n');
		expect(rescans(h)).toBe(true);
	});

	it('one that writes a leaf, with no change of its own, reads them', async () => {
		const h = watched(makeTopHarness('a\n\nb\n'));
		await h.controller.commitStructural({
			snapshot: { path: docPathFrom([0]), offset: 0 },
			op: { kind: 'updateContent', eventPath: docPathFrom([1]), detail: { length: 8 } },
			mutate: (_, scope) => {
				scope.writeLeaf([1], '[y]: /v\n');
				return { op: 'noop' };
			}
		});
		expect(serialize(h.deps.doc)).toBe('a\n\n[y]: /v\n');
		expect(rescans(h)).toBe(true);
	});

	it('replace-all reads them', async () => {
		const h = watched(makeTopHarness('one [x]\n\n[x]: /u\n'));
		const search = createSearchReplace(h.deps, h.controller);
		expect(await search.replaceAll([{ path: [0], start: 0, end: 3 }] as never, 'two')).toBe(1);
		expect(last.get(h)?.op).toBe('replaceBlock');
		expect(rescans(h)).toBe(true);
	});
});

const withoutIndentedCode = createGrammarView((key) => key !== 'indentedCode');

describe('an undo', () => {
	it('of a definition edit reads them', async () => {
		const h = await spliced('one\n\n[x]: /u\n', 'one\n\n[x]: /uu\n');
		await createHistoryActions(h.deps, h.controller).requestUndo();
		expect(serialize(h.deps.doc)).toBe('one\n\n[x]: /u\n');
		expect(last.get(h)?.op).toBe('undo');
		expect(rescans(h)).toBe(true);
	});

	// Under another grammar the undo reads its entry's bytes again, so it names the blocks it read.
	it.each([
		['one that left them alone', '[x]: /u\n\n    one\n', '[x]: /u\n\n    one!\n', false],
		['a definition edit', '    one\n\n[x]: /u\n', '    one\n\n[x]: /uu\n', true]
	])('under another grammar, of %s', async (_, source, after, expected) => {
		const h = await spliced(source, after);
		h.deps.reading = fixtureReading({ grammar: withoutIndentedCode });
		const reread = parse(serialize(h.deps.doc), { grammar: withoutIndentedCode });
		h.deps.setDoc(reread);
		h.deps.setBlockIds(assignIds(reread.children));
		await createHistoryActions(h.deps, h.controller).requestUndo();
		expect(serialize(h.deps.doc)).toBe(source);
		expect(h.replaced.at(-1)).not.toBe('unknown');
		expect(rescans(h)).toBe(expected);
	});
});
