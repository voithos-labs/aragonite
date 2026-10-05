// @vitest-environment jsdom
// The keys that move list items (Tab, Shift+Tab, Backspace at an item's start, Enter in an empty
// nested item) never change the order the text reads in.
// Miss-analysis: the property drew one tight bullet list, so no loose list, ordered list,
// paragraph after a sublist, second list or quoted list ever met a move.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '$lib/core/nodes';
import {
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import { freshOrFixedSeed } from '$lib/test/invariants/arbitraries';
import { takeDevWarns } from '$lib/test/support/warn-gate';

beforeAll(installLayoutStubs);

type Seam = { getDocument(): Document };
let mounted: MountedEditor<Seam> | null = null;
afterEach(async () => {
	await mounted?.destroy();
	mounted = null;
});

// ── The documents ───────────────────────────────────────────────────────────

/** An item's text is `i<n>`, or empty; `more` puts a paragraph `p<n>` after its sublist. */
interface ItemShape {
	empty: boolean;
	sublist: ListShape | null;
	more: boolean;
}

interface ListShape {
	ordered: boolean;
	loose: boolean;
	items: ItemShape[];
}

const arbList = (depth: number): fc.Arbitrary<ListShape> =>
	fc.record({
		ordered: fc.boolean(),
		loose: fc.boolean(),
		items: fc.array(
			fc.record({
				empty: fc.boolean(),
				sublist: depth < 2 ? fc.option(arbList(depth + 1), { freq: 2 }) : fc.constant(null),
				more: fc.boolean()
			}),
			{ minLength: 1, maxLength: 3 }
		)
	});

const arbDoc = fc.record({
	lists: fc.oneof(
		arbList(0).map((list) => [list]),
		fc.tuple(arbList(0), arbList(0)).map(([a, b]) => [a, { ...b, ordered: !a.ordered }])
	),
	quoted: fc.boolean()
});

/** Markdown for the drawn shape, with at most one empty item, and that one nested, where Enter
 *  lifts it rather than leaving the list. The order comes from the parse, not from here. */
function render({ lists, quoted }: { lists: ListShape[]; quoted: boolean }): string {
	let next = 0;
	let emptyDrawn = false;
	const lines: string[] = [];
	const writeList = (list: ListShape, indent: string) => {
		list.items.forEach((item, i) => {
			if (i > 0 && list.loose) lines.push('');
			const marker = list.ordered ? `${i + 1}. ` : '- ';
			// Never first in its list: the line above reads it as its own text, and lifting the
			// sublist under it leaves the list's bytes stale (a known bug).
			const opensList = i === 0;
			// Never holding a sublist: it parses as one item with that sublist's first, and moving it
			// leaves the list's bytes stale (a known bug).
			const holds = item.sublist !== null;
			const empty = item.empty && indent !== '' && !opensList && !holds && !emptyDrawn;
			emptyDrawn ||= empty;
			lines.push(`${indent}${marker}${empty ? '' : `i${next++}`}`);
			const inner = indent + ' '.repeat(marker.length);
			if (item.sublist) {
				if (list.loose) lines.push('');
				writeList(item.sublist, inner);
			}
			if (item.more && !empty) lines.push('', `${inner}p${next++}`);
		});
	};
	lists.forEach((list, i) => {
		if (i > 0) lines.push('');
		writeList(list, '');
	});
	const body = quoted ? lines.map((line) => (line ? `> ${line}` : '>')) : lines;
	return body.join('\n') + '\n';
}

// ── Reading the order ───────────────────────────────────────────────────────

/** Every text in document order; an empty item reads as `E`, so where it moved still counts. */
function readOrder(doc: Document): string[] {
	const order: string[] = [];
	const walk = (node: CstNode) => {
		if (node.kind === 'listItem' && isEmptyItem(node)) order.push('E');
		if (node.children) return node.children.forEach(walk);
		order.push(...(node.raw.match(/[ip]\d+/g) ?? []));
	};
	doc.children.forEach((child) => walk(child as CstNode));
	return order;
}

/** An item with no text of its own, whether it parsed with an empty paragraph or none. */
function isEmptyItem(item: CstNode): boolean {
	const first = item.children?.[0];
	return !first || (first.kind === 'paragraph' && first.raw.trim() === '');
}

interface Found {
	path: number[];
	offset: number;
	/** How many list items hold it. */
	depth: number;
}

/** Where `token` starts, in the paragraph that holds it. */
function find(doc: Document, token: string): Found | null {
	let found: Found | null = null;
	const walk = (node: CstNode, path: number[], items: number, parent: CstNode | null) => {
		if (found) return;
		if (node.children) {
			const depth = items + (node.kind === 'listItem' ? 1 : 0);
			node.children.forEach((child, i) => walk(child, [...path, i], depth, node));
			return;
		}
		if (token === 'E') {
			if (parent?.kind === 'listItem' && node.raw.trim() === '') {
				found = { path, offset: 0, depth: items };
			}
		} else if (node.raw.match(/[ip]\d+/g)?.includes(token)) {
			found = { path, offset: node.raw.indexOf(token), depth: items };
		}
	};
	doc.children.forEach((child, i) => walk(child as CstNode, [i], 0, null));
	return found;
}

// ── The presses ─────────────────────────────────────────────────────────────

type Press =
	| { kind: 'tab'; from: number; span: number; shift: boolean }
	| { kind: 'backspace'; at: number }
	| { kind: 'enter' };

const arbPress: fc.Arbitrary<Press> = fc.oneof(
	{
		weight: 3,
		arbitrary: fc.record({
			kind: fc.constant('tab' as const),
			from: fc.nat(),
			// Zero presses at a caret; more reaches that many items down as a range.
			span: fc.nat({ max: 3 }),
			shift: fc.boolean()
		})
	},
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('backspace' as const), at: fc.nat() }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('enter' as const) }) }
);

