// G1.112: a commit fixes up each body it wrote once, so a mutation that settles its own scope body
// and also reports the write there fires the check, and the route that reports it alone doesn't.
import { describe, it, expect } from 'vitest';
import { asDocPath } from '#lib/core/coordinate-spaces.js';
import { updateNodeContent, writeNodeContent } from '#lib/tree-operations/content-write.js';
import { ensureUnsharedChild } from '#lib/tree-operations/unshare.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '../support/warn-gate';

/** A one-scope commit that writes `text` into block 1 of `a\n\nb\n` through `write`. */
async function commitWrite(write: 'settled' | 'reported'): Promise<void> {
	const h = makeTopHarness('a\n\nb\n');
	await h.controller.commitMultiScope({
		scopes: [h.controller.getDocScope()],
		snapshot: { path: asDocPath([1]), offset: 0 },
		mutate: ([scope]) => {
			ensureUnsharedChild(scope, 1, scope.sharing);
			const grammar = h.deps.reading.grammar;
			if (write === 'settled') {
				return [updateNodeContent(scope.body, 1, '# b\n', grammar, scope.sharing).change];
			}
			const { change, written } = writeNodeContent(scope.body, 1, '# b\n', grammar, scope.sharing);
			scope.describeEdit({ written });
			return [change];
		},
		op: { kind: 'updateContent', detail: { length: 3 }, eventPath: asDocPath([1]) }
	});
}

describe('G1.112 a commit settles each body once', () => {
	it('fires when the mutation fixed up its own scope body and reported a change there', async () => {
		await commitWrite('settled');
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:settle-once');
	});

	it('stays quiet when the mutation reports the write and leaves its fix-up to the commit', async () => {
		await commitWrite('reported');
		expect(takeDevWarns().map((w) => w.tag)).not.toContain('invariant:settle-once');
	});
});
