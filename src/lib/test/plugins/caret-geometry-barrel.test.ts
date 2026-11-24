// Miss-analysis: no test asked whether a plugin could fill `caretTargetAtPoint` from the barrel.
import { describe, it, expect } from 'vitest';
import * as pluginBarrel from '#lib/plugin.js';
import { CURSOR_END } from '#lib/block-component.js';
import type { CaretTarget } from '#lib/plugin.js';

// The pieces a kind answers `caretTargetAtPoint` with. A field the platform reads but a plugin
// cannot honestly fill looks supported and is not, so each is pinned to where it lives.
describe('caret-geometry barrel surface', () => {
	// A drawing's point turns itself into an offset (`ViewportPoint.offsetIn`), so the free probe is
	// the editor's own.
	it('publishes no free point probe', () => {
		expect('caretOffsetAtPoint' in pluginBarrel).toBe(false);
	});

	it('re-exports CURSOR_END from block-component', () => {
		expect(pluginBarrel.CURSOR_END).toBe(CURSOR_END);
	});

	it('names the landing shape both built-in and plugin hooks return (compile-time)', () => {
		const target: CaretTarget = { path: [], offset: CURSOR_END };
		expect(target.offset).toBe(CURSOR_END);
	});
});
