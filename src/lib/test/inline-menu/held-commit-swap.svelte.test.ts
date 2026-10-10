// @vitest-environment jsdom
// A pick whose commit waits past a `source` swap writes nothing into the next document, through the
// editor's own swap and draft registry rather than stand-ins for them.
// Miss-analysis: the editor's swap reaching a waiting pick had only a browser test behind it.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('an inline-menu pick whose commit waits across a source swap', () => {
	it('writes nothing into the document the host loaded meanwhile', async () => {
		const mounted = mountEditor({ source: 'note a\n' });
		await mounted.settle();
		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		const menus = mounted.instance.getInlineMenus();
		menus.addSource({
			name: 'mentions',
			trigger: '@',
			items: () => [{ id: 'ada', label: 'Ada', insert: '@Ada' }],
			onCommit: async (_item, _range, pick) => {
				await held;
				await pick.insertMarkdown('> card', { placement: 'below' });
			}
		});
		const surface = surfaceAt(mounted, [0]);
		placeCaret(surface, 'note a'.length);
		menus.open('mentions');
		await mounted.settle();
		await pressKey(surface, { key: 'Enter' });
		expect(mounted.source()).toBe('note a@Ada\n');

		mounted.props.source = 'note b\n';
		await mounted.settle();
		// A caret in the new document, so a write that escaped the pick would have somewhere to land.
		placeCaret(surfaceAt(mounted, [0]), 'note b'.length);
		const edits: unknown[] = [];
		mounted.instance.getEvents().on('edit', (edit) => edits.push(edit));
		release();
		await mounted.settle();

		expect(mounted.source()).toBe('note b\n');
		expect(edits).toEqual([]);
	});
});
