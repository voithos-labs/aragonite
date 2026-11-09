// @vitest-environment jsdom
// Miss-analysis: the harness rows run on plain objects, never through the editor's `$state` tree.
// A to-do click in a mounted editor reads no link definitions: through the editor's tree the
// item it rewrites still holds the very children it held.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	blockHostAt,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import * as linkReferenceMap from '#lib/components/link-reference-map.js';

vi.mock(import('#lib/components/link-reference-map.js'), async (original) => {
	const actual = await original();
	return { ...actual, definitionsAfter: vi.fn(actual.definitionsAfter) };
});

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

describe('a to-do click beside a definition', () => {
	it('names nothing replaced, so the definitions are not read again', async () => {
		mounted = mountEditor({ source: '- [ ] a\n- [ ] b\n\n[x]: /u\n' });
		const after = vi.mocked(linkReferenceMap.definitionsAfter);
		after.mockClear();
		const box = blockHostAt(mounted, [0])
			.querySelectorAll<HTMLElement>(':scope > .list-block > .list-item-block')[1]
			?.querySelector<HTMLElement>('.task-checkbox');
		box!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await mounted.settle();

		expect(mounted.source()).toBe('- [ ] a\n- [x] b\n\n[x]: /u\n');
		expect(after).toHaveBeenCalledTimes(1);
		const replaced = after.mock.calls[0][1];
		expect(linkReferenceMap.lrdMapCouldChange(replaced)).toBe(false);
	});
});
