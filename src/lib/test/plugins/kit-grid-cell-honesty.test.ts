// Miss-analysis (#576): every container-kit test used built-in kinds, so no test asked what the kit
// reports for a plugin grid kind.
import { beforeEach, describe, expect, it } from 'vitest';
import { registerBlockOpener, type CstNode, type PluginBlockKind } from '$lib/plugin';
import {
	resetPluginPlatformForTests,
	runContainerConformance,
	type ContainerConformanceProfile
} from '$lib/testing';
import { testContainer, testLeaf } from '$lib/test/harness/test-kinds';

const EXCUSED = 'the plugin grid in this suite exists only to probe the cells it asserts';

// Each `%` line is one cell; the rebuild writes garbage, so no honest grid check passes over it.
function registerCorruptGrid(): PluginBlockKind {
	const cell = testLeaf('honesty-grid-cell');
	const grid = testContainer('honesty-grid', {
		contract: 'grid',
		rebuildRaw: (node) => {
			node.raw = 'corrupted\n';
		}
	});
	registerBlockOpener(grid, {
		priority: 45,
		interruptsParagraph: false,
		tryOpen(ctx) {
			let end = ctx.index;
			while (end < ctx.end && ctx.lines[end].text.startsWith('%')) end++;
			if (end === ctx.index) return null;
			const lines = ctx.lines.slice(ctx.index, end);
			const children: CstNode[] = lines.map((line) => ({
				kind: cell,
				leadingTrivia: '',
				raw: line.raw
			}));
			const raw = lines.map((line) => line.raw).join('');
			return {
				node: { kind: grid, leadingTrivia: ctx.leadingTrivia, raw, children },
				consumed: end - ctx.index
			};
		}
	});
	return grid;
}

const excusedProfile: ContainerConformanceProfile = {
	deepNesting: { source: '% a\n% b\n', leafPath: [0, 0] },
	localIndex: { mode: 'exempt', reason: EXCUSED },
	ancestry: { mode: 'boundary', reason: EXCUSED },
	multiScope: { mode: 'exempt', reason: EXCUSED },
	focusBubble: { mode: 'boundary', reason: EXCUSED },
	terminatorCollision: { mode: 'boundary', reason: EXCUSED }
};

describe('container kit: a plugin grid kind', () => {
	let grid: PluginBlockKind;
	beforeEach(() => {
		resetPluginPlatformForTests();
		grid = registerCorruptGrid();
	});

	it('fails localIndex, naming the declaration to make', async () => {
		await expect(
			runContainerConformance(grid, { ...excusedProfile, localIndex: { mode: 'assert' } })
		).rejects.toThrow(/localIndex: .*declare it boundary/);
	});

	it('fails multiScope, naming the declaration to make', async () => {
		await expect(
			runContainerConformance(grid, { ...excusedProfile, multiScope: { mode: 'assert' } })
		).rejects.toThrow(/multiScope: .*declare it boundary/);
	});
});
