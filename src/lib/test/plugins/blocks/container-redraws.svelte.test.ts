// @vitest-environment jsdom
// What a key redraws among forty containers a plugin draws: a key beside them redraws and updates
// none, and a key in one's body updates that one once and draws nothing anew, on colon, quote and
// fenced lines alike (an admonition, an alert, a details section).
// Miss-analysis: a key beside forty boxes was counted at each slice's stop and never kept as a row,
// so nothing held a container's drawing to one update per key in its body.
import { afterEach, beforeAll, expect, it } from 'vitest';
import {
	builtin,
	colonLines,
	container,
	definePlugin,
	QUOTE_LINES,
	type ContainerDrawContext
} from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { FOLD_LINES, type FoldData } from '#lib/test/support/fold-fixture.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

/** One per drawing made: how many `update` calls it has heard. */
const drawings: { updates: number }[] = [];

function draw(_block: unknown, ctx: ContainerDrawContext) {
	const drawing = { updates: 0 };
	drawings.push(drawing);
	const dom = document.createElement('div');
	dom.append(ctx.children);
	return { dom, update: () => void drawing.updates++ };
}

const box = container<{ name: string }>({
	name: 'aside',
	label: 'Aside',
	lines: colonLines({ names: ['aside'] }),
	sample: ':::aside T\nbody\n:::\n',
	insert: { none: 'a test block type' },
	draw
});
const alert = container<{ type: string }>({
	name: 'alert',
	label: 'Alert',
	before: builtin.blocks.blockquote,
	lines: {
		...QUOTE_LINES,
		head: {
			match: /^\[!(\w+)\]$/,
			data: (match) => ({ type: match[1] }),
			write: (data) => `[!${data.type}]`
		}
	},
	sample: '> [!NOTE]\n> x\n',
	insert: { none: 'a test block type' },
	draw
});
const fold = container<FoldData>({
	name: 'fold',
	label: 'Fold',
	lines: FOLD_LINES,
	sample: '[fold open]\ntitle: T\n\nbody\n\n[/fold]\n',
	insert: { none: 'a test block type' },
	draw
});
const plugin = definePlugin({
	name: 'counted',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ blocks: [box, alert, fold] })
});

/** Two letters typed at the end of `el`'s text, the caret already there. */
async function twoKeys(m: MountedEditor, el: HTMLElement): Promise<void> {
	placeCaret(el, el.textContent!.length);
	await m.settle();
	for (const drawing of drawings) drawing.updates = 0;
	for (const letter of 'xy') {
		typeInto(el, el.textContent + letter);
		await m.settle();
	}
}

it.each([
	['colon lines', ':::aside T\nbody\n:::\n\n', [20, 1]],
	['quote lines', '> [!NOTE]\n> body\n\n', [20, 0]],
	['fenced lines', '[fold open]\ntitle: T\n\nbody\n\n[/fold]\n\n', [20, 1]]
])(
	'a key among forty containers on %s redraws only the one it is typed in',
	async (_, one, body) => {
		drawings.length = 0;
		const m = mountEditor({ source: `${one.repeat(40)}para\n`, plugins: [plugin] });
		await m.settle();
		expect(drawings).toHaveLength(40);

		await twoKeys(m, surfaceAt(m, [40]));
		expect(drawings).toHaveLength(40);
		expect(drawings.filter((d) => d.updates > 0)).toEqual([]);

		await twoKeys(m, surfaceAt(m, body));
		expect(drawings).toHaveLength(40);
		expect(drawings.map((d) => d.updates).filter((n) => n > 0)).toEqual([2]);
		expect(m.source()).toContain('bodyxy');
	}
);
