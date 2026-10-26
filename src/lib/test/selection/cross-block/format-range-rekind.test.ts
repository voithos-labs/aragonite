// @vitest-environment jsdom
// A format toggle over several blocks whose bytes then read as another kind, or as more blocks,
// leaves the tree a reload of those bytes reads, as the toggle inside one block already does.
// Miss-analysis: the cross-block write kept each block's kind by construction, and the read-back
// check skipped top-level leaves, so a paragraph whose bytes reload as a heading passed silently.
import { tick } from 'svelte';
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '#lib/selection/cross-block/format-range.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange } from '#lib/selection/range-coverage.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import { makeBlockListState } from '#lib/test/harness/editor-actions.js';
import { makeKeydownEnv, press } from './keydown-env';
import { writtenBelow } from '#lib/test/harness/settle-funnel.js';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

describe('un-bolding across blocks takes the kind the bytes read as', () => {
	it.each([
		{
			name: 'a paragraph left holding `#`',
			source: '**#**\n\n**b**\n',
			range: [at([0], 0), at([1], 5)],
			after: '#\n\nb\n'
		},
		{
			name: 'a paragraph whose second line now opens a list',
			source: 'a\n**- b**\n\n**c**\n',
			range: [at([0], 2), at([1], 5)],
			// The new list gets the blank line the commit keeps between two blocks.
			after: 'a\n\n- b\n\nc\n'
		}
	])('$name', async ({ source, range, after }) => {
		const env = makeKeydownEnv(source);
		env.selection.enterCrossBlock(range[0], range[1]);

		await env.keydown.handleKeyDown(press('b', { ctrlKey: true }));

		expect(env.source()).toBe(after);
		expect(describeConvergence(env.deps.doc)).toBeNull();

		await createHistoryActions(env.deps, env.controller).requestUndo();
		expect(env.source()).toBe(source);
		expect(describeConvergence(env.deps.doc)).toBeNull();
	});

	it.each([
		{ source: '> **#**\n>\n> **b**\n', range: [at([0, 0], 0), at([0, 1], 5)] },
		{ source: '- **#**\n- **b**\n', range: [at([0, 0, 0], 0), at([0, 1, 0], 5)] }
	])('inside a container: $source', ({ source, range }) => {
		const doc = parse(source);
		const plan = planCrossBlockFormat(
			doc,
			coverRange(doc, range[0], range[1]),
			'strong',
			fixtureReading()
		);

		writtenBelow(
			doc,
			(scope) => applyCrossBlockFormat(scope, plan!),
			defaultGrammarView,
			createSharingState()
		);

		expect(serialize(doc)).toBe(source.replaceAll('**', ''));
		expect(describeConvergence(doc)).toBeNull();
	});

	it('inside a mounted quote, whose list of blocks takes the new one', async () => {
		const source = '> a\n> **- b**\n>\n> **c**\n';
		const env = makeKeydownEnv(source);
		const quote = () => env.deps.doc.children[0];
		const state = makeBlockListState(quote);
		registerBlockListState(quote(), state);
		env.selection.enterCrossBlock(at([0, 0], 2), at([0, 1], 5));

		env.crossBlockCommands.run('format.toggleStrong');
		await tick();

		expect(env.source()).toBe('> a\n>\n> - b\n>\n> c\n');
		expect(describeConvergence(env.deps.doc)).toBeNull();
		expect(state.innerBlockIds).toHaveLength(quote().children!.length);
	});
});
