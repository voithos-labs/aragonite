// @vitest-environment jsdom
// A character typed over a range inside a container whose own list never mounted goes through the
// same write as any keystroke, so its kind follows its bytes.
// Miss-analysis: every typed-character case typed into a mounted list or at the top level.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';
import { makeBlockListState } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { makeEnv, makeHandlers, makeBeforeInputEvent } from './typed-char-env';

describe('a typed character inside a container that never mounted', () => {
	it('re-derives the kind, as a keystroke there would', async () => {
		const env = makeEnv('- > aaa\n  >\n  > bbb\n');
		// The item's list is mounted; the quote inside it, the leaf's own container, is not.
		makeBlockListState(() => blockNodeAt(env.doc, [0, 0]) as CstNode);
		env.selectionState.enterCrossBlock(
			{ path: [0, 0, 0, 0], offset: 0 },
			{ path: [0, 0, 0, 1], offset: 3 }
		);

		await makeHandlers(env, [0, 0, 0, 0]).handleBeforeInput(makeBeforeInputEvent('#'));

		expect(serialize(env.doc)).toBe('- > #\n');
		expect(blockNodeAt(env.doc, [0, 0, 0, 0])?.kind).toBe('heading');
		expect(describeConvergence(env.doc)).toBeNull();
	});
});
