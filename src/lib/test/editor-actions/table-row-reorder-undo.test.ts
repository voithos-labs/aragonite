import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/editor/core/serializer';
import { makeHarness, runOp } from '$lib/editor/test/undo/restoration-ops';

// A row reorder rebuilds the WHOLE table raw to canonical padding. Undo must
// restore the original bytes — including the original NON-canonical padding —
// proving the reorder commit pushes a snapshot and the round-trip is byte-exact
// for a table whose pre-edit raw is not already canonical.
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
