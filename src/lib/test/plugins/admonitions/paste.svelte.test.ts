// @vitest-environment jsdom
// Alerts pasted in a mounted editor: one pasted into an alert of its type joins it, and one of
// another type nests.
// Miss-analysis: the join by `alertType` was held only by a table of page-registered kinds, which a
// plugin value's alert is not, so dropping `merges` from the alert left every row green.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { admonitions } from '#packages/admonitions/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** Pastes `text` at the end of the block at `path`. */
async function pasteAtEnd(editor: MountedEditor, path: number[], text: string) {
	const surface = surfaceAt(editor, path);
	placeCaret(surface, surface.textContent?.length ?? 0);
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: {
			types: ['text/plain'],
			getData: (type: string) => (type === 'text/plain' ? text : ''),
			files: [],
			items: []
		}
	});
	surface.dispatchEvent(event);
	await editor.settle();
}

describe('an alert pasted into an alert', () => {
	it.each([
		['of its type joins it', '> [!NOTE]\n> pasted\n', '> [!NOTE]\n> bodypasted\n>\n>\n'],
		[
			'of another type nests',
			'> [!TIP]\n> pasted\n',
			'> [!NOTE]\n> body\n>\n> > [!TIP]\n> > pasted\n>\n>\n'
		]
	])('%s', async (_name, text, after) => {
		const editor = mountEditor({ source: '> [!NOTE]\n> body\n', plugins: [admonitions] });
		await editor.settle();
		await pasteAtEnd(editor, [0, 0], text);
		expect(editor.source()).toBe(after);
	});
});
