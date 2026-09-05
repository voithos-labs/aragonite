// Miss-analysis: `caretTargetAtPoint` shipped as a descriptor field with no test asking whether
// a plugin could fill it, so the barrel could be missing every piece of the answer and stay green.
import { describe, it, expect } from 'vitest';
import * as pluginBarrel from '$lib/plugin';
import { CURSOR_END } from '$lib/block-component';
import { caretOffsetAtPoint } from '$lib/cursor/point-offset';
import type { CaretTarget } from '$lib/plugin';

// The kit a kind answers `caretTargetAtPoint` with. A field the platform reads and a plugin
// cannot honestly fill looks supported and is not, so the three pieces are pinned to their mints.
describe('caret-geometry barrel surface', () => {
	it('re-exports the point probe from its home in cursor/', () => {
		expect(pluginBarrel.caretOffsetAtPoint).toBe(caretOffsetAtPoint);
	});

	it('re-exports CURSOR_END from block-component', () => {
		expect(pluginBarrel.CURSOR_END).toBe(CURSOR_END);
	});

	it('names the landing shape both built-in and plugin hooks return (compile-time)', () => {
		const target: CaretTarget = { path: [], offset: CURSOR_END };
		expect(target.offset).toBe(CURSOR_END);
	});
});
