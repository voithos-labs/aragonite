// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { lrdMapCouldChange } from '#lib/components/link-reference-map.js';
import { definitionsOf } from '#lib/core/inline/scan/definitions.js';
import { serialize } from '#lib/core/serializer.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { makeEnv, makeHandlers, selectAcross, makeBeforeInputEvent } from './typed-char-env';
import { fixtureReading } from '../../harness/fixture-grammar';
import type { CstNode } from '#lib/core/nodes.js';
import type { EditEvent } from '#lib/editor-events.js';
import type { LinkReferenceResolver } from '#lib/core/inline/scan/definitions.js';

/**
 * Mirrors the editor's `refreshDefinitions` (`Editor.svelte`): rebuilds the link-reference map
 * whenever the blocks a write replaced could have changed the definitions.
 */
function trackLrdResolver(env: ReturnType<typeof makeEnv>): () => LinkReferenceResolver {
	let resolve = definitionsOf(env.doc.children).resolve;
	const refresh = env.deps.refreshDefinitions;
	env.deps.refreshDefinitions = (replaced) => {
		refresh(replaced);
		if (lrdMapCouldChange(replaced)) resolve = definitionsOf(env.doc.children).resolve;
	};
	return () => resolve;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('cross-block typed character: A2/A3 event symmetry', () => {
	// The commit re-derives the leaf's kind, so it declares `updateContent`, not `input` — matching
	// the single-block kind-changing branch, with the post-edit block's full text length as detail.
	it.each(['X', 'ABC'])('emits op:delete then op:updateContent for a typed "%s"', async (typed) => {
		const env = makeEnv('hello\n\nworld\n');
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));

		// Anchor at start of block 0, focus at start of block 1 — covers all of "hello\n".
		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0]);
		const handled = await handlers.handleBeforeInput(makeBeforeInputEvent(typed));
		expect(handled).toBe(true);

		expect(editEvents.map((e) => e.op)).toEqual(['delete', 'updateContent']);

		const update = editEvents[1] as Extract<EditEvent, { op: 'updateContent' }>;
		// Both checks: the block-length contract, and the arithmetic that pins it; the first
		// alone would pass against a survivor that is not what we think.
		expect(update.detail.length).toBe((env.doc.children[0] as CstNode).raw.length);
		expect(update.detail.length).toBe('world\n'.length + typed.length);
	});

	it('typed character lands in the merged target raw', async () => {
		const env = makeEnv('hello\n\nworld\n');

		// Selecting only the paragraph break, [0] offset 5 to [1] offset 0: typing should still produce
		// delete+input and leave a single merged block.
		env.selectionState.enterCrossBlock({ path: [0], offset: 5 }, { path: [1], offset: 0 });

		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('X'));

		expect(env.doc.children).toHaveLength(1);
		const merged = env.doc.children[0] as CstNode;
		expect(merged.raw.replace(/\s+$/, '')).toBe('helloXworld');
	});

	it('snapshot is captured pre-mutation: typed character + delete share one undo step', async () => {
		const env = makeEnv('alpha\n\nbeta\n');
		const before = env.doc.children.map((c) => (c as CstNode).raw).join('');

		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('Z'));

		const stacks = env.deps.undoManager.getStacks();
		expect(stacks.undo).toHaveLength(1);
		const snapshot = stacks.undo[0].snapshot;
		const snapshotSource = snapshot.children.map((c) => (c as CstNode).raw).join('');
		expect(snapshotSource).toBe(before);
	});

	// Miss-analysis: the env's document write was a no-op, and no test here pressed undo.
	it('undo after the typed character restores the document the range covered', async () => {
		const env = makeEnv('alpha\n\nbeta\n');
		selectAcross(env.selectionState, [0], [1]);
		await makeHandlers(env, [0]).handleBeforeInput(makeBeforeInputEvent('Z'));
		expect(serialize(env.deps.doc)).not.toBe('alpha\n\nbeta\n');

		await createHistoryActions(env.deps, env.controller).requestUndo();

		expect(serialize(env.deps.doc)).toBe('alpha\n\nbeta\n');
	});
});

