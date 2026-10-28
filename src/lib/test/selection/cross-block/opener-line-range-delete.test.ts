// A range delete that crosses a `:::` container's opener line clears the title it covers and keeps
// the `:::name` marker, so the container survives and no body text joins the line.
// Miss-analysis (#801): the clear and both edge cuts wrote the title row whole, which was right
// while the row held only the title and cut the marker once it held the opener line.
import { it, expect, beforeEach } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { replaceRange } from '#lib/selection/cross-block/range-replace.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { registerCalloutForTests } from '#lib/test/selection/chrome-plugins.js';
import type { RangeInsertion } from '#lib/selection/cross-block/range-replace.js';
import { makeRangeEnv } from './range-context';

beforeEach(registerCalloutForTests);

const SOURCE = 'para\n\n:::callout Title\nbody\n:::\n\nafter\n';
const DELETE: RangeInsertion = { kind: 'none', gesture: 'keyless' };

type Point = [number[], number];

async function run(
	source: string,
	[startPath, startOffset]: Point,
	[endPath, endOffset]: Point,
	insertion = DELETE
) {
	const env = makeRangeEnv(source);
	env.deps.selectionState.enterCrossBlock(
		{ path: startPath, offset: startOffset },
		{ path: endPath, offset: endOffset }
	);
	await replaceRange(env.mutCtx, insertion);
	expectParseConverged(env.deps.doc);
	return env.deps.doc;
}

it.each<[string, Point, Point, string]>([
	[
		'from above into the marker',
		[[0], 2],
		[[1, 0], 3],
		'pa\n\n:::callout Title\nbody\n:::\n\nafter\n'
	],
	[
		'from above into the title',
		[[0], 2],
		[[1, 0], 14],
		'pa\n\n:::callout le\nbody\n:::\n\nafter\n'
	],
	['from above into the body', [[0], 2], [[1, 1], 2], 'pa\n\n:::callout\ndy\n:::\n\nafter\n'],
	[
		'from mid-name into the body',
		[[1, 0], 5],
		[[1, 1], 2],
		'para\n\n:::callout \ndy\n:::\n\nafter\n'
	],
	[
		'from mid-title into the body',
		[[1, 0], 13],
		[[1, 1], 2],
		'para\n\n:::callout Ti\ndy\n:::\n\nafter\n'
	]
])('%s keeps the marker and the container', async (_name, start, end, expected) => {
	const doc = await run(SOURCE, start, end);

	expect(serialize(doc)).toBe(expected);
	expect(doc.children.map((c) => c.kind)).toContain('callout');
});

it('typing over a range from mid-name puts the text in the title, not the name', async () => {
	const doc = await run(SOURCE, [[1, 0], 5], [[1, 1], 2], { kind: 'text', text: 'x' });

	expect(serialize(doc)).toBe('para\n\n:::callout x\ndy\n:::\n\nafter\n');
});

// Each leaves the container's kind matching its bytes with no second read of the whole node.
it.each<[string, string, Point, Point, string]>([
	[
		'from the body over the closing line',
		SOURCE,
		[[1, 1], 2],
		[[2], 2],
		'para\n\n:::callout Title\nbo\n:::\n\nter\n'
	],
	[
		'from the body past the container',
		SOURCE + '\nlast\n',
		[[1, 1], 2],
		[[3], 2],
		'para\n\n:::callout Title\nbo\n:::\n\nst\n'
	],
	['over the whole document', SOURCE, [[0], 0], [[2], 5], '\n'],
	[
		'from a paragraph above into a later body block',
		'para\n\n:::callout Title\nbody\n\nmore\n:::\n',
		[[0], 2],
		[[1, 2], 2],
		'pa\n\n:::callout\n\nre\n:::\n'
	]
])('%s', async (_name, source, start, end, expected) => {
	expect(serialize(await run(source, start, end))).toBe(expected);
});
