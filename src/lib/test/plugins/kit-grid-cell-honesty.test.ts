// Miss-analysis (#576): every container-kit test used built-in kinds, so no test asked what the kit
// reports for a plugin grid kind.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBlockOpener, type CstNode, type PluginBlockKind } from '$lib/plugin';
import { runContainerConformance, type ContainerConformanceProfile } from '$lib/testing';
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

	// Miss-analysis: the built-in drivers rode an internal profile field, and no test passed one
	// through the published runner, so a plugin profile could assert a cell over its own function.
	it('ignores drivers a published profile carries', async () => {
		const driver = vi.fn(async () => {});
		const withDriver = {
			...excusedProfile,
			multiScope: { mode: 'assert' } as const,
			drivers: { multiScope: driver }
		};
		const published: ContainerConformanceProfile = withDriver;
		await expect(runContainerConformance(grid, published)).rejects.toThrow(
			/multiScope: .*declare it boundary/
		);
		expect(driver).not.toHaveBeenCalled();
	});
});
