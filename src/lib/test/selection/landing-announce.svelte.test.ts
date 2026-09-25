// @vitest-environment jsdom
// Miss-analysis: every test of the selection channel drove a gesture that moves a SelectionState
// field (a restore, a `source` swap, a cross-block range). A plain caret landing moves none of
// them, and the browser event that reported it does not exist in jsdom, so no test could see it.
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
	// The payload is the position the caret is at, not the one it is leaving: subscribers read
	// the editor back, so an announcement made before the DOM caret moved would hand them the
	// block the split started in.
	it('reports the new paragraph when Enter splits one, without waiting for the browser', async () => {
		const { seen, editor } = recording('alpha one\n\nbeta two\n');

		await pressKeyAt(editor, [0], 'alpha one'.length, { key: 'Enter' });

		expect(seen).toEqual([caretAt([1], 0)]);
		expect(editor.instance.getSelection()).toEqual(caretAt([1], 0));
	});
});
