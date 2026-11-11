// @vitest-environment jsdom
// A paste over a range is a removal and then an insert in one undo step, so the insert writes the
// list the removal left where it stands. When the insert fails, a mounted editor puts every block
// back through its reactive tree, and the document is the removal's alone.
// Miss-analysis: the rollback rows ran over plain nodes, and no mounted row failed a write that
// joined its undo entry.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import type { NodeView } from '#lib/core/node-views.js';
import type { EditorError } from '#lib/editor-events.js';
import { augmentBuiltin, tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { dispatchClipboardEvent, StubDataTransfer } from '#lib/test/harness/clipboard-events.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);
const originalListRebuild = tryGetBlockKindDescriptor('list')!.rebuildRaw!;
afterEach(async () => {
	resetEditorEnv();
	augmentBuiltin('list', { container: { rebuildRaw: originalListRebuild } });
	await destroyMountedEditors();
});

/** Every block's blank lines and bytes, outermost first: `getSource()` reads the top level alone. */
function bytesOf(root: { children?: readonly NodeView[] }, path: number[] = []): string[] {
	return (root.children ?? []).flatMap((node, i) => [
		`${[...path, i].join('.')} ${JSON.stringify(node.leadingTrivia + node.raw)}`,
		...bytesOf(node, [...path, i])
	]);
}

describe('a paste over a range whose insert fails, in a mounted editor', () => {
	it.each([
		{ name: 'one line', text: 'X' },
		{ name: 'a paragraph and a nested list', text: 'X\n\n- p\n  - q\n' }
	])('$name: every block is as the removal left it', async ({ text }) => {
		const m = mountEditor<EditorTestSurface>({ source: 'top\n\n- one\n- two\n  - deep\n\nlast\n' });
		await m.settle();
		await m.instance.setSelection({
			anchor: { path: [1, 0, 0], offset: 1 },
			focus: { path: [1, 1, 0], offset: 1 }
		});
		await m.settle();
		const events = m.instance.getEvents();
		const errors: EditorError[] = [];
		events.on('error', (error) => errors.push(error));
		let removed: string[] = [];
		// Armed once the removal has landed, so the insert is the write that fails.
		const off = events.on('edit', () => {
			off();
			removed = bytesOf(m.instance.__test.getDocument());
			augmentBuiltin('list', {
				container: {
					rebuildRaw: (node) => {
						if (!m.instance.__test.getDocument().children.includes(node)) {
							return originalListRebuild(node);
						}
						throw new Error('rebuild blew up');
					}
				}
			});
		});
		// A production build reports the throw on `error` instead of rethrowing it into the handler.
		configureEditorEnv({ isDev: false });

		dispatchClipboardEvent(
			surfaceAt(m, [1, 0, 0]),
			'paste',
			new StubDataTransfer({ 'text/plain': text })
		);
		await m.settle();

		expect(errors.map((error) => error.origin)).toEqual(['commit']);
		expect(bytesOf(m.instance.__test.getDocument())).toEqual(removed);
		expect(m.source()).toBe('top\n\n- owo\n  - deep\n\nlast\n');
	});
});
