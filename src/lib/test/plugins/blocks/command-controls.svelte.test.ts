// @vitest-environment jsdom
// Miss-analysis: a command reached its block's drawing through nothing on the plugin values, so no
// row ran a command beside a drawing, or one listed elsewhere over a drawn block.
// `Drawn.controls`: a block type's own command is handed its block's controls while the block is drawn;
// a command its type doesn't place never is, whatever block it runs on.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import { command } from '#lib/schema/plugin-command.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { BoxDrawContext } from '#lib/schema/drawing.js';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

interface Tagged {
	tag: string;
}

/** What each command was handed, in run order. */
let handed: unknown[] = [];

const placed = command<Block<never>, Tagged>({
	id: 'placed',
	title: 'Placed',
	run: (_editor, _block, controls) => void handed.push(controls)
});
const listed = command<Block<never>, Tagged>({
	id: 'listed',
	title: 'Listed',
	run: (_editor, _block, controls) => void handed.push(controls)
});
const loose = command<Block<never>>({
	id: 'loose',
	title: 'Loose',
	run: (_editor, _block, controls) => void handed.push(controls)
});

// A button that takes the caret whole, and controls naming its type and its block's body.
const tagged = (tag: string) => (block: Block<never>, ctx: BoxDrawContext) => {
	const dom = document.createElement('button');
	dom.addEventListener('click', () => ctx.focusWhole());
	return { dom, controls: { tag: `${tag} ${block.body}` } };
};

const boxes = definePlugin({
	name: 'boxes',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			fencedBlock({
				name: 'mine',
				label: 'Mine',
				fence: { info: 'mine' },
				sample: '```mine\nx\n```',
				insert: { none: 'a test block type' },
				actions: [{ label: 'Placed', command: placed }],
				commands: [listed],
				edit: 'box',
				draw: tagged('mine')
			}),
			fencedBlock({
				name: 'other',
				label: 'Other',
				fence: { info: 'other' },
				sample: '```other\nx\n```',
				insert: { none: 'a test block type' },
				edit: 'box',
				draw: tagged('other')
			})
		],
		commands: [loose]
	})
});

async function mounted() {
	handed = [];
	const editor = mountEditor({
		source: '```mine\nx\n```\n\n```other\ny\n```\n',
		plugins: [boxes]
	});
	await editor.settle();
	const [mine, , other] = editor.instance.doc.blocks;
	return { editor, mine, other };
}

describe("a drawing's controls", () => {
	it("reaches its block type's own command while the block is drawn", async () => {
		const { editor, mine } = await mounted();
		expect(editor.instance.run(placed, mine)).toBe(true);
		expect(handed).toEqual([{ tag: 'mine x' }]);
	});

	it("reaches a command its type lists with no key or row, and only on that type's block", async () => {
		const { editor, mine, other } = await mounted();
		expect(editor.instance.run(listed, mine)).toBe(true);
		expect(editor.instance.run(listed, other)).toBe(false);
		expect(handed).toEqual([{ tag: 'mine x' }]);
	});

	it('never reaches a command the block type does not place', async () => {
		const { editor, mine, other } = await mounted();
		editor.instance.run(loose, mine);
		editor.instance.run(loose, other);
		expect(handed).toEqual([undefined, undefined]);
	});

	it("never reaches a command placed by another type, which doesn't run there", async () => {
		const { editor, other } = await mounted();
		expect(editor.instance.run(placed, other)).toBe(false);
		expect(handed).toEqual([]);
	});

	// Miss-analysis: every row ran with the caret in no block, so a block handed in never met a caret
	// held by another block whose type places the same command.
	describe('with the caret held whole in another block of a type placing it', () => {
		type Mounted = ReturnType<typeof mountEditor>;
		const routes: [string, (editor: Mounted, block?: Block) => boolean][] = [
			['by value', (editor, block) => editor.instance.run(placed, block)],
			['by id', (editor, block) => editor.instance.run('boxes/placed', block)],
			['through runCommand', (editor, block) => editor.instance.runCommand('boxes/placed', block)]
		];

		async function caretInFirst() {
			handed = [];
			const source = '```mine\nx\n```\n\n```mine\nz\n```\n\n```other\ny\n```\n';
			const editor = mountEditor({ source, plugins: [boxes] });
			await editor.settle();
			blockHostAt(editor, [0]).querySelector('button')!.click();
			await editor.settle();
			const byBody = (body: string) => editor.instance.doc.blocks.find((b) => b.body === body)!;
			return { editor, second: byBody('z'), other: byBody('y') };
		}

		it.each(routes)('runs %s on the block handed in, with its controls', async (_, run) => {
			const { editor, second } = await caretInFirst();
			expect(editor.instance.can(placed, second)).toBe(true);
			expect(run(editor, second)).toBe(true);
			expect(handed).toEqual([{ tag: 'mine z' }]);
		});

		it.each(routes)("refuses %s another type's block, handing nothing", async (_, run) => {
			const { editor, other } = await caretInFirst();
			expect(editor.instance.can(placed, other)).toBe(false);
			expect(run(editor, other)).toBe(false);
			expect(handed).toEqual([]);
		});

		it.each(routes)('runs %s on the block holding the caret when handed none', async (_, run) => {
			const { editor } = await caretInFirst();
			expect(run(editor)).toBe(true);
			expect(handed).toEqual([{ tag: 'mine x' }]);
		});
	});

	it('is undefined for a block that has left the document', async () => {
		const { editor, mine } = await mounted();
		await editor.instance.edit().replace({ from: mine.from, to: mine.to }, '').commit();
		await editor.settle();
		editor.instance.run(placed, mine);
		expect(handed).toEqual([undefined]);
	});
});
