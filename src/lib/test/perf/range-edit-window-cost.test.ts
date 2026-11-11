// @vitest-environment jsdom
// G4.342: a range edit reads the blocks its range reaches, never the document. Recorded, not held
// yet: every route below serializes the document and parses its whole answer, so both costs grow
// with the document; G4.340's rows record the same of the top-level blocks it measures. A fix
// that brings a cost down to the range's blocks reds that cost's row here, which then flips.
// Miss-analysis: the splice cost rows drove `commitSource` alone and the gate timed no range
// edit, so nothing counted what the range-edit core reads to make its answer.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { WRITE_ROUTES, type WriteRoute } from '#lib/test/harness/write-routes.js';

vi.mock('#lib/core/serializer.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/core/serializer.js')>();
	return { ...actual, serialize: vi.fn(actual.serialize) };
});

beforeAll(installLayoutStubs);
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

const RANGE_EDITS = WRITE_ROUTES.filter((route) => route.laysOutItsAnswer);

/** What `route`'s write reads in a document of `n` blocks, made as a range edit after typing is:
 *  a host asked for the text, then a letter was typed, so no text of this version stands. */
async function readsOf(route: WriteRoute, n: number) {
	const m = mountEditor<EditorTestSurface>({ source: route.source(n) });
	await m.settle();
	m.source();
	const first = surfaceAt(m, [0]);
	typeInto(first, first.textContent + 'x');
	await m.settle();
	await route.setUp?.(m, n);
	// Armed, so the dev checks that parse and serialize the document stay out of the counts.
	enablePerfInstruments();
	resetPerfInstruments();
	vi.mocked(serialize).mockClear();
	await route.write(m, n);
	await m.settle();
	const reads = {
		parsedBytes: perfSnapshot().parseBytes,
		serializes: vi.mocked(serialize).mock.calls.length
	};
	await m.destroy();
	return reads;
}

describe('G4.342 recorded: a range edit reads its whole document', () => {
	it.each(RANGE_EDITS)('$name parses its whole answer, once', async (route) => {
		const small = await readsOf(route, 40);
		const large = await readsOf(route, 400);
		const grown = route.source(400).length - route.source(40).length;
		expect(large.parsedBytes - small.parsedBytes).toBe(grown);
	});

	it.each(RANGE_EDITS)('$name serializes the document, once', async (route) => {
		expect((await readsOf(route, 40)).serializes).toBe(1);
		expect((await readsOf(route, 400)).serializes).toBe(1);
	});
});
