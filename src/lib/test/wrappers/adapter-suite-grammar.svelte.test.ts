// @vitest-environment jsdom
// The adapter suite's shared grammar, drawn with plain DOM: the chip claims `{{name}}` and the
// memo carries its badge, so a framework app's views have something to draw.
// Miss-analysis: only the adapter smoke mounted this grammar, so a chip claiming nothing passed every
// repo gate.
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	BLOCK_VIEWS_SOURCE,
	blockViewsPlugins,
	MEMO_LENGTH_ATTR
} from '../../../../examples/adapter-suite/block-view-kinds';

beforeEach(installLayoutStubs);
afterEach(destroyMountedEditors);

const el = () => ({ dom: document.createElement('div') });

it('draws its chip with the claimed name and a top-level memo with its length', async () => {
	const plugins = blockViewsPlugins({
		memo: (_b, ctx) => {
			const dom = document.createElement('div');
			dom.append(ctx.source);
			return { dom };
		},
		label: (_b, ctx) => {
			const dom = document.createElement('div');
			dom.append(ctx.source);
			return { dom };
		},
		box: (_b, ctx) => {
			const dom = document.createElement('div');
			dom.append(ctx.children);
			return { dom };
		},
		note: el,
		dice: el,
		chip: (target, props) => {
			target.innerHTML = `<span class="chip" data-from="${props.from}">${props.data.name}</span>`;
			return {};
		},
		memoLength: (target, props) => {
			target.innerHTML = `<span class="memo-length">${props.paint.attrs?.[MEMO_LENGTH_ATTR]}</span>`;
			return {};
		}
	});
	const editor = mountEditor({ source: BLOCK_VIEWS_SOURCE, plugins });
	await editor.settle();
	expect(editor.target.querySelector('.chip')?.textContent).toBe('pebble');
	expect(editor.target.querySelector('.memo-length')?.textContent).toBe('9');
});
