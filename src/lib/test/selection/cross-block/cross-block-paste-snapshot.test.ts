// @vitest-environment jsdom
// A paste over a range across blocks is the removal's commit and then the paste's, and the paste's
// commit names a block of the document the removal left.
// Miss-analysis: the paste suites ranged over blocks the removal kept, so no commit named a path
// the removal had taken, and only the e2e console gate saw the path that didn't resolve.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { takeDevWarns } from '../../support/warn-gate';
import { makeEnv, makeHandlers } from './typed-char-env';

const SHAPES: Array<
	[name: string, source: string, anchor: number[], focus: number[], end: number]
> = [
	['a whole list', '- a\n- b\n', [0, 0, 0], [0, 1, 0], 1],
	['a nested list whole', '- a\n  - b\n  - c\n', [0, 0, 1, 0, 0], [0, 0, 1, 1, 0], 1],
	['a quote’s paragraphs', '> a\n>\n> b\n\nc\n', [0, 0], [1], 1],
	['a list into the paragraph under it', '- a\n- b\n\nc\n', [0, 0, 0], [1], 0]
];

describe('the commits of a paste over a range across blocks', () => {
	for (const clip of ['x', 'x\n\ny', '- p\n- q\n']) {
		for (const [name, source, anchor, focus, end] of SHAPES) {
			it(`${name}, ${JSON.stringify(clip)}: no commit names a block the removal took`, async () => {
				const env = makeEnv(source);
				env.selectionState.enterCrossBlock(
					{ path: anchor, offset: 0 },
					{ path: focus, offset: end }
				);

				await makeHandlers(env, anchor).pasteOverRange({ text: clip, plain: false });

				expect(serialize(env.doc)).not.toBe(source);
				expect(takeDevWarns().map((warn) => warn.message)).toEqual([]);
			});
		}
	}
});
