// @vitest-environment jsdom
//
// The `updateContent` a cross-block toggle emits, at the two shapes a grid start endpoint takes.
// `detail.length` is a public field a host reads and the op is spent BEFORE the write, so which
// block `path` names decides whether the length is the pre- or the post-write one.
//
// Miss-analysis: the grid arm changed this field with no test on the emitted op at all — every
// toggle case read the plan, one layer below the event a host subscribes to.
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode, Document } from '$lib/core/nodes';
import type { EditEvent } from '$lib/editor-events';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { gridOf, registerPluginGrid } from './plugin-grid-kind';
import { makeKeydownEnv, press } from './keydown-env';

afterEach(() => __resetSchemaRegistriesForTests());

// `head` first in both fixtures: the dispatch context's focused block is [0], and a container
// there never reaches the toggle.
const TABLE = 'head\n\n| Ha | Hb |\n| --- | --- |\n| a1 | a2 |\n\ntail\n';

function pluginGridDoc(): Document {
	const doc = parse('head\n\ntail\n');
	doc.children.splice(1, 0, gridOf(registerPluginGrid(), [['a', 'b']]));
	return doc;
}

const lastUpdate = (events: EditEvent[]) =>
	events.at(-1) as Extract<EditEvent, { op: 'updateContent' }>;

describe('the updateContent a toggle emits for a grid start endpoint', () => {
	// A table's start endpoint snaps onto the TABLE path, which no per-cell write matches, so the
	// detail is the grid's own PRE-write length (`schema/operations.ts`).
	it('reports the table’s pre-write length against the table path', async () => {
		const env = makeKeydownEnv(TABLE);
		const events: EditEvent[] = [];
		env.events.on('edit', (e) => events.push(e));
		env.selection.enterCrossBlock(
			{ path: [1], offset: 2, cellCoordinate: true },
			{ path: [2], offset: 4 }
		);
		const before = (env.deps.doc.children[1] as CstNode).raw.length;

		await env.keydown.handleKeyDown(press('b', { ctrlKey: true }));

		const update = lastUpdate(events);
		expect(update.path).toEqual([1]);
		expect(update.detail.length).toBe(before);
		// The discriminator: the write grew the table, so reporting the pre-write length is a choice.
		expect((env.deps.doc.children[1] as CstNode).raw.length).toBeGreaterThan(before);
	});

	// A plugin grid's endpoint never snaps, so `path` names the CELL — which the plan does write,
	// making the detail that cell's post-write length.
	it('reports the cell’s post-write length against a plugin grid’s deep path', async () => {
		const env = makeKeydownEnv(pluginGridDoc());
		const events: EditEvent[] = [];
		env.events.on('edit', (e) => events.push(e));
		env.selection.enterCrossBlock({ path: [1, 0, 1], offset: 0 }, { path: [2], offset: 4 });

		await env.keydown.handleKeyDown(press('b', { ctrlKey: true }));

		const update = lastUpdate(events);
		expect(update.path).toEqual([1, 0, 1]);
		expect(update.detail.length).toBe('**b**'.length);
	});
});
