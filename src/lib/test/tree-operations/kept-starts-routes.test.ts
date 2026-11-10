// @vitest-environment jsdom
// G1.209 over every write route: after the write, with a listener reading a position on every
// event the editor emits, the editor places every text position where a fresh read of its bytes
// does, and no listener is called between a write and its announcement.
// Miss-analysis: the byte map was built afresh per content version, so no test had to ask whether
// a record kept across writes still described the document a route left.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NodeView } from '#lib/core/node-views.js';
import type { EditorEventMap } from '#lib/editor-events.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { parse } from '#lib/core/parser.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { WRITE_ROUTES, type Mounted } from '#lib/test/harness/write-routes.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { takeDevWarns } from '../support/warn-gate';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const N = 12;

// Keyed by the map, so an event added to it is listened to here or fails the type check.
const EVERY_EVENT: Record<keyof EditorEventMap, true> = {
	edit: true,
	selectionChange: true,
	error: true,
	presentationModeChange: true,
	themeChange: true,
	menuChange: true,
	sourceSwap: true,
	searchChange: true
};
const EVENT_NAMES = Object.keys(EVERY_EVENT) as (keyof EditorEventMap)[];

/** Every text block's path in `node`, outermost first. */
function textPaths(node: { children?: readonly NodeView[] }, path: number[] = []): number[][] {
	const children = node.children ?? [];
	if (children.length === 0) return path.length > 0 ? [path] : [];
	return children.flatMap((child, i) => textPaths(child, [...path, i]));
}

/** Where the editor and a fresh read of its bytes each put every offset of every text block. */
function placed(m: Mounted): { kept: (number | null)[]; fresh: (number | null)[] } {
	const doc = m.instance.__test.getDocument();
	const fresh = documentLayout(measured(parse(m.source())));
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
		const offs = EVENT_NAMES.map((name) => events.on(name, ask));
		const before = m.source();

		await route.write(m, N);

		expect(m.source(), 'the route wrote nothing').not.toBe(before);
		const { kept, fresh } = placed(m);
		expect(kept).toEqual(fresh);
		expect(takeDevWarns()).toEqual([]);
		offs.forEach((off) => off());
	});
});

describe('G1.209 over writes that leave the document as it stood, or break a rule the record leans on', () => {
	const SOURCE = Array.from({ length: N }, (_, i) => `line ${i}\n`).join('\n');

	/** A headless editor whose record a question has measured, every event asking a position. */
	function measuredHarness() {
		const h = makeTopHarness(SOURCE);
		const ends = () => {
			const { starts } = h.deps.bytes.measured();
			return h.deps.doc.children.map((_, i) => starts.end(i));
		};
		ends();
		EVENT_NAMES.forEach((name) => h.events.on(name, ends));
		const fresh = () => {
			const { starts } = measured(h.deps.doc);
			return h.deps.doc.children.map((_, i) => starts.end(i));
		};
		return { ...h, ends, fresh };
	}
	const snapshot = { path: docPathFrom([2]), offset: 0 };

	it('a write that throws part way', async () => {
		const h = measuredHarness();
		const thrown = h.controller.commitStructural({
			snapshot,
			mutate(children) {
				children.splice(2, 1);
				throw new Error('part way');
			},
			op: { kind: 'delete', eventPath: snapshot.path }
		});
		await expect(thrown).rejects.toThrow('part way');
		expect(h.deps.starts.isMeasured()).toBe(true);
		expect(h.ends()).toEqual(h.fresh());
		expect(takeDevWarns()).toEqual([]);
	});

	it('a write that changes nothing and is discarded', async () => {
		const h = measuredHarness();
		const wrote = await h.controller.commitSource({
			changes: [],
			caret: 'keep',
			op: { kind: 'input' },
			snapshot
		});
		expect(wrote).toBe(false);
		expect(h.deps.starts.isMeasured()).toBe(true);
		expect(h.ends()).toEqual(h.fresh());
		expect(takeDevWarns()).toEqual([]);
	});

	// The document scope finds a block written in place by its absence from the undo snapshot
	// (G1.9): a write that skips the copy leaves the record behind, and G1.209 says so.
	it('a block written in place without the copy an undo snapshot needs', async () => {
		const h = measuredHarness();
		await h.controller.commitStructural({
			snapshot,
			mutate(children) {
				children[2].raw = 'written through the snapshot\n';
				return { op: 'noop' };
			},
			op: { kind: 'input', eventPath: snapshot.path }
		});
		expect(takeDevWarns().map((warn) => warn.tag)).toContain('invariant:kept-starts-current');
	});
});
