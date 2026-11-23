// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { emoji } from '#packages/emoji/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

// The glyph is what the widget shows; the element the editor hands it keeps the source bytes on
// `data-source-*`, so the walk from the page back to bytes reads `:smile:` while the page shows 😄.
describe('the emoji drawing', () => {
	it('draws the glyph, unselectable, on an element holding the source range', async () => {
		const m = mountEditor({ source: 'a :smile: b\n', plugins: [emoji] });
		await m.settle();
		const [glyph] = m.target.querySelectorAll<HTMLElement>('.md-emoji-widget');
		expect(glyph.textContent).toBe('😄');
		expect(glyph.style.userSelect).toBe('none');
		expect(glyph.dataset.sourceStart).toBe('2');
		expect(glyph.dataset.sourceEnd).toBe('9');
	});
});
