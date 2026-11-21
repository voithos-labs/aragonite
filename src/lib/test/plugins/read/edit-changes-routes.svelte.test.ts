// @vitest-environment jsdom
// `edit.changes` over every write route: a listener that applies each edit's changes to the text it
// held ends on the document's text, a load starting it over.
// Miss-analysis: a new home; `edit` carried a path, never the bytes a write replaced.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { definePluginUnit } from '#lib/schema/plugin-unit.js';
import type { Change } from '#lib/editor-events.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { WRITE_ROUTES, written } from '#lib/test/harness/write-routes.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const N = 12;

const applied = (text: string, changes: readonly Change[]) =>
	[...changes]
		.reverse()
		.reduce((out, c) => out.slice(0, c.from) + c.insert + out.slice(c.to), text);

describe("applying each edit's changes gives the document after every write route", () => {
	it.each(WRITE_ROUTES)('$name', async (route) => {
		let text = '';
		let edits = 0;
		const follower = definePluginUnit({
			name: 'follower',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				setup(editor) {
					text = editor.doc.text;
					editor.on('edit', (info) => {
						edits++;
						text = applied(text, info.changes);
					});
					editor.on('load', (load) => {
						edits++;
						text = load.doc.text;
					});
				}
			})
		});
		const plugins = [follower, ...((route.plugins ?? []) as [])];
		const m = mountEditor<EditorTestSurface>({ source: route.source(N), plugins });
		await m.settle();
		await route.setUp?.(m, N);
		const before = written(m);

		await route.write(m, N);

		expect(written(m), 'the route wrote nothing').not.toEqual(before);
		expect(text).toBe(m.source());
		// A write no event announces (a re-read under a new plugin list) keeps the bytes.
		if (edits === 0) expect(m.source()).toBe(before.source);
	});
});
