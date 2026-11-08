// @vitest-environment jsdom
// Every chord in a mounted editor dispatches against the editor's one command context: a throwing
// plugin command reaches the `error` event, and `keybindings` set after mount apply at once.
// Miss-analysis: no unit test changed `keybindings` after mount or checked the error event.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { command, definePlugin } from '#lib/plugin.js';
import type { EditorError } from '#lib/editor-events.js';

beforeEach(() => {
	installLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
});

describe("a mounted editor's command context", () => {
	it('reports a throwing plugin command on the error event, once', async () => {
		const fire = command({
			id: 'fire',
			title: 'Fire',
			chord: 'Mod+Shift+9',
			run() {
				throw new Error('kaboom');
			}
		});
		const boom = definePlugin({
			name: 'boom',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ commands: [fire] })
		});
		const mounted = mountEditor({ source: 'alpha\n', plugins: [boom] });
		const errors: EditorError[] = [];
		mounted.instance.getEvents().on('error', (e) => errors.push(e));
		selectRange(surfaceAt(mounted, [0]), 0, 0);

		await pressKey(surfaceAt(mounted, [0]), { key: '9', ctrlKey: true, shiftKey: true });

		expect(errors.map((e) => [e.origin, e.context?.plugin])).toEqual([['subscriber', 'boom']]);
	});

	it('applies keybindings changed after mount on the next press', async () => {
		const mounted = mountEditor({ source: 'alpha\n' });
		mounted.props.keybindings = [{ chord: 'Mod+Shift+9', command: 'format.toggleStrong' }];
		await mounted.settle();
		selectRange(surfaceAt(mounted, [0]), 0, 5);

		await pressKey(surfaceAt(mounted, [0]), { key: '9', ctrlKey: true, shiftKey: true });

		expect(mounted.source()).toBe('**alpha**\n');
	});
});
