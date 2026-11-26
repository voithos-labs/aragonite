// @vitest-environment jsdom
// A container's marker drawn before its first child's text, from `createContainerBlock`'s
// `getAmbientPrefix`, over the harness `FootnoteDefinition`. A plugin value's marker is
// `IndentedLines.link`, whose rows are `plugins/blocks/marker-link.svelte.test.ts`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { definePlugin, type AmbientInteractiveRange, type BlockView } from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import { registerFootnoteDefinition } from '#lib/test/harness/registered-footnotes.js';
import { FootnoteDefinitionView as FootnoteDefinition } from '#lib/test/harness/registered-footnotes.js';

const SOURCE = 'text\n\n[^1]: the note\n';
const FIRST_CHILD = [1, 0];

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

function mountDefinition(view: BlockView): MountedEditor {
	const plugin = definePlugin({
		name: 'view-footnote',
		setup: () => registerFootnoteDefinition(view)
	});
	return mountEditor({ source: SOURCE, plugins: [plugin] });
}

const marker = (editor: MountedEditor) =>
	blockHostAt(editor, FIRST_CHILD).querySelector<HTMLElement>('.footnote-def-marker');

describe('a container prefix drawn by a Svelte component', () => {
	const view = () => svelteBlockView(FootnoteDefinition);
	it('draws the marker before its first child’s text, outside the bytes it edits', async () => {
		const editor = mountDefinition(view());
		await editor.settle();
		expect(blockHostAt(editor, FIRST_CHILD).textContent).toContain('[^1]: the note');
		expect(marker(editor)?.textContent).toBe('[^1]');
		expect(editor.source()).toBe(SOURCE);
	});

	it('follows the presentation mode: the marker takes a tab stop only in reading mode', async () => {
		const editor = mountDefinition(view());
		await editor.settle();
		expect(marker(editor)?.tabIndex).toBe(-1);
		editor.props.presentationMode = 'reading';
		flushSync();
		await editor.settle();
		expect(marker(editor)?.tabIndex).toBe(0);
	});
});

/** Never called: a marker range with a tab stop must say what Enter and Space do, and
 *  `npm run check` fails once a directive inside goes unused. */
export function compileTimePins(isReading: boolean): AmbientInteractiveRange[] {
	const base = { start: 0, end: 3, className: 'marker', onClick: () => {} };
	// @ts-expect-error a focusable range must say what Enter and Space do
	const withoutActivate: AmbientInteractiveRange = { ...base, focusable: true };
	// The footnote marker's form: its stop is decided by mode, so `focusable` is a plain boolean.
	const modeDecided: AmbientInteractiveRange = { ...base, focusable: isReading, onActivate() {} };
	const noStop: AmbientInteractiveRange = { ...base };
	return [withoutActivate, modeDecided, noStop];
}
