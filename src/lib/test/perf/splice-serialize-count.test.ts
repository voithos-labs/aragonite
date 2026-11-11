// @vitest-environment jsdom
// A byte splice reads the document's bytes from the text the editor serializes once per content
// version, so a gesture that read them first, to work out its changes, serializes nothing more.
// Miss-analysis: nothing counted how often a write serialized the document, so a removal and a
// draft each serialized it twice per commit, once for its changes and once in the splice.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { disablePerfInstruments, enablePerfInstruments } from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import type { Mounted } from '#lib/test/harness/write-routes.js';
import type { Draft } from '#lib/schema/drafts.js';

vi.mock('#lib/core/serializer.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/core/serializer.js')>();
	return { ...actual, serialize: vi.fn(actual.serialize) };
});

beforeAll(installLayoutStubs);
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

const SOURCE = Array.from({ length: 12 }, (_, i) => `line ${i}\n`).join('\n');
const AT = SOURCE.indexOf('line 3');

const GESTURES: Record<
	string,
	{ setUp?(m: Mounted): Promise<void>; write(m: Mounted): Promise<unknown> }
> = {
	'Backspace over a range across blocks': {
		async setUp(m) {
			await m.instance.setSelection({
				anchor: { path: [3], offset: 2 },
				focus: { path: [5], offset: 2 }
			});
			await m.settle();
		},
		write: (m) => pressKey(surfaceAt(m, [3]), { key: 'Backspace' })
	},
	'a draft writing one letter': {
		// Opened first, since a dev build serializes the bytes a draft opens on.
		async setUp(m) {
			draft = m.instance.edit().replace({ from: AT, to: AT }, 'X');
		},
		write: () => draft!.commit()
	}
};
let draft: Draft | undefined;

describe('a byte splice serializes the document once per content version', () => {
	it.each(Object.entries(GESTURES))('%s', async (_, gesture) => {
		const m = mountEditor<EditorTestSurface>({ source: SOURCE });
		await m.settle();
		await gesture.setUp?.(m);
		// Armed, so the dev check that re-serializes a reused text stays out of the count.
		enablePerfInstruments();
		vi.mocked(serialize).mockClear();
		await gesture.write(m);
		await m.settle();
		expect(vi.mocked(serialize)).toHaveBeenCalledTimes(1);
		expect(m.source()).not.toBe(SOURCE);
	});
});
