// @vitest-environment jsdom
// Miss-analysis: a command reached its block's drawing through nothing on the plugin values, so no
// row ran a command beside a drawing, or one listed elsewhere over a drawn block.
// `Drawn.handle`: a block type's own command is handed its block's handle while the block is drawn;
// a command its type doesn't place never is, whatever block it runs on.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import { command } from '#lib/schema/plugin-command.js';
import type { Block } from '#lib/schema/doc-view.js';
import {
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
	run: (_editor, _block, handle) => void handed.push(handle)
});
const loose = command<Block<never>>({
	id: 'loose',
	title: 'Loose',
	run: (_editor, _block, handle) => void handed.push(handle)
});

const tagged = (tag: string) => () => ({
	dom: document.createElement('div'),
	handle: { tag }
});

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

describe("a drawing's handle", () => {
	it("reaches its block type's own command while the block is drawn", async () => {
		const { editor, mine } = await mounted();
		expect(editor.instance.run(placed, mine)).toBe(true);
		expect(handed).toEqual([{ tag: 'mine' }]);
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

	it('is undefined for a block that has left the document', async () => {
		const { editor, mine } = await mounted();
		await editor.instance.edit().replace({ from: mine.from, to: mine.to }, '').commit();
		await editor.settle();
		editor.instance.run(placed, mine);
		expect(handed).toEqual([undefined]);
	});
});
