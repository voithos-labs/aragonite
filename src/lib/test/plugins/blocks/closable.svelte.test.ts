// @vitest-environment jsdom
// A container whose body folds away as its data says: the fold is written as one undo step and puts
// a caret in the body on the title row, reading mode folds without writing and shows the bytes again
// once it ends, and a reveal into a folded body opens it as one undo step.
// Miss-analysis: every fold was a package's own component with its own caret rule and reading-mode
// state, so no row held the editor's fold for a container a maker made.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { container, definePlugin } from '#lib/plugin.js';
import type { ContainerDrawContext } from '#lib/schema/drawing.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { FOLD_LINES, FOLD_SAMPLE, type FoldData } from '#lib/test/support/fold-fixture.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const OPEN = FOLD_SAMPLE.replace('[fold]', '[fold open]');
const AROUND = (fold: string) => `above\n\n${fold}\nbelow\n`;

/** The fixture's fold, drawn so a row can reach its context and count its updates. */
function drawn() {
	const seen: { ctx: ContainerDrawContext | null; closed: boolean[] } = { ctx: null, closed: [] };
	const plugin = definePlugin({
		name: 'folds',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				container<FoldData>({
					name: 'fold',
					label: 'Fold',
					lines: FOLD_LINES,
					closable: { closed: (d) => !d.open, set: (d, closed) => ({ ...d, open: !closed }) },
					sample: FOLD_SAMPLE,
					insert: { none: 'a test block type' },
					draw: (_block, ctx) => {
						seen.ctx = ctx;
						const dom = document.createElement('div');
						dom.append(ctx.children);
						return { dom, update: () => void seen.closed.push(ctx.closed) };
					}
				})
			]
		})
	});
	return { plugin, seen };
}

async function mounted(source: string) {
	const { plugin, seen } = drawn();
	const m = mountEditor({ source, plugins: [plugin] });
	await m.settle();
	return { m, seen, ctx: () => seen.ctx! };
}

const bodyMounted = (m: ReturnType<typeof mountEditor>) =>
	m.target.querySelector('[data-block-path="[1,1]"]') !== null;

describe('a fold written', () => {
	it('opens as one undo step, which an undo takes back', async () => {
		const { m, ctx } = await mounted(AROUND(FOLD_SAMPLE));
		expect(ctx().closed).toBe(true);
		ctx().setClosed(false);
		await m.settle();
		expect(m.source()).toBe(AROUND(OPEN));
		expect([ctx().closed, bodyMounted(m)]).toEqual([false, true]);
		m.instance.runCommand('history.undo');
		await m.settle();
		expect(m.source()).toBe(AROUND(FOLD_SAMPLE));
	});

	it('closes with the caret in the body, which goes to the title row', async () => {
		const { m, ctx } = await mounted(AROUND(OPEN));
		placeCaret(surfaceAt(m, [1, 1]), 2);
		ctx().setClosed(true);
		await m.settle();
		expect(m.source()).toBe(AROUND(FOLD_SAMPLE));
		expect(m.instance.getSelection()).toMatchObject({
			anchor: { path: [1, 0], offset: 0 },
			focus: { path: [1, 0], offset: 0 }
		});
	});

	it('closes under a range from above ending in the body, whose end stays there', async () => {
		const { m, ctx } = await mounted(AROUND(OPEN));
		const range = { anchor: { path: [0], offset: 0 }, focus: { path: [1, 1], offset: 0 } };
		await m.instance.setSelection(range);
		await m.settle();
		ctx().setClosed(true);
		await m.settle();
		expect(m.source()).toBe(AROUND(FOLD_SAMPLE));
		expect(m.instance.getSelection()).toMatchObject(range);
	});

	it('lands a caret aimed into its closed body on the title row', async () => {
		const { m } = await mounted(AROUND(FOLD_SAMPLE));
		const inBody = { path: [1, 1], offset: 2 };
		await m.instance.setSelection({ anchor: inBody, focus: inBody });
		await m.settle();
		expect(m.instance.getSelection()?.focus.path).toEqual([1, 0]);
		expect(m.source()).toBe(AROUND(FOLD_SAMPLE));
	});

	it('writes nothing for the state it is already in', async () => {
		const { m, ctx } = await mounted(AROUND(OPEN));
		ctx().setClosed(false);
		await m.settle();
		expect(m.instance.canRunCommand('history.undo')).toBe(false);
	});
});

describe('a fold in reading mode', () => {
	it('shows the body and writes nothing, and the bytes show again once it ends', async () => {
		const { m, ctx, seen } = await mounted(AROUND(FOLD_SAMPLE));
		m.props.presentationMode = 'reading';
		await m.settle();
		ctx().setClosed(false);
		await m.settle();
		expect(m.source()).toBe(AROUND(FOLD_SAMPLE));
		expect([ctx().closed, bodyMounted(m), seen.closed.at(-1)]).toEqual([false, true, false]);
		m.props.presentationMode = 'source';
		await m.settle();
		expect([ctx().closed, bodyMounted(m)]).toEqual([true, false]);
		expect(m.instance.canRunCommand('history.undo')).toBe(false);
	});
});

describe('a fold with no title row', () => {
	it('is refused when the type is made, the message naming the title row it needs', () => {
		const make = () =>
			container<{ open: boolean }>({
				name: 'quoted',
				label: 'Quoted',
				lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true },
				closable: { closed: (d) => !d.open, set: (d, closed) => ({ ...d, open: !closed }) },
				sample: '%> body',
				insert: { none: 'a test block type' }
			});
		expect(make).toThrow(/closable needs a title row, for now fenced lines with a title/);
	});
});

describe('a reveal into a folded body', () => {
	it('opens the fold as one undo step', async () => {
		const { m, ctx } = await mounted(AROUND(FOLD_SAMPLE));
		await m.instance.getRects().navigateTo([1, 1], 2);
		await m.settle();
		expect(m.source()).toBe(AROUND(OPEN));
		expect(ctx().closed).toBe(false);
		m.instance.runCommand('history.undo');
		await m.settle();
		expect(m.source()).toBe(AROUND(FOLD_SAMPLE));
	});
});
