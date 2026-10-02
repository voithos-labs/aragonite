// @vitest-environment jsdom
// The image overlay's position sync re-runs only when the selected image changes, so a range
// growing across the document never wakes it.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
	installLayoutStubs,
	destroyMountedEditors,
	mountEditor
} from '$lib/test/harness/mount-editor.svelte';
import type { EditorTestSurface } from '$lib/components/editor-root-test-surface';

const syncRuns = vi.hoisted(() => ({ count: 0 }));

vi.mock('$lib/components/image/image-edit-commit', async (original) => {
	const actual = await original<typeof import('$lib/components/image/image-edit-commit')>();
	return {
		...actual,
		createImageEditCommitter: (...args: Parameters<typeof actual.createImageEditCommitter>) => {
			const committer = actual.createImageEditCommitter(...args);
			return {
				...committer,
				syncOverlayToWidget: (getOverlay: () => HTMLElement | null) => {
					syncRuns.count++;
					return committer.syncOverlayToWidget(getOverlay);
				}
			};
		}
	};
});

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('the image overlay across a range', () => {
	it('runs its sync zero times while a range grows block by block', async () => {
		const editor = mountEditor<EditorTestSurface>({
			source: '![a](x.png)\n\none\n\ntwo\n\nthree\n'
		});
		await editor.settle();
		syncRuns.count = 0;

		for (const focus of [2, 3, 2, 3]) {
			await editor.instance.setSelection({
				anchor: { path: [1], offset: 1 },
				focus: { path: [focus], offset: 2 }
			});
			await editor.settle();
		}

		expect(editor.instance.__test.isCrossBlockActive()).toBe(true);
		expect(syncRuns.count).toBe(0);
	});
});
