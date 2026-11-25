// @vitest-environment jsdom
// Alerts pasted in a mounted editor: one pasted into an alert of its type joins it and one of
// another type nests, and the editor's own copy of an alert stays an alert with the rewrite on.
// Miss-analysis: the join by `alertType` was held only by a table of page-registered kinds, which a
// plugin value's alert is not, so dropping `merges` from the alert left every row green.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { admonitions } from '#packages/admonitions/src/index.js';
import { OWN_CLIPBOARD_TYPE } from '#lib/browser/clipboard.js';
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

/** Pastes `text` at the end of the block at `path`, with `own` as the editor's own entry. */
async function pasteAtEnd(editor: MountedEditor, path: number[], text: string, own?: string) {
	const surface = surfaceAt(editor, path);
	placeCaret(surface, surface.textContent?.length ?? 0);
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: {
			types: own ? ['text/plain', OWN_CLIPBOARD_TYPE] : ['text/plain'],
			getData: (type: string) =>
				type === 'text/plain' ? text : type === OWN_CLIPBOARD_TYPE ? (own ?? '') : '',
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

it('keeps the editor’s own copy of an alert an alert, the rewrite on', async () => {
	const alert = '> [!TIP]\n> copied\n';
	const editor = mountEditor({
		source: 'Intro.\n',
		plugins: [admonitions({ convertAlertsOnPaste: true })]
	});
	await editor.settle();
	await pasteAtEnd(editor, [0], alert, alert);
	expect(editor.source()).toContain('> [!TIP]');
	expect(editor.source()).not.toContain(':::');
});
