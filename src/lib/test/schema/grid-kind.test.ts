// Miss-analysis: every grid reader named `table`, so no test held the grid fact itself.
import { describe, expect, it } from 'vitest';
import { isGridKind } from '$lib/schema/block-kind-descriptor';
import { isVerticallyTransparentNode } from '$lib/core/inline/transparency';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { gridOf, registerPluginGrid } from '../selection/cross-block/plugin-grid-kind';

describe('isGridKind', () => {
	it('reads the declared grid contract, built-in or plugin', () => {
		const kinds = registerPluginGrid();
		expect(isGridKind('table')).toBe(true);
		expect(isGridKind('tableRow')).toBe(true);
		expect(isGridKind(kinds.grid)).toBe(true);
	});

	it('is false for a kind with another contract or none', () => {
		expect(isGridKind('paragraph')).toBe(false);
		expect(isGridKind('blockquote')).toBe(false);
		expect(isGridKind('tableCell')).toBe(false);
	});
});

// The caret stops in every cell of a grid, so vertical travel stops on it even when every cell
// holds only an image, whichever kind declared the grid.
describe('vertical transparency reads the grid contract', () => {
	it('is false for a plugin grid whose cells are all image-only', () => {
		const grid = gridOf(registerPluginGrid(), [['![a](/a.png)', '![b](/b.png)']]);
		expect(isVerticallyTransparentNode(grid, defaultGrammarView)).toBe(false);
	});
});
