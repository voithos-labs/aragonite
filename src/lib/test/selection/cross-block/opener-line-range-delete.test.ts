// A range delete that crosses a `:::` container's opener line takes the bytes it covers, as it takes
// a code fence's, and the tree reads what's left the way a reload does.
// Miss-analysis (#801): every chrome-wall row ran the harness's owned-chain rebuild only, which never
// put in the blocks a container's bytes read as once its opener line was cut.
import { it, expect, beforeEach } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { replaceRange } from '#lib/selection/cross-block/range-replace.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { registerCalloutForTests } from '#lib/test/selection/chrome-plugins.js';
import { makeRangeEnv } from './range-context';

beforeEach(registerCalloutForTests);

const SOURCE = 'para\n\n:::callout Title\nbody\n:::\n\nafter\n';

it.each([
	[
		'from above into the opener line',
		[0],
		2,
		[1, 0],
		3,
		'pa\n\ncallout Title\nbody\n:::\n\nafter\n'
	],
	['from above into the body', [0], 2, [1, 1], 2, 'pa\n\n\ndy\n:::\n\nafter\n'],
	['from mid-name into the body', [1, 0], 5, [1, 1], 2, 'para\n\n:::ca\ndy\n:::\n\nafter\n'],
	[
		'from mid-title into the body',
		[1, 0],
		13,
		[1, 1],
		2,
		'para\n\n:::callout Ti\ndy\n:::\n\nafter\n'
	]
])('%s', async (_name, startPath, startOffset, endPath, endOffset, expected) => {
	const env = makeRangeEnv(SOURCE);
	env.deps.selectionState.enterCrossBlock(
		{ path: startPath as number[], offset: startOffset as number },
		{ path: endPath as number[], offset: endOffset as number }
	);

	await replaceRange(env.mutCtx, { kind: 'none', gesture: 'keyless' });

	expect(serialize(env.deps.doc)).toBe(expected);
	expectParseConverged(env.deps.doc);
});
