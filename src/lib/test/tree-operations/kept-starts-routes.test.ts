// @vitest-environment jsdom
// G1.209 over every write route: after the write, with a listener reading a position on each edit
// and each selection change, the editor places every text position where a fresh measure of the
// document does, and no read lands between a write and its announcement.
// Miss-analysis: the byte map was built afresh per content version, so no test had to ask whether
// a record kept across writes still described the document a route left.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NodeView } from '#lib/core/node-views.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { WRITE_ROUTES, type Mounted } from '#lib/test/harness/write-routes.js';
import { takeDevWarns } from '../support/warn-gate';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const N = 12;

/** Every text block's path in `node`, outermost first. */
function textPaths(node: { children?: readonly NodeView[] }, path: number[] = []): number[][] {
	const children = node.children ?? [];
	if (children.length === 0) return path.length > 0 ? [path] : [];
	return children.flatMap((child, i) => textPaths(child, [...path, i]));
}

/** Where the editor and a fresh measure each put every offset of every text block. */
function placed(m: Mounted): { kept: (number | null)[]; fresh: (number | null)[] } {
	const doc = m.instance.__test.getDocument();
	const fresh = documentLayout(measured(doc));
	const kept: (number | null)[] = [];
	const again: (number | null)[] = [];
	for (const path of textPaths(doc)) {
		let node: NodeView = doc.children[path[0]];
		for (const index of path.slice(1)) node = node.children![index];
		for (let offset = 0; offset <= node.raw.length; offset++) {
			kept.push(m.instance.__test.byteOf(path, offset));
			again.push(fresh.byteOf(path, offset));
		}
	}
	return { kept, fresh: again };
}

describe('G1.209 the kept starts are the document’s after every write route', () => {
	it.each(WRITE_ROUTES)('$name', async (route) => {
		const m = mountEditor<EditorTestSurface>({ source: route.source(N) });
		await m.settle();
		await route.setUp?.(m, N);
		const { path, offset } = route.asks(N);
		const ask = () => void m.instance.__test.byteOf(path, offset);
		// Read first, so the record is measured and the write has blocks to name.
		ask();
		const events = m.instance.getEvents();
		const offs = [events.on('edit', ask), events.on('selectionChange', ask)];
		const before = m.source();

		await route.write(m, N);

		expect(m.source(), 'the route wrote nothing').not.toBe(before);
		const { kept, fresh } = placed(m);
		expect(kept).toEqual(fresh);
		expect(takeDevWarns()).toEqual([]);
		offs.forEach((off) => off());
	});
});
