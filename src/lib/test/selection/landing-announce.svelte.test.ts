// @vitest-environment jsdom
// Miss-analysis: every selection-channel test moved a state field; a plain caret move moves none.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs, mountEditor, pressKeyAt } from '$lib/test/harness/mount-editor.svelte';
import type { MountedEditor } from '$lib/test/harness/mount-editor.svelte';
import type { EditorSelection } from '../../selection/primitives';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;

afterEach(async () => {
	await mounted?.destroy();
	mounted = null;
});

const caretAt = (path: number[], offset: number): EditorSelection => ({
	anchor: { path, offset },
	focus: { path, offset }
});

/** Mount over `source` and record what subscribers hear from here on. */
function recording(source: string) {
	mounted = mountEditor({ source });
	const seen: (EditorSelection | null)[] = [];
	mounted.instance.getEvents().on('selectionChange', (selection) => seen.push(selection));
	return { seen, editor: mounted };
}

describe('the editor announces the caret it lands', () => {
	// The payload is where the caret is, not where it was: subscribers read the editor back, so
	// announcing before the DOM caret moved would name the block the split started in.
	it('reports the new paragraph when Enter splits one, without waiting for the browser', async () => {
		const { seen, editor } = recording('alpha one\n\nbeta two\n');

		await pressKeyAt(editor, [0], 'alpha one'.length, { key: 'Enter' });

		expect(seen).toEqual([caretAt([1], 0)]);
		expect(editor.instance.getSelection()).toEqual(caretAt([1], 0));
	});
});
