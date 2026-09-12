// @vitest-environment jsdom
// A range holding one block whole is a range like any other: typing, pasting and cutting over it
// take the block out and land the gesture's own bytes in its slot, leaving both neighbours alone
// and a tree its reload reads back — every kind a drag can take whole, in both line endings. The
// table is absent: its coverage is addressed in cells, and the paste arm reads it by its own rule.
// Miss-analysis: cross-block-typed-char.test.ts drove prose ranges only, where the truncated start
// block survives to hold the caret; nothing asked where the bytes go when the block itself goes.
import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { isBlankParagraph } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { describeConvergence } from '$lib/testing/parse-convergence';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { writeCrossBlockCut } from '$lib/selection/cross-block/clipboard';
import {
	makeEnv,
	makeHandlers,
	makeBeforeInputEvent,
	makePasteEvent
} from './cross-block/typed-char-env';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

const PARAMS = { numRuns: 60, seed: freshOrFixedSeed(515151) } as const;

beforeAll(() => {
	resetPluginPlatformForTests();
	registerMathBlock();
});

// One block of each kind, between two paragraphs whose survival is half the property.
const BLOCKS = {
	code: '```js\nconst a = 1;\n```',
	math: '$$\nx^2\n$$',
	list: '- one\n- two',
	quote: '> quoted line',
	divider: '---',
	image: '![cat](cat.png)',
	html: '<div>\nx\n</div>'
} as const;
type Kind = keyof typeof BLOCKS;

type Gesture = 'printable' | 'paste' | 'cut';
const TYPED = 'x';
const PASTED = 'pasted';

interface Shape {
	kind: Kind;
	eol: '\n' | '\r\n';
}

const arbShape: fc.Arbitrary<Shape> = fc.record({
	kind: fc.constantFrom(...(Object.keys(BLOCKS) as Kind[])),
	eol: fc.constantFrom<'\n' | '\r\n'>('\n', '\r\n')
});

function markdownOf({ kind, eol }: Shape): string {
	const block = BLOCKS[kind].replace(/\n/g, eol);
	return `lead${eol}${eol}${block}${eol}${eol}tail${eol}`;
}

/** Content blocks by kind and bytes; blank paragraphs are separator bookkeeping, not content. */
function contentOf(children: readonly CstNode[]): string[] {
	return children.filter((n) => !isBlankParagraph(n)).map((n) => `${n.kind}:${n.raw.trim()}`);
}

/** The gesture over a whole-unit range on block 1, and the bytes it wrote to the clipboard. */
async function applyGesture(
	md: string,
	gesture: Gesture
): Promise<{ doc: CstNode; copied: string }> {
	const env = makeEnv(md);
	env.selectionState.enterCrossBlock(
		{ path: [1], wholeBlock: true },
		{ path: [1], wholeBlock: true }
	);
	const handlers = makeHandlers(env, [1]);

	let copied = '';
	if (gesture === 'printable') {
		await handlers.handleBeforeInput(makeBeforeInputEvent(TYPED));
	} else if (gesture === 'paste') {
		await handlers.handlePaste(makePasteEvent(PASTED));
	} else {
		const event = {
			preventDefault: () => {},
			clipboardData: { setData: (_type: string, value: string) => (copied = value) }
		} as unknown as ClipboardEvent;
		await writeCrossBlockCut(event, {
			selection: env.selectionState,
			getDoc: () => env.doc,
			crossBlock: handlers
		});
	}
	return { doc: env.doc as unknown as CstNode, copied };
}

/** What the document must hold after the gesture: the block replaced, or gone. */
function expectedContent(gesture: Gesture): string[] {
	if (gesture === 'cut') return ['paragraph:lead', 'paragraph:tail'];
	const landed = gesture === 'printable' ? TYPED : PASTED;
	return ['paragraph:lead', `paragraph:${landed}`, 'paragraph:tail'];
}

describe('a whole-unit range takes typing, paste and cut', () => {
	it('replaces the block it holds, keeps its neighbours, and converges on reload', async () => {
		await fc.assert(
			fc.asyncProperty(arbShape, async (shape) => {
				const md = markdownOf(shape);
				for (const gesture of ['printable', 'paste', 'cut'] as Gesture[]) {
					const { doc, copied } = await applyGesture(md, gesture);
					const label = `${shape.kind} (${JSON.stringify(shape.eol)}) ${gesture}`;

					expect(contentOf(doc.children ?? []), `${label}: wrong blocks`).toEqual(
						expectedContent(gesture)
					);
					expect(describeConvergence(doc as never), `${label}: reload diverges`).toBeNull();

					const out = serialize(doc as never);
					const bare = shape.eol === '\r\n' ? /(^|[^\r])\n/.test(out) : /\r/.test(out);
					expect(bare, `${label}: a line ending the document never used`).toBe(false);

					if (gesture === 'cut') {
						expect(copied, `${label}: the clipboard missed the block`).toBe(
							BLOCKS[shape.kind].replace(/\n/g, shape.eol)
						);
					}
				}
			}),
			PARAMS
		);
	});

	// The parse of the typed character, not a splice into a survivor: a marker typed over the
	// range derives its own kind, exactly as the single-block type path re-derives one.
	it('derives the kind of the character typed over the range', async () => {
		const { doc } = await applyGesture('lead\n\n---\n\ntail\n', 'printable');
		expect(contentOf(doc.children ?? [])).toEqual([
			'paragraph:lead',
			'paragraph:x',
			'paragraph:tail'
		]);

		const env = makeEnv('lead\n\n---\n\ntail\n');
		env.selectionState.enterCrossBlock(
			{ path: [1], wholeBlock: true },
			{ path: [1], wholeBlock: true }
		);
		await makeHandlers(env, [1]).handleBeforeInput(makeBeforeInputEvent('#'));
		expect(env.doc.children[1].kind).toBe('heading');
	});
});
