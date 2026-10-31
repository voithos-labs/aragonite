// @vitest-environment jsdom
// A container's marker drawn before its first child's text, from a DOM view's `ambientPrefix` as
// from `createContainerBlock`'s: each row runs over `FootnoteDefinition` and a DOM definition.
// Miss-analysis: new surface; a DOM container had no way to ask for the prefix.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	defineBlockView,
	definePlugin,
	getPluginMetadata,
	type AmbientPrefix,
	type BlockView,
	type BlockViewState
} from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import {
	registerFootnoteDefinition,
	type FootnoteDefMetadata
} from '#packages/footnotes/src/footnote-definition.js';
import FootnoteDefinition from '#packages/footnotes/src/FootnoteDefinition.svelte';

const SOURCE = 'text\n\n[^1]: the note\n';
const FIRST_CHILD = [1, 0];

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** The footnote definition's marker, the same rule `FootnoteDefinition` follows. */
function footnoteMarker(state: BlockViewState, onClick: () => void): AmbientPrefix {
	const marker = `[^${getPluginMetadata<FootnoteDefMetadata>(state.node)?.label ?? ''}]`;
	const reading = state.presentationMode === 'reading';
	const range = {
		start: 0,
		end: marker.length,
		className: 'footnote-def-marker',
		role: 'link' as const,
		onClick
	};
	return {
		text: `${marker}: `,
		interactive: [reading ? { ...range, focusable: true, onActivate: onClick } : range]
	};
}

function domDefinition(onClick: () => void = () => {}): BlockView {
	return defineBlockView({
		surface: 'container',
		ambientPrefix: (state) => footnoteMarker(state, onClick),
		mount(target, ctx) {
			target.className = 'footnote-def';
			ctx.container.mountChildren(target);
			return {};
		}
	});
}

const FORMS = [
	{ form: 'a Svelte component', view: () => svelteBlockView(FootnoteDefinition) },
	{ form: 'a DOM view', view: () => domDefinition() }
];

function mountDefinition(view: BlockView): MountedEditor {
	const plugin = definePlugin({
		name: 'view-footnote',
		setup: () => registerFootnoteDefinition(view)
	});
	return mountEditor({ source: SOURCE, plugins: [plugin] });
}

const marker = (editor: MountedEditor) =>
	blockHostAt(editor, FIRST_CHILD).querySelector<HTMLElement>('.footnote-def-marker');

describe.each(FORMS)('a container prefix drawn by $form', ({ view }) => {
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

describe('a DOM container prefix', () => {
	it('runs an interactive range’s click handler', async () => {
		let clicks = 0;
		const editor = mountDefinition(domDefinition(() => clicks++));
		await editor.settle();
		marker(editor)!.click();
		expect(clicks).toBe(1);
	});
});
