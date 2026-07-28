import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { describeConvergence, parseConverges } from '$lib/testing/parse-convergence';
import { nodeAt } from '$lib/tree-operations';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { containerAt, typeSlowly } from './formation-harness';

// Per-keystroke `> [!TYPE]` formation. Typing the marker one character at a time
// only ever writes the container's inner leaf, so nothing in the leaf's own reparse
// can notice that the blockquote's rebuilt raw now opens as a `githubAlert`. Only an
// atomic whole-marker insert used to classify, which is why both drivers passed while
// the live tree diverged from a reparse of its own bytes.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('github alert — per-keystroke marker formation', () => {
	it('reclassifies the blockquote once the marker completes', async () => {
		const h = containerAt('> [!TI\n', [0]);

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		expect(h.getNode().kind).toBe('githubAlert');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(serialize(h.deps.doc)).toBe('> [!TIP]\n>\n');
	});

	it('lands the caret in the alert body, which the marker line no longer holds', async () => {
		const h = containerAt('> [!TI\n', [0]);

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		expect(h.parentFocus.moveFocus).toHaveBeenCalledWith(0, 'start');
	});

	it('keeps a multi-block body addressable, ids and all', async () => {
		const h = containerAt('> [!TI\n>\n> one\n>\n> two\n', [0]);

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		const alert = h.getNode();
		expect(alert.kind).toBe('githubAlert');
		expect(alert.children).toHaveLength(2);
		expect(alert.childIds?.filter(Boolean)).toHaveLength(2);
		expect(parseConverges(h.deps.doc)).toBe(true);
	});

	// Two distinct spine shapes: a blockquote's strip rebuild re-prefixes its lines,
	// a list item's re-indents them.
	it.each([
		['an enclosing blockquote', '> > [!TI\n', [0, 0], [0], 'blockquote'],
		['an enclosing list item', '- > [!TI\n', [0, 0, 0], [0, 0], 'listItem']
	])('forms at depth inside %s', async (_label, source, alertPath, hostPath, hostKind) => {
		const h = containerAt(source, alertPath);

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		expect(nodeAt(h.deps.doc, hostPath)?.kind).toBe(hostKind);
		expect(nodeAt(h.deps.doc, alertPath)?.kind).toBe('githubAlert');
		expect(parseConverges(h.deps.doc)).toBe(true);
	});

	// The identity rule the swap relies on: block ids live in the PARENT's parallel
	// array, never on the node, so replacing the slot carries the id for free.
	it('keeps the container id at its slot across the swap', async () => {
		const h = containerAt('> [!TI\n', [0]);
		const idBefore = h.getBlockIds()[0];

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		expect(h.getNode().kind).toBe('githubAlert');
		expect(h.getBlockIds()).toEqual([idBefore]);
	});

	// The list item's own raw (`- [!TIP]`) parses to a LIST, so a re-derivation that
	// keyed off the raw alone rather than the opener registry would eat the item.
	it('leaves a list item a list item when its text completes a marker', async () => {
		const h = containerAt('- [!TI\n', [0, 0]);

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		expect(h.deps.doc.children[0].kind).toBe('list');
		expect(h.deps.doc.children[0].children?.[0].kind).toBe('listItem');
		expect(parseConverges(h.deps.doc)).toBe(true);
	});

	// The atomic whole-marker insert is the shipped route and the acceptance oracle:
	// per-keystroke formation must land the same document and the same undo depth.
	it('agrees with the atomic whole-marker insert', async () => {
		const typed = containerAt('> [!TI\n', [0]);
		await typeSlowly(typed.bundle, 0, '[!TI', 'P]');

		const atomic = makeEditorActionsDeps(parse('x\n').children);
		const atomicActions = createBlockEditActions(atomic.deps, createUndoController(atomic.deps));
		await atomicActions.updateBlockContent(0, '> [!TIP]\n', 1, 9);

		expect(serialize(typed.deps.doc)).toBe(serialize(atomic.deps.doc));
		expect(typed.getNode().kind).toBe(atomic.deps.doc.children[0].kind);
		expect(typed.getNode().children).toHaveLength(atomic.deps.doc.children[0].children!.length);
		expect(typed.deps.undoManager.getStacks().undo).toHaveLength(
			atomic.deps.undoManager.getStacks().undo.length
		);
	});

	// A post-fix guard, not a red-first pin: with no reclassification the snapshot is
	// trivially a blockquote, so this passes on pre-fix code too. It earns its place by
	// failing if a future swap corrupts the shared snapshot.
	it('restores the pre-formation blockquote on undo', async () => {
		const h = containerAt('> [!TI\n', [0]);
		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		const restored = h.deps.undoManager.getStacks().undo.at(-1)!.snapshot;

		expect(restored.children[0].kind).toBe('blockquote');
		expect(serialize(restored)).toBe('> [!TI\n');
	});
});
