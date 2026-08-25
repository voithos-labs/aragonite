// @vitest-environment jsdom
//
// The toolbar's pressed-state read over a range is memoised per (selection, content version), so
// four buttons cost one decomposition. The memo is only sound while both halves of that key
// invalidate it, which is what the two invalidation cases below pin.
import { describe, it, expect } from 'vitest';
import { listInlineMarks } from '$lib/schema/inline-construct-policy';
import { crossBlockActiveFormats } from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';
import { makeKeydownEnv } from './keydown-env';

const MARKS = listInlineMarks();

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** Documents whose spans disagree with each other, so an answer that ignored a block would show.
 *  The last is the one the pairs below DISAGREE on: without it a selection-blind memo agrees
 *  everywhere and the sweep says nothing about the selection half of the key. */
const CORPUS = [
	'**alpha**\n\n**beta**\n',
	'**alpha**\n\nbeta\n',
	'*alpha*\n\n~~beta~~\n\n`gamma`\n',
	'**alpha _one_**\n\n**beta**\n',
	'```\nx = 1\n```\n\n**beta**\n',
	'**alpha**\n\n**beta**\n\ngamma\n'
];

/** Cross-block pairs only: a range inside one block never reaches this arm — the focused surface
 *  answers its own pressed state. */
const PAIRS: [SelectionPoint, SelectionPoint][] = [
	[at([0], 0), at([1], 4)],
	[at([0], 2), at([1], 2)],
	[at([0], 1), at([2], 3)]
];

describe('the memoised pressed-state read answers the unmemoised one', () => {
	for (const source of CORPUS) {
		it(`agrees on every mark and pair for ${JSON.stringify(source)}`, () => {
			const env = makeKeydownEnv(source);
			for (const [start, end] of PAIRS) {
				if (end.path[0] >= env.doc.children.length) continue;
				env.selection.enterCrossBlock(start, end);
				const expected = crossBlockActiveFormats(env.doc, start, end);
				for (const { kind, mark } of MARKS) {
					expect(env.crossBlockCommands.isActive(mark.command), `${kind} on ${source}`).toBe(
						expected.has(kind)
					);
				}
			}
		});
	}
});

describe('the memo invalidates', () => {
	const strong = MARKS.find((entry) => entry.kind === 'strong')!;
	const isStrong = (env: ReturnType<typeof makeKeydownEnv>) =>
		env.crossBlockCommands.isActive(strong.mark.command);

	it('when the content version moves under an unchanged selection', () => {
		const env = makeKeydownEnv('**alpha**\n\n**beta**\n');
		env.selection.enterCrossBlock(at([0], 0), at([1], 8));
		expect(isStrong(env)).toBe(true);

		// A byte-writing door's two halves, split apart: the write, then the announcement.
		env.doc.children[1].raw = 'beta\n';
		expect(isStrong(env)).toBe(true);

		env.deps.bumpContentVersion();
		expect(isStrong(env)).toBe(false);
	});

	it('when the selection moves under an unchanged document', () => {
		const env = makeKeydownEnv('**alpha**\n\n**beta**\n\ngamma\n');
		env.selection.enterCrossBlock(at([0], 0), at([1], 8));
		expect(isStrong(env)).toBe(true);

		env.selection.enterCrossBlock(at([0], 0), at([2], 5));
		expect(isStrong(env)).toBe(false);
	});
});
