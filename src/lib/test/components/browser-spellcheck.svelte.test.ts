// @vitest-environment jsdom
// Whether the browser's own spell checker runs on the editor's prose: the host's `spellcheck`
// prop, turned off on its own wherever a running plugin checks spelling itself.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

// One of each prose surface: a paragraph, a heading, a list item, a quote, and a table cell.
const SOURCE =
	'# Title\n\nsome words\n\n- an item\n\n> a quote\n\n| a | b |\n| - | - |\n| c | d |\n';

const checker = definePlugin({
	name: 'unit-speller',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ checksSpelling: true })
});

function proseSurfaces(target: HTMLElement): HTMLElement[] {
	return [...target.querySelectorAll<HTMLElement>('.text-editable-block, .table-cell')];
}

/** Each prose surface's `spellcheck` attribute, null where the browser decides. */
function attributes(target: HTMLElement): (string | null)[] {
	const surfaces = proseSurfaces(target);
	expect(surfaces.length).toBeGreaterThanOrEqual(8);
	return surfaces.map((el) => el.getAttribute('spellcheck'));
}

const all = (value: string | null, target: HTMLElement) =>
	expect(new Set(attributes(target))).toEqual(new Set([value]));

describe('the browser spell checker on prose', () => {
	it('is the browser default with nothing set, and code keeps its own off', async () => {
		const m = mountEditor({ source: SOURCE + '\n```\ncode\n```\n' });
		await m.settle();
		all(null, m.target);
		expect(m.target.querySelector('.code-block')?.getAttribute('spellcheck')).toBe('false');
	});

	it('turns off on every prose surface with `spellcheck: false`, and back on live', async () => {
		const m = mountEditor({ source: SOURCE, spellcheck: false });
		await m.settle();
		all('false', m.target);
		m.props.spellcheck = true;
		await m.settle();
		all(null, m.target);
	});

	it('turns off while a running plugin checks spelling, and back on when `use` drops it', async () => {
		const m = mountEditor({ source: SOURCE, plugins: [checker] });
		await m.settle();
		all('false', m.target);
		m.instance.use([]);
		await m.settle();
		all(null, m.target);
	});
});
