import { describe, it, expect } from 'vitest';
import { landCaretInScope, type CommitScope } from '$lib/editor-actions/block-edit-scope';
import type { BlockComponent } from '$lib/block-component';
import { makeCommitScopeStub, stubBlockComponent } from '$lib/test/harness/editor-actions';

// After a write, the caret goes to its target block only once that block is mounted.
// Miss-analysis: every caret test mounted all its refs up front, so a caret placement that never
// waited for a mount could not fail; a join into a long list's last item lost the caret.

interface FocusCall {
	path?: number[];
	offset: number;
}

/** A scope whose blocks mount only when revealed, one microtask later. */
function scopeMountingOnReveal(calls: FocusCall[]): CommitScope {
	const refs: (BlockComponent | undefined)[] = [];
	return {
		...makeCommitScopeStub([]).scope,
		refAt: (i) => refs[i],
		async reveal(index) {
			await Promise.resolve();
			refs[index] = stubBlockComponent({
				focus: (offset) => calls.push({ offset: offset as number }),
				focusByPath: (path, offset) => calls.push({ path, offset })
			});
			return refs[index];
		}
	};
}

describe('putting the caret in a block that is not mounted yet', () => {
	it('waits for the block to mount, then focuses it', async () => {
		const calls: FocusCall[] = [];
		await landCaretInScope(scopeMountingOnReveal(calls), 140, [], 2);
		expect(calls).toEqual([{ offset: 2 }]);
	});

	it('waits for the block to mount, then follows the path into it', async () => {
		const calls: FocusCall[] = [];
		await landCaretInScope(scopeMountingOnReveal(calls), 0, [149, 1], 0);
		expect(calls).toEqual([{ path: [149, 1], offset: 0 }]);
	});
});
