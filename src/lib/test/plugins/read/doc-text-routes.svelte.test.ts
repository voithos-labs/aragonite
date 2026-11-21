// @vitest-environment jsdom
// A `Doc` read without its text, then replaced by a write on any route, still reads the text of
// its own version: rebuilt from the tree and what each route's write reported replacing.
// Miss-analysis: the record was copied whole per key, which no route could get wrong; the rebuild
// trusts each route's runs, and no row read a held version's text after every route.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { WRITE_ROUTES, written } from '#lib/test/harness/write-routes.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const N = 12;

describe("an unread doc keeps its version's text through every write route", () => {
	it.each(WRITE_ROUTES)('$name', async (route) => {
		let editor: Editor | undefined;
		const holder = definePluginUnit({
			name: 'holder',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ setup: (e) => void (editor = e) })
		});
		const plugins = [holder, ...((route.plugins ?? []) as [])];
		const m = mountEditor<EditorTestSurface>({ source: route.source(N), plugins });
		await m.settle();
		await route.setUp?.(m, N);
		const before = written(m);
		const held = editor!.doc;

		await route.write(m, N);

		expect(written(m), 'the route wrote nothing').not.toEqual(before);
		expect(held.text).toBe(before.source);
	});
});
