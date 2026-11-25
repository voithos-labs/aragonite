// @vitest-environment jsdom
// Mermaid's edit box, row for row as 0.11.5 had it: what each diagram reads as, what its box shows
// when it opens, and the bytes a text written in it leaves. Every expected value is 0.11.5's: the
// box rows mounted in Chromium on its export, the reads from its parser.
// Miss-analysis: the box's writes were pinned through the kind's metadata rebuild, so no row held
// the bytes a box leaves whatever writes them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { headless } from '#lib/testing.js';
import { mermaid } from '#packages/mermaid/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

const DIAGRAM = 'mermaid/diagram';

beforeEach(() => {
	headless();
	installLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const F = '```';

/** [source, the blocks it reads as (`[type, bytes]`, a quote or list as `[type, children]`)] */
type Shape = [string, string | Shape[]];
const READS: [string, Shape[]][] = [
	[`${F}mermaid\ngraph TD\n${F}\n`, [[DIAGRAM, `${F}mermaid\ngraph TD\n${F}\n`]]],
	['~~~mermaid\nx\n~~~\n', [[DIAGRAM, '~~~mermaid\nx\n~~~\n']]],
	[`${F}mermaid\n${F}\n`, [[DIAGRAM, `${F}mermaid\n${F}\n`]]],
	[`${F}mermaid extra\nx\n${F}\n`, [[DIAGRAM, `${F}mermaid extra\nx\n${F}\n`]]],
	[`${F}mermaidx\nx\n${F}\n`, [['fencedCode', `${F}mermaidx\nx\n${F}\n`]]],
	[`${F}\`mermaid\n${F}\n${F}\`\n`, [[DIAGRAM, `${F}\`mermaid\n${F}\n${F}\`\n`]]],
	[`${F}mermaid\nx\n`, [[DIAGRAM, `${F}mermaid\nx\n`]]],
	[
		`para\n${F}mermaid\nx\n${F}\n`,
		[
			['paragraph', 'para\n'],
			[DIAGRAM, `${F}mermaid\nx\n${F}\n`]
		]
	],
	[`  ${F}mermaid\n  x\n  ${F}\n`, [[DIAGRAM, `  ${F}mermaid\n  x\n  ${F}\n`]]],
	[`${F}Mermaid\nx\n${F}\n`, [['fencedCode', `${F}Mermaid\nx\n${F}\n`]]],
	[`${F}mermaid\r\nx\r\n${F}\r\n`, [[DIAGRAM, `${F}mermaid\r\nx\r\n${F}\r\n`]]],
	[`> ${F}mermaid\n> x\n> ${F}\n`, [['blockquote', [[DIAGRAM, `${F}mermaid\nx\n${F}\n`]]]]],
	[`${F} mermaid\nx\n${F}\n`, [[DIAGRAM, `${F} mermaid\nx\n${F}\n`]]],
	[`${F}js\nconst x = 1;\n${F}\n`, [['fencedCode', `${F}js\nconst x = 1;\n${F}\n`]]],
	[`    ${F}mermaid\n`, [['indentedCode', `    ${F}mermaid\n`]]],
	[
		`${F}\`\n${F}mermaid\nx\n${F}\n${F}\`\n`,
		[['fencedCode', `${F}\`\n${F}mermaid\nx\n${F}\n${F}\`\n`]]
	]
];

/** [source, what the box shows as it opens, the text written in it (null: closed unchanged), the
 *  bytes that leaves] */
const WRITES: [string, string, string | null, string][] = [
	[`${F}mermaid\ngraph TD\n${F}\n`, 'graph TD', 'graph LR', `${F}mermaid\ngraph LR\n${F}\n`],
	['~~~mermaid\nx\n~~~\n', 'x', 'y', '~~~mermaid\ny\n~~~\n'],
	[`${F}mermaid\n${F}\n`, '', 'y', `${F}mermaid\ny\n${F}\n`],
	[`${F}mermaid extra\nx\n${F}\n`, 'x', 'y', `${F}mermaid extra\ny\n${F}\n`],
	[`${F}\`mermaid\n${F}\n${F}\`\n`, F, 'z', `${F}\`mermaid\nz\n${F}\`\n`],
	[`${F}\`mermaid\nx\n${F}\`\n`, 'x', 'y', `${F}\`mermaid\ny\n${F}\`\n`],
	[`${F}mermaid\nx\n`, 'x', 'y\nz', `${F}mermaid\ny\nz\n`],
	[`${F}mermaid\nx\n`, 'x', null, `${F}mermaid\nx\n`],
	[`para\n${F}mermaid\nx\n${F}\n`, 'x', 'y', `para\n${F}mermaid\ny\n${F}\n`],
	[`  ${F}mermaid\n  x\n  ${F}\n`, '  x', 'y', `  ${F}mermaid\ny\n  ${F}\n`],
	[
		`  ${F}mermaid\n  x\n   y\n  ${F}\n`,
		'  x\n   y',
		'  x\n   y\nz',
		`  ${F}mermaid\n  x\n   y\nz\n  ${F}\n`
	],
	[`${F}mermaid\r\nx\r\n${F}\r\n`, 'x', 'y\nz', `${F}mermaid\r\ny\r\nz\r\n${F}\r\n`],
	[`${F}mermaid\r\nx\r\ny\r\n${F}\r\n`, 'x\ny', null, `${F}mermaid\r\nx\r\ny\r\n${F}\r\n`],
	[`${F}mermaid\r\nx\ny\r\n${F}\r\n`, 'x\ny', null, `${F}mermaid\r\nx\ny\r\n${F}\r\n`],
	[`${F}mermaid\r\nx\ny\r\n${F}\r\n`, 'x\ny', 'x\ny\nz', `${F}mermaid\r\nx\r\ny\r\nz\r\n${F}\r\n`],
	[`> ${F}mermaid\n> x\n> ${F}\n`, 'x', 'a\nb', `> ${F}mermaid\n> a\n> b\n> ${F}\n`],
	[`${F} mermaid\nx\n${F}\n`, 'x', 'y', `${F} mermaid\ny\n${F}\n`],
	[`${F}mermaid\nx\n${F}\n`, 'x', `a\n${F}\nb`, `${F}\`mermaid\na\n${F}\nb\n${F}\`\n`],
	[`${F}mermaid\nx\n${F}\n`, 'x', '', `${F}mermaid\n${F}\n`],
	[`${F}mermaid\nx\n${F}`, 'x', 'y\nz', `${F}mermaid\ny\nz\n${F}`],
	[`${F}mermaid\nx\n\n${F}\n`, 'x\n', 'w\n', `${F}mermaid\nw\n\n${F}\n`],
	[
		`${F}mermaid\ngraph TD\n\tA --> B\n${F}\n`,
		'graph TD\n\tA --> B',
		'graph LR\n\tA --> B',
		`${F}mermaid\ngraph LR\n\tA --> B\n${F}\n`
	],
	[
		`- ${F}mermaid\n  graph TD\n  \tA --> B\n  ${F}\n`,
		'graph TD\n  A --> B',
		'graph LR\n  A --> B',
		`- ${F}mermaid\n  graph LR\n  \tA --> B\n  ${F}\n`
	],
	[
		`> ${F}mermaid\n> graph TD\n> \tA --> B\n> ${F}\n`,
		'graph TD\n\tA --> B',
		'graph LR\n\tA --> B',
		`> ${F}mermaid\n> graph LR\n> \tA --> B\n> ${F}\n`
	],
	[`- ${F}mermaid\n  x\n  ${F}\n`, 'x', 'a\nb', `- ${F}mermaid\n  a\n  b\n  ${F}\n`],
	// A body line that would close the fence grows it, opener and closer, on the fence's own marker.
	[
		'~~~mermaid\ngraph TD\n~~~\n',
		'graph TD',
		`graph TD\n${F}\nafter`,
		`~~~mermaid\ngraph TD\n${F}\nafter\n~~~\n`
	],
	[
		'~~~mermaid\ngraph TD\n~~~\n',
		'graph TD',
		'graph TD\n~~~~',
		'~~~~~mermaid\ngraph TD\n~~~~\n~~~~~\n'
	],
	[
		`${F}mermaid\ngraph TD\n`,
		'graph TD',
		`graph TD\n${F}\nafter`,
		`${F}\`mermaid\ngraph TD\n${F}\nafter\n`
	],
	[
		`${F}mermaid\ngraph TD\n  \`\`\`\`\`  \n`,
		'graph TD',
		`graph TD\n${F}`,
		`${F}\`mermaid\ngraph TD\n${F}\n  \`\`\`\`\`  \n`
	],
	[
		`${F}mermaid\r\ngraph TD\r\n${F}\r\n`,
		'graph TD',
		`graph TD\n${F}`,
		`${F}\`mermaid\r\ngraph TD\r\n${F}\r\n${F}\`\r\n`
	]
];

const shape = (block: {
	type: { name: string };
	text: string;
	children: readonly unknown[];
}): Shape =>
	block.children.length
		? [block.type.name, (block.children as (typeof block)[]).map(shape)]
		: [block.type.name, block.text];

function textarea(editor: MountedEditor): HTMLTextAreaElement | null {
	return editor.target.querySelector<HTMLTextAreaElement>('[data-testid="mermaid-source"]');
}

/** The box, opened by its Edit button unless an empty diagram has it open already. */
function openBox(editor: MountedEditor): HTMLTextAreaElement {
	if (!textarea(editor)) {
		editor.target.querySelector<HTMLButtonElement>('[data-testid="mermaid-edit"]')!.click();
		flushSync();
	}
	return textarea(editor)!;
}

describe('a diagram reads as 0.11.5 read it', () => {
	it.each(READS)('%j', async (source, blocks) => {
		const editor = mountEditor({ source, plugins: [mermaid] });
		await editor.settle();
		expect(editor.instance.doc.blocks.map(shape)).toEqual(blocks);
	});
});

describe("a diagram's box shows and writes as 0.11.5's did", () => {
	it.each(WRITES)('%j shows %j, given %j writes %j', async (source, seed, text, written) => {
		const editor = mountEditor({ source, plugins: [mermaid] });
		await editor.settle();
		const box = openBox(editor);
		expect(box.value).toBe(seed);
		if (text !== null) {
			box.value = text;
			box.dispatchEvent(new Event('input', { bubbles: true }));
		}
		box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		flushSync();
		await editor.settle();
		expect(editor.source()).toBe(written);
		// And it reads back as a diagram holding that text, in the block's own line endings.
		const diagram = editor.instance.doc.blocks
			.flatMap((top) => [...top.walk()])
			.find((block) => block.type.name === DIAGRAM);
		expect(diagram?.body.replace(/\r\n/g, '\n')).toBe(text ?? seed);
	});
});

it('reads a mermaid fence as a code block in an editor that does not list mermaid', async () => {
	const source = `${F}mermaid\ngraph TD\n\tA --> B\n${F}\n`;
	const editor = mountEditor({ source, plugins: [] });
	await editor.settle();
	expect(editor.instance.doc.blocks.map(shape)).toEqual([['fencedCode', source]]);
	expect(editor.source()).toBe(source);
});
