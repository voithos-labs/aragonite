// @vitest-environment jsdom
// `blockDragHandles` is read live: switching it after mount adds or removes handles on blocks
// that are already built, as the consumer guide promises.
// Miss-analysis: every case mounted with the prop fixed, so nothing pinned a switch after mount.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, tick } from 'svelte';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';

installLayoutStubs();

let mounted: MountedEditor | undefined;

afterEach(async () => {
	await mounted?.destroy();
	mounted = undefined;
});

function handleCount(): number {
	return mounted!.target.querySelectorAll('.block-drag-handle').length;
}

async function setHandles(on: boolean): Promise<void> {
	mounted!.props.blockDragHandles = on;
	flushSync();
	await tick();
	await mounted!.settle();
}

describe('blockDragHandles after mount', () => {
	it('removes the handles from built blocks, then puts the same ones back', async () => {
		mounted = mountEditor({ source: '- one\n- two\n\n```\ncode\n```\n\n---\n' });
		const initial = handleCount();
		expect(initial).toBeGreaterThan(0);

		await setHandles(false);
		expect(handleCount()).toBe(0);

		await setHandles(true);
		expect(handleCount()).toBe(initial);
	});

	it('grows handles on built blocks when an editor mounted without them turns them on', async () => {
		mounted = mountEditor({ source: '- one\n- two\n\n```\ncode\n```\n', blockDragHandles: false });
		expect(handleCount()).toBe(0);

		await setHandles(true);
		expect(handleCount()).toBeGreaterThan(0);
	});
});
