// @vitest-environment jsdom
// Miss-analysis: the swap's selection reset was pinned only through the decoration epoch,
// which fires on its own; nothing asked whether the selection CHANNEL fires, and the swap
// reaches it holding a plain caret, which leaves every SelectionState field already null.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs, mountEditor, placeCaret, surfaceAt } from '../blocks/editor-mount';
import type { MountedEditor } from '../blocks/editor-mount';
import type { EditorSelection } from '../../selection/primitives';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;

afterEach(async () => {
	await mounted?.destroy();
	mounted = null;
});

/** Mount over `source`, park a plain caret in the first block, and start recording. */
function swapHarness(source: string) {
	const props = $state({ source });
	mounted = mountEditor(props);
	placeCaret(surfaceAt(mounted, [0]), 3);
	const seen: (EditorSelection | null)[] = [];
	mounted.instance.getEvents().on('selectionChange', (selection) => seen.push(selection));
	return { props, seen, editor: mounted };
}

describe('a `source` prop swap announces the selection it drops', () => {
	it('reports no selection, once, to a subscriber that read a caret before the swap', async () => {
		const { props, seen, editor } = swapHarness('alpha one\n\nbeta two\n');

		props.source = 'gamma only\n';
		await editor.settle();

		expect(seen).toEqual([null]);
	});

	// A swap out of a live cross-block range moves the guarded fields too, so the clear's own
	// notification and the announcement must coalesce rather than emit the transition twice.
	it('emits once when the outgoing document held a cross-block selection', async () => {
		const { props, seen, editor } = swapHarness('alpha one\n\nbeta two\n');
		await editor.instance.setSelection({
			anchor: { path: [0], offset: 0 },
			focus: { path: [1], offset: 2 }
		});
		await editor.settle();
		seen.length = 0;

		props.source = 'gamma only\n';
		await editor.settle();

		expect(seen).toEqual([null]);
	});
});
