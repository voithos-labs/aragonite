import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '#lib';
import { serialize } from '#lib/core/serializer.js';
import { makeReorderContainer } from './reorder-harness';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';

// An alert-style plugin container reorders its body children within itself. The hazard of
// rebuilding it as a blockquote (which drops the `[!TYPE]` marker) is hidden in committed
// state by the commit rebuilding the scope through its own descriptor, so these test the
// observable contract instead: reorder within, marker survives, tree converges.

beforeEach(() => {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
});

describe('reorder action: githubAlert body children reorder within', () => {
	it('drag move reorders the body child within and keeps the [!TYPE] marker', async () => {
		const h = makeReorderContainer('> [!NOTE]\n> a\n>\n> b\n');
		await h.reorder.moveReorderUnit([0, 0], 1);
		expect(serialize(h.doc)).toBe('> [!NOTE]\n> b\n>\n> a\n');
		h.assertStable();
	});

	it('nudge down reorders the body child within and keeps the marker', async () => {
		const h = makeReorderContainer('> [!TIP]\n> a\n>\n> b\n');
		await h.reorder.nudgeReorderUnit([0, 0], 1);
		expect(serialize(h.doc)).toBe('> [!TIP]\n> b\n>\n> a\n');
		h.assertStable();
	});

	it('the within-alert reorder is one undo entry and restores in one step', async () => {
		const h = makeReorderContainer('> [!NOTE]\n> a\n>\n> b\n');
		await h.reorder.moveReorderUnit([0, 0], 1);
		expect(h.undoDepth()).toBe(1);
		await h.undo();
		expect(serialize(h.doc)).toBe('> [!NOTE]\n> a\n>\n> b\n');
	});
});

// Miss-analysis: every alert move above carried a content block, so no test put a blank block
// at the body head, where only a fix-up told which container owns the body keeps the opener's line.
describe('reorder action: a blank block moved to the head of an alert body', () => {
	it('keeps the tree and its reload in step', async () => {
		const h = makeReorderContainer('> [!NOTE]\n> a\n>\n>\n> b\n');
		await h.reorder.moveReorderUnit([0, 1], 0);
		h.assertStable();
	});
});

// The body's trailing blank line becomes a block under a blank tail, so the move grows the list.
describe('reorder action: a blank block moved to the tail of a body ending in a blank line', () => {
	it.each([
		['a quote', '> a\n>\n>\n> b\n>\n'],
		['an alert', '> [!NOTE]\n> a\n>\n>\n> b\n>\n']
	])('%s keeps one id per block, and the tree and its reload in step', async (_, source) => {
		const h = makeReorderContainer(source);
		await h.reorder.moveReorderUnit([0, 1], 2);
		expect(h.ids()).toHaveLength(h.node().children!.length);
		h.assertStable();
	});
});

describe('reorder action: footnote-def body children reorder within', () => {
	it('drag move reorders the body child within and keeps the [^label]: marker', async () => {
		const h = makeReorderContainer('[^a]: first\n\n    second\n');
		await h.reorder.moveReorderUnit([0, 0], 1);
		const live = serialize(h.doc);
		expect(live).toContain('[^a]:');
		expect(live.indexOf('second')).toBeLessThan(live.indexOf('first'));
		h.assertStable();
	});
});

// Nudging a body child must not move the whole alert among the document's blocks.
describe('reorder action: no whole-alert teleport', () => {
	it('nudging a body child reorders within; top/bottom siblings stay put', async () => {
		const h = makeReorderContainer('top\n\n> [!NOTE]\n> a\n>\n> b\n\nbottom\n', { nodeIndex: 1 });
		await h.reorder.nudgeReorderUnit([1, 0], 1);
		const live = serialize(h.doc);
		expect(live.startsWith('top\n')).toBe(true);
		expect(live.trimEnd().endsWith('bottom')).toBe(true);
		expect(live).toContain('[!NOTE]');
		expect(live).toBe('top\n\n> [!NOTE]\n> b\n>\n> a\n\nbottom\n');
	});
});