// The typed splice re-parses the surviving leaf inside the commit, so a marker at offset 0
// re-derives the kind (parity with the single-block type path) rather than holding it stale.
describe('cross-block typed character: kind re-derivation at offset 0', () => {
	it('a marker at offset 0 of an emptied survivor re-parses to the new kind', async () => {
		const env = makeEnv('aaa\n\nbbb\n');

		// Select both blocks whole; the delete empties the survivor at [0] offset 0.
		env.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 3 });

		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('#'));

		expect(env.doc.children).toHaveLength(1);
		const survivor = env.doc.children[0] as CstNode;
		expect(survivor.kind).toBe('heading');
		expect(survivor.raw.replace(/\s+$/, '')).toBe('#');
	});

	it('a non-marker character keeps the kind: the fast path stays in place', async () => {
		const env = makeEnv('aaa\n\nbbb\n');

		env.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 3 });

		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('x'));

		expect(env.doc.children).toHaveLength(1);
		const survivor = env.doc.children[0] as CstNode;
		expect(survivor.kind).toBe('paragraph');
		expect(survivor.raw.replace(/\s+$/, '')).toBe('x');
	});
});

// A commit that re-derives the kind must say it replaced blocks, or the resolver keeps serving a
// destroyed definition.
describe('cross-block typed character: link-reference resolver freshness', () => {
	it('a type-replace that destroys a definition stops the resolver serving it', async () => {
		const env = makeEnv('[label]: /a\n\n[ref]: /b\n\nSee [ref] and [label].\n');
		const resolver = trackLrdResolver(env);
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));
		expect(resolver()('ref')).toEqual({ url: '/b' });

		// The delete drops `[label]` and the second definition's `[`, and the typed `x` makes what is
		// left prose: the document then defines neither label.
		selectAcross(env.selectionState, [0], [1], 1);
		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('x'));

		const survivor = env.doc.children[0] as CstNode;
		expect(survivor.kind).toBe('paragraph');
		expect(resolver()('ref')).toBeUndefined();
		expect(resolver()('label')).toBeUndefined();

		// The detail is computed before the commit, but a kind change reparses into a fresh node,
		// so the length contract needs checking on this branch as well as the kind-stable one.
		const update = editEvents.at(-1) as Extract<EditEvent, { op: 'updateContent' }>;
		expect(update.op).toBe('updateContent');
		expect(update.detail.length).toBe(survivor.raw.length);
	});

	it('a type-replace that creates a definition makes the resolver serve it', async () => {
		// The other direction of the same decision, where the post-commit kind is
		// `linkReferenceDefinition`.
		const env = makeEnv('drop me\n\nlabel]: /a\n');
		const resolver = trackLrdResolver(env);
		expect(resolver()('label')).toBeUndefined();

		selectAcross(env.selectionState, [0], [1]);
		const handlers = makeHandlers(env, [0]);
		await handlers.handleBeforeInput(makeBeforeInputEvent('['));

		expect((env.doc.children[0] as CstNode).kind).toBe('linkReferenceDefinition');
		expect(resolver()('label')).toEqual({ url: '/a' });
	});
});

// No beforeinput fires in reading mode; forced, the typed character's own reading-mode check stops it.
// Miss-analysis: the dispatch's check stood in front of that one, so neither was ever tested alone.
describe('cross-block typed character forced in reading mode', () => {
	it('consumes the key and writes nothing', async () => {
		const env = makeEnv('hello\n\nworld\n', fixtureReading({}, 'reading'));
		selectAcross(env.selectionState, [0], [1]);
		const event = makeBeforeInputEvent('X');

		expect(await makeHandlers(env, [0]).handleBeforeInput(event)).toBe(true);

		expect(event.defaultPrevented).toBe(true);
		expect(serialize(env.doc)).toBe('hello\n\nworld\n');
	});
});
