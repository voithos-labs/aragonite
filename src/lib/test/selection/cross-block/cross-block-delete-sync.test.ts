// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { replaceRange } from '#lib/selection/cross-block/range-replace.js';
import { makeRangeEnv } from './range-context';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import { makeBlockListState } from '#lib/test/harness/editor-actions.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import type { EditEvent } from '#lib/editor-events.js';

const makeEnv = (source: string) => makeRangeEnv(source);

function selectAcross(env: ReturnType<typeof makeEnv>, anchor: number[], focus: number[]) {
	env.deps.selectionState.enterCrossBlock({ path: anchor, offset: 1 }, { path: focus, offset: 2 });
}

describe('a composition’s removal, before any await: commit-primitive convergence', () => {
	it('keeps blockIds in lockstep with doc.children synchronously after the call', () => {
		const env = makeEnv('# A\n\npara B\n\npara C\n');
		selectAcross(env, [0], [2]);

		void replaceRange(env.mutCtx, { kind: 'composition' });

		expect(env.doc.children).toHaveLength(1);
		expect(env.getBlockIds()).toHaveLength(env.doc.children.length);
		expect(env.deps.selectionState.ownsRange).toBe(false);
	});

	it('emits one op:delete edit event synchronously', () => {
		const env = makeEnv('# A\n\npara B\n\npara C\n');
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));
		selectAcross(env, [0], [2]);

		void replaceRange(env.mutCtx, { kind: 'composition' });

		expect(editEvents.map((e) => e.op)).toEqual(['delete']);
	});

	it('pushes a single undo entry whose restore is byte-exact', async () => {
		const env = makeEnv('# A\n\npara B\n\npara C\n');
		const original = serialize(env.deps.doc);
		selectAcross(env, [0], [2]);

		void replaceRange(env.mutCtx, { kind: 'composition' });
		expect(env.deps.undoManager.getStacks().undo).toHaveLength(1);

		await tick();
		await env.history.requestUndo();
		expect(serialize(env.deps.doc)).toBe(original);
	});

	it('cross-container: surviving blockquote keeps childIds in lockstep with children', () => {
		const env = makeEnv('> aaaa\n>\n> bbbb\n\npara C\n');
		registerBlockListState(
			env.doc.children[0],
			makeBlockListState(() => env.deps.doc.children[0])
		);
		selectAcross(env, [0, 0], [1]);

		void replaceRange(env.mutCtx, { kind: 'composition' });

		const quote = env.deps.doc.children[0];
		expect(quote.children).toHaveLength(1);
		expect(quote.childIds).toHaveLength(quote.children!.length);
		expect(env.getBlockIds()).toHaveLength(env.doc.children.length);
	});
});

// A delete that blanks every block before the document's trailing blank line leaves one empty line,
// that blank line going with the emptied text, and the id sync follows the tail it shrank.
describe('cross-block delete beside the folded trailing blank (GH #129)', () => {
	it('pure top-level: the whole-content delete leaves one empty line, ids in step', async () => {
		const env = makeEnv('alpha\n\nbeta\n\n');
		env.doc.suffix = parse('alpha\n\nbeta\n\n').suffix;
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 4 });

		void replaceRange(env.mutCtx, { kind: 'composition' });
		await tick();

		expect(serialize(env.deps.doc)).toBe('\n');
		expect(env.doc.suffix).toBe('');
		expect(env.getBlockIds()).toHaveLength(1);
		expectParseConverged(env.deps.doc);
	});

	it('cross-container: the quote the delete takes leaves no id behind', async () => {
		const env = makeEnv('alpha\n\n> q\n\n');
		env.doc.suffix = parse('alpha\n\n> q\n\n').suffix;
		const quote = env.doc.children[1];
		// Once the delete takes the quote, its state keeps the node it was built on, as an unmounted
		// container's would.
		registerBlockListState(
			quote,
			makeBlockListState(() => env.deps.doc.children[1] ?? quote)
		);
		const idsBefore = [...env.getBlockIds()];
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1, 0], offset: 1 });

		void replaceRange(env.mutCtx, { kind: 'composition' });
		await tick();

		expect(serialize(env.deps.doc)).toBe('\n');
		expect(env.doc.suffix).toBe('');
		expect(env.getBlockIds()).toHaveLength(1);
		expect(env.getBlockIds()).not.toContain(idsBefore[1]);
		expectParseConverged(env.deps.doc);
	});
});
