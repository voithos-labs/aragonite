import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { describeConvergence, parseConverges } from '$lib/testing/parse-convergence';
import { nodeAt } from '$lib/tree-operations';
import { makeContainerHarness, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { containerAt, typeSlowly } from './formation-harness';

// Per-keystroke `> [!TYPE]` formation. Typing the marker one character at a time only
// ever writes the container's inner child, so nothing in that child's own reparse notices
// that the blockquote's rebuilt raw now opens as a `githubAlert`: inserting the whole marker
// at once does classify it, and this path would quietly not.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('github alert: per-keystroke marker formation', () => {
	it('reclassifies the blockquote once the marker completes', async () => {
		const h = containerAt('> [!TI\n', [0]);

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		expect(h.getNode().kind).toBe('githubAlert');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(serialize(h.deps.doc)).toBe('> [!TIP]\n>\n');
	});

	// Once the quote becomes an alert, the caret follows its byte to the start of the alert's body.
	// Miss-analysis: no row checked the caret's position or typed the marker in a nested quote.
	it.each([
		{ where: 'at the root', source: '> [!TI\n> body\n', quote: [0] },
		{ where: 'inside a list item', source: '- > [!TI\n  > body\n', quote: [0, 0, 0] }
	])('lands the caret at the alert body start $where', async ({ source, quote }) => {
		const h = makeContainerHarness(source, quote);

		await h.bundle.blockEdit.updateBlockContent(0, '[!TIP\nbody\n', 'authored', 4, 5);
		await h.bundle.blockEdit.updateBlockContent(0, '[!TIP]\nbody\n', 'authored', 5, 6);

		expect(h.getNode().kind).toBe('githubAlert');
		expect(h.getNode().children!.map((c) => c.raw)).toEqual(['body\n']);
		expect(h.landings).toEqual([{ leafPath: [...quote, 0], offset: 0 }]);
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

	// Two different container shapes: a blockquote's strip rebuild re-prefixes its lines,
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

	// The identity rule the swap relies on: block ids live in the parent's parallel array,
	// never on the node, so replacing the child at that index keeps the id for free.
	it('keeps the container id at its slot across the swap', async () => {
		const h = containerAt('> [!TI\n', [0]);
		const idBefore = h.getBlockIds()[0];

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		expect(h.getNode().kind).toBe('githubAlert');
		expect(h.getBlockIds()).toEqual([idBefore]);
	});

	// The list item's own raw (`- [!TIP]`) parses to a list, so a re-derivation keyed off
	// the raw alone rather than the opener registry would swallow the item.
	it('leaves a list item a list item when its text completes a marker', async () => {
		const h = containerAt('- [!TI\n', [0, 0]);

		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		expect(h.deps.doc.children[0].kind).toBe('list');
		expect(h.deps.doc.children[0].children?.[0].kind).toBe('listItem');
		expect(parseConverges(h.deps.doc)).toBe(true);
	});

	// Inserting the whole marker at once is the shipped path and the reference result:
	// per-keystroke formation must produce the same document and the same undo depth.
	it('agrees with the atomic whole-marker insert', async () => {
		const typed = containerAt('> [!TI\n', [0]);
		await typeSlowly(typed.bundle, 0, '[!TI', 'P]');

		const atomic = makeEditorActionsDeps(parse('x\n').children);
		const atomicActions = createBlockEditActions(atomic.deps, createUndoController(atomic.deps));
		await atomicActions.updateBlockContent(0, '> [!TIP]\n', 'authored', 1, 9);

		expect(serialize(typed.deps.doc)).toBe(serialize(atomic.deps.doc));
		expect(typed.getNode().kind).toBe(atomic.deps.doc.children[0].kind);
		expect(typed.getNode().children).toHaveLength(atomic.deps.doc.children[0].children!.length);
		expect(typed.deps.undoManager.getStacks().undo).toHaveLength(
			atomic.deps.undoManager.getStacks().undo.length
		);
	});

	// Guards the shared snapshot against a future swap corrupting it; it cannot fail for a
	// missing reclassification, where the snapshot is trivially a blockquote.
	it('restores the pre-formation blockquote on undo', async () => {
		const h = containerAt('> [!TI\n', [0]);
		await typeSlowly(h.bundle, 0, '[!TI', 'P]');

		const restored = h.deps.undoManager.getStacks().undo.at(-1)!.snapshot;

		expect(restored.children[0].kind).toBe('blockquote');
		expect(serialize(restored)).toBe('> [!TI\n');
	});
});