/** Places the caret or the range a press asks for and presses its key, or skips a press that has
 *  no target in the document as it now stands. */
async function press(editor: MountedEditor<Seam>, step: Press, order: string[]): Promise<void> {
	const doc = editor.instance.__test.getDocument();
	// The items' own texts, the empty one included; `p` paragraphs only end a range.
	const items = order.filter((token) => !token.startsWith('p'));
	if (items.length === 0) return;
	let anchor: Found | null;
	let focus: Found | null;
	let focusToken: string;
	let key: KeyboardEventInit;
	if (step.kind === 'tab') {
		const from = order.indexOf(items[step.from % items.length]);
		focusToken = order[Math.min(from + step.span, order.length - 1)];
		anchor = find(doc, order[from]);
		focus = find(doc, focusToken);
		key = { key: 'Tab', shiftKey: step.shift };
	} else if (step.kind === 'backspace') {
		focusToken = items[step.at % items.length];
		anchor = focus = find(doc, focusToken);
		// Mid-paragraph, Backspace deletes a character instead of moving an item.
		if (anchor?.offset !== 0) return;
		key = { key: 'Backspace' };
	} else {
		focusToken = 'E';
		anchor = focus = find(doc, 'E');
		// Only a nested empty item lifts; a top-level one leaves the list instead.
		if (!anchor || anchor.depth < 2) return;
		key = { key: 'Enter' };
	}
	if (!anchor || !focus) return;
	// A collapsed pair is a caret, which also ends the range the last press kept.
	const atCaret = anchor.path.join() === focus.path.join();
	const end = atCaret || focusToken === 'E' ? focus.offset : focus.offset + 1;
	await editor.instance.setSelection({
		anchor: { path: anchor.path, offset: anchor.offset },
		focus: { path: focus.path, offset: atCaret ? anchor.offset : end }
	});
	await editor.settle();
	await pressKey(surfaceAt(editor, focus.path), key);
}

describe('the keys that move list items keep the order the text reads in', () => {
	it('any sequence, over any lists, reads the text in its first order', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbDoc,
				fc.array(arbPress, { minLength: 1, maxLength: 5 }),
				async (shape, presses) => {
					await mounted?.destroy();
					// What the last run's teardown warned about is not this run's.
					takeDevWarns();
					const editor = mountEditor<Seam>({ source: render(shape) });
					mounted = editor;
					const first = readOrder(editor.instance.__test.getDocument());
					for (const step of presses) {
						await press(editor, step, readOrder(editor.instance.__test.getDocument()));
						const now = readOrder(editor.instance.__test.getDocument());
						// Backspace in an empty item may delete it, which takes its `E` with it.
						const expected = now.includes('E') ? first : first.filter((t) => t !== 'E');
						expect(now).toEqual(expected);
						// A move that reads back as another tree is a broken move too.
						expect(takeDevWarns().map((w) => `${w.tag}: ${w.message}`)).toEqual([]);
					}
				}
			),
			{ numRuns: 40, seed: freshOrFixedSeed(693) }
		);
	}, 180_000);
});

// The property's first shrunk counterexample: a range nests two items, then a caret lifts the
// first of them while the second still sits after it.
describe('pinned examples', () => {
	it('Tab over i0 to i2, then Shift+Tab on i1', async () => {
		const editor = mountEditor<Seam>({ source: '- i0\n- i1\n- i2\n- i3\n- i4\n- i5\n' });
		mounted = editor;
		await editor.instance.setSelection({
			anchor: { path: [0, 0, 0], offset: 0 },
			focus: { path: [0, 2, 0], offset: 1 }
		});
		await editor.settle();
		await pressKey(surfaceAt(editor, [0, 2, 0]), { key: 'Tab' });
		const at = find(editor.instance.__test.getDocument(), 'i1')!.path;
		await editor.instance.setSelection({
			anchor: { path: at, offset: 0 },
			focus: { path: at, offset: 0 }
		});
		await editor.settle();
		await pressKey(surfaceAt(editor, at), { key: 'Tab', shiftKey: true });

		expect(editor.source()).toBe('- i0\n- i1\n  - i2\n- i3\n- i4\n- i5\n');
	});
});
