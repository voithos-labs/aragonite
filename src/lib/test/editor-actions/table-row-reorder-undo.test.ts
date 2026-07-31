import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeHarness, runOp } from '$lib/test/undo/restoration-ops';

// A row reorder rebuilds the WHOLE table raw to canonical padding, so a table whose
// pre-edit raw is NOT canonical is what proves undo restores the original bytes.
const NON_CANONICAL = '| h1 | h2 |\n|---|---|\n|a|b|\n|c|d|\n';

describe('table row reorder — undo restoration', () => {
	it('undo after a body-row move restores the original non-canonical source byte-exactly', async () => {
		const h = makeHarness(NON_CANONICAL);
		const before = serialize(h.deps.doc);

		await runOp(h, { t: 'tableReorderRow', i: 1, dir: 1 });
		expect(serialize(h.deps.doc)).not.toBe(before);

		await h.history.requestUndo();
		expect(serialize(h.deps.doc)).toBe(before);
	});
});
