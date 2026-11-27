// @vitest-environment jsdom
// The keys that renumber an ordered list, over any spelling of its numbers and any item: the items
// above the renumber keep their bytes, and from it on each takes the start or the number above
// plus the step the list's first two numbers gave before the key.
// Miss-analysis: the rule tables drew four-item top-level LF lists in nine fixed spellings, so no
// one-item list, quoted or nested list, lazy line, CRLF ending or missing final ending met a key.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import fc from 'fast-check';
import { metadataOf, type CstNode, type Document } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { freshOrFixedSeed } from '#lib/test/invariants/arbitraries/index.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

beforeAll(installLayoutStubs);

type Seam = { getDocument(): Document };
let mounted: MountedEditor<Seam> | null = null;
afterEach(async () => {
	await mounted?.destroy();
	mounted = null;
});

// ── The lists ───────────────────────────────────────────────────────────────

interface ListShape {
	numbers: number[];
	delimiter: '.' | ')';
	/** The item whose text runs on to an unindented line, or none. */
	lazyAt: number | null;
	/** In a quote, and under a bullet item's text. */
	quoted: boolean;
	nested: boolean;
	crlf: boolean;
	finalEnding: boolean;
}

// Equal numbers and counting runs are how authors write lists. Two equal numbers above free ones
// tell a step read before the edit from one read after it; free numbers find the rest.
const arbNumber = fc.integer({ min: 0, max: 12 });
const arbNumbers = fc.integer({ min: 1, max: 5 }).chain((count) =>
	fc.oneof(
		arbNumber.map((n) => Array<number>(count).fill(n)),
		arbNumber.map((n) => Array.from({ length: count }, (_, i) => n + i)),
		fc
			.tuple(arbNumber, fc.array(arbNumber, { minLength: count, maxLength: count }))
			.map(([n, rest]) => [n, n, ...rest].slice(0, count)),
		fc.array(arbNumber, { minLength: count, maxLength: count })
	)
);

const arbList: fc.Arbitrary<ListShape> = arbNumbers.chain((numbers) =>
	fc.record({
		numbers: fc.constant(numbers),
		delimiter: fc.constantFrom('.' as const, ')' as const),
		lazyAt: fc.option(fc.nat({ max: numbers.length - 1 })),
		quoted: fc.boolean(),
		nested: fc.boolean(),
		crlf: fc.boolean(),
		finalEnding: fc.boolean()
	})
);

/** The list's Markdown and its list node's path; `outer` holds the markers of the list around a
 *  nested one, a second marker opening an item after it. */
function render(
	shape: ListShape,
	outer: [string, string | null] = ['- ', null]
): { source: string; listPath: number[] } {
	// The parser reads a lazy line under a nested item as a paragraph of its own, a known divergence
	// from cmark-gfm, so only a list that opens its container draws one.
	const lazyAt = shape.nested ? null : shape.lazyAt;
	const lines = shape.numbers.flatMap((n, i) => [
		`${n}${shape.delimiter} i${i}`,
		...(lazyAt === i ? [`lazy${i}`] : [])
	]);
	const indent = ' '.repeat(outer[0].length);
	const after = outer[1] === null ? [] : [`${outer[1]}end`];
	// A list starting at any number but 1 can't interrupt a paragraph, so a blank line comes first.
	const nested = shape.nested
		? [`${outer[0]}top`, '', ...lines.map((line) => indent + line), ...after]
		: lines;
	const framed = shape.quoted ? nested.map((line) => (line ? `> ${line}` : '>')) : nested;
	const ending = shape.crlf ? '\r\n' : '\n';
	const listPath = [...(shape.quoted ? [0] : []), ...(shape.nested ? [0, 0, 1] : [0])];
	return { source: framed.join(ending) + (shape.finalEnding ? ending : ''), listPath };
}

// ── The keys ────────────────────────────────────────────────────────────────

type Key = 'enter' | 'backspace' | 'tab' | 'delete' | 'moveUp' | 'moveDown';

/** Where a key leaves the list: its item count, the item the renumber starts at, and how many
 *  items from the top it leaves byte for byte. */
interface Effect {
	count: number;
	from: number;
	untouched: number;
}

/** The effect of `key` on item `k` of a list of `count` items, or null where it has no target. */
function effectOf(key: Key, k: number, count: number): Effect | null {
	switch (key) {
		case 'enter':
			return { count: count + 1, from: k + 1, untouched: k + 1 };
		// Each of these takes an item above to join, nest under or end the range at.
		case 'backspace':
		case 'tab':
			return k === 0 ? null : { count: count - 1, from: k, untouched: k - 1 };
		case 'delete':
			return k === 0 ? null : { count: count - 1, from: k, untouched: k };
		case 'moveUp':
			return k === 0 ? null : { count, from: k - 1, untouched: k - 1 };
		case 'moveDown':
			return k === count - 1 ? null : { count, from: k, untouched: k };
	}
}

const itemsOf = (doc: Document | CstNode, path: number[]): CstNode[] =>
	path.reduce<Document | CstNode>((node, i) => node.children![i], doc).children as CstNode[];

const textEnd = (leaf: CstNode) => leaf.raw.replace(/\r?\n$/, '').length;

