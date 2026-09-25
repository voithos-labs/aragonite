import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeTopHarness } from '../harness/editor-actions';

// Miss-analysis: every document-ending case read an untouched document, so none deleted the block
// that held its first line break and then asked for the ending again.
describe("the document's line ending after an edit changes its first break", () => {
	it('reads the new first break once the block holding the old one is gone', async () => {
		const harness = makeTopHarness('x\n\ny\r\n\r\nz');
		await harness.actions.deleteBlock(0);
		const last = harness.deps.doc.children.length - 1;
		await harness.actions.splitBlock(last, 'z'.length);
		expect(serialize(harness.deps.doc)).toBe('y\r\n\r\nz\r\n\r\n\r\n');
	});
});
