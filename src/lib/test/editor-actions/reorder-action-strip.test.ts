import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins } from '$lib';
import { serialize } from '$lib/core/serializer';
import { makeReorderContainer } from './reorder-harness';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { footnotesPlugin } from '$lib/plugins/footnotes';

// A strip plugin container reorders its body children within itself. The
// rebuild-as-blockquote hazard (which drops the `[!TYPE]` marker) is masked in committed
// state by the ceremony re-rebuilding the scope through its own descriptor, so these pin
// the OBSERVABLE contract instead: reorder-within, marker survives, tree converges.

beforeAll(() => {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
});

describe('reorder action — githubAlert body children reorder within', () => {
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

describe('reorder action — footnote-def body children reorder within', () => {
	it('drag move reorders the body child within and keeps the [^label]: marker', async () => {
		const h = makeReorderContainer('[^a]: first\n\n    second\n');
		await h.reorder.moveReorderUnit([0, 0], 1);
		const live = serialize(h.doc);
		expect(live).toContain('[^a]:');
		expect(live.indexOf('second')).toBeLessThan(live.indexOf('first'));
		h.assertStable();
	});
});

// The teleport: nudging a body child must not drag the whole alert among the
// document siblings.
describe('reorder action — no whole-alert teleport', () => {
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