async function press(editor: MountedEditor<Seam>, key: Key, item: number[]): Promise<void> {
	const doc = editor.instance.__test.getDocument();
	const leafPath = [...item, 0];
	const leaf = itemsOf(doc, item)[0];
	switch (key) {
		case 'enter':
			await pressKeyAt(editor, leafPath, textEnd(leaf), { key: 'Enter' });
			return;
		case 'backspace':
			await pressKeyAt(editor, leafPath, 0, { key: 'Backspace' });
			return;
		case 'tab':
			await pressKeyAt(editor, leafPath, 0, { key: 'Tab' });
			return;
		case 'moveUp':
		case 'moveDown':
			await pressKeyAt(editor, leafPath, 0, {
				key: key === 'moveUp' ? 'ArrowUp' : 'ArrowDown',
				altKey: true
			});
			return;
		case 'delete': {
			// From the end of the item above to the end of this one: the item goes whole.
			const abovePath = [...item.slice(0, -1), item.at(-1)! - 1, 0];
			const above = itemsOf(doc, item.with(-1, item.at(-1)! - 1))[0];
			await editor.instance.setSelection({
				anchor: { path: abovePath, offset: textEnd(above) },
				focus: { path: leafPath, offset: textEnd(leaf) }
			});
			await editor.settle();
			await pressKey(surfaceAt(editor, leafPath), { key: 'Delete' });
		}
	}
}

// ── The rule ────────────────────────────────────────────────────────────────

/** The numbers a list written as `numbers` shows after a renumber from `from`, `count` items long,
 *  `kept` being the numbers its items above `from` keep. */
function expectedNumbers(numbers: number[], kept: number[], from: number, count: number): number[] {
	const step = numbers.length > 1 && numbers[0] === numbers[1] ? 0 : 1;
	const out = kept.slice(0, from);
	for (let i = from; i < count; i++) out.push(i === 0 ? numbers[0] : out[i - 1] + step);
	return out;
}

const markerOf = (item: CstNode) => metadataOf(item, 'listItem').marker;
const numberOf = (item: CstNode) => parseInt(markerOf(item), 10);
// A last item's line ending follows the list's end, which an Enter or a removal there moves.
const bytesOf = (item: CstNode) => (item.leadingTrivia + item.raw).replace(/\r?\n$/, '');

describe('a renumber keeps the items above it and counts on by the list’s own step', () => {
	it('any key, any item, any spelling and frame', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbList,
				fc.constantFrom<Key>('enter', 'backspace', 'tab', 'delete', 'moveUp', 'moveDown'),
				fc.nat(),
				fc.constantFrom('live' as const, 'source' as const),
				async (shape, key, pick, mode) => {
					const k = pick % shape.numbers.length;
					const effect = effectOf(key, k, shape.numbers.length);
					if (!effect) return;
					await mounted?.destroy();
					takeDevWarns();
					const { source, listPath } = render(shape);
					const editor = mountEditor<Seam>({ source, presentationMode: mode });
					mounted = editor;
					const before = itemsOf(parse(source), listPath);
					expect(before.map(numberOf)).toEqual(shape.numbers);

					await press(editor, key, [...listPath, k]);

					const after = itemsOf(parse(editor.source()), listPath);
					const kept = before.map(numberOf);
					expect(after.map(numberOf)).toEqual(
						expectedNumbers(shape.numbers, kept, effect.from, effect.count)
					);
					expect(after.slice(0, effect.untouched).map(bytesOf)).toEqual(
						before.slice(0, effect.untouched).map(bytesOf)
					);
					expect(after.every((item) => markerOf(item).includes(shape.delimiter))).toBe(true);
					expect(takeDevWarns().map((w) => `${w.tag}: ${w.message}`)).toEqual([]);
				}
			),
			{ numRuns: 200, seed: freshOrFixedSeed(772) }
		);
	}, 300_000);

	// The items below the lifted one go along as a sublist from 1 at their old step, and an ordered
	// list around it numbers on from the lifted item at its own.
	it('Shift+Tab on any nested item', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbList.map((shape) => ({ ...shape, nested: true })),
				fc.nat(),
				fc.option(fc.tuple(arbNumber, fc.boolean())),
				async (shape, pick, ordered) => {
					const count = shape.numbers.length;
					const k = pick % count;
					await mounted?.destroy();
					takeDevWarns();
					const [first, same] = ordered ?? [0, false];
					const outerNumbers = [first, same ? first : first + 1];
					const outer: [string, string | null] = ordered
						? [`${outerNumbers[0]}. `, `${outerNumbers[1]}. `]
						: ['- ', null];
					const { source, listPath } = render(shape, outer);
					const editor = mountEditor<Seam>({ source });
					mounted = editor;
					const before = itemsOf(parse(source), listPath);

					await pressKeyAt(editor, [...listPath, k, 0], 0, { key: 'Tab', shiftKey: true });

					const doc = parse(editor.source());
					const left = k === 0 ? [] : itemsOf(doc, listPath);
					expect(left.map(bytesOf)).toEqual(before.slice(0, k).map(bytesOf));
					const outerItems = itemsOf(doc, listPath.slice(0, -2));
					if (ordered) {
						const outerStep = same ? 0 : 1;
						expect(outerItems.map(numberOf)).toEqual(
							[0, 1, 2].map((i) => outerNumbers[0] + i * outerStep)
						);
					}
					const lifted = outerItems[1];
					const sublist = lifted.children!.at(-1)!;
					const carried = sublist.kind === 'list' ? (sublist.children as CstNode[]) : [];
					const step = count > 1 && shape.numbers[0] === shape.numbers[1] ? 0 : 1;
					expect(carried.map(numberOf)).toEqual(
						Array.from({ length: count - 1 - k }, (_, i) => 1 + i * step)
					);
					expect(takeDevWarns().map((w) => `${w.tag}: ${w.message}`)).toEqual([]);
				}
			),
			{ numRuns: 60, seed: freshOrFixedSeed(7720) }
		);
	}, 300_000);
});
