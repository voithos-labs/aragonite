// A copy reads the document's bytes and their layout from the editor, which makes each once per
// content version, so a copy's work doesn't grow with the document (G4.312).
// Miss-analysis: the cost rows counted the core's parses and blocks laid out, never the serialize
// and the fresh layout the copy route itself made, so a copy in a giant list read every item.
import { describe, it, expect, vi } from 'vitest';

const made = vi.hoisted(() => ({ serialized: 0, laidOut: 0 }));

vi.mock('#lib/core/serializer.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/core/serializer.js')>();
	return {
		...actual,
		serialize: (...args: Parameters<typeof actual.serialize>) => (
			made.serialized++,
			actual.serialize(...args)
		)
	};
});
vi.mock('#lib/range-edit/layout.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/range-edit/layout.js')>();
	return {
		...actual,
		documentLayout: (...args: Parameters<typeof actual.documentLayout>) => (
			made.laidOut++,
			actual.documentLayout(...args)
		)
	};
});

import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { crossBlockClipboardArm } from '#lib/selection/cross-block/clipboard.js';
import type { CrossBlockHandlers } from '#lib/selection/cross-block/dispatch.js';
import { documentBytes } from '#lib/selection/range-bytes.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { createKeptStarts } from '#lib/editor-actions/commit/kept-starts.js';

describe('a copy reads the editor’s bytes, made once per content version', () => {
	it('serializes nothing and lays the document out once for two copies of one version', () => {
		const doc = parse('- one\n- two\n- three\n\nafter\n');
		const source = serialize(doc);
		const starts = createKeptStarts(() => doc);
		const bytes = documentBytes({
			version: () => 1,
			doc: () => doc,
			source: () => source,
			measured: starts.read
		});
		const selection = createSelectionState({ getDoc: () => doc });
		selection.enterCrossBlock({ path: [0, 1, 0], offset: 1 }, { path: [1], offset: 2 });
		const crossBlock = { reading: fixtureReading(), bytes } as unknown as CrossBlockHandlers;
		const arm = crossBlockClipboardArm({ selection, getDoc: () => doc, crossBlock });
		made.serialized = 0;
		made.laidOut = 0;

		expect(arm.copy()?.write.text).toBe('- wo\n- three\n\naf');
		expect(arm.copy()?.write.text).toBe('- wo\n- three\n\naf');
		expect(made).toEqual({ serialized: 0, laidOut: 1 });

		starts.opened();
		starts.changed(null);
		arm.copy();
		expect(made).toEqual({ serialized: 0, laidOut: 2 });
	});
});
