import { test } from '../../fixtures';
import { PluginsPage } from './helpers';

// A selection from a container's first block, taken whole, out past the container leaves the
// container's closing line where it closes it (`requirements/plugins/range-removal-closing-lines.md`).
// Bytes per container and range shape are the unit suites' (`test/range-edit/named-rows-closers.ts`).

const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |';

let editor: PluginsPage;

async function open(mode: 'live' | 'source', source: string): Promise<void> {
	await editor.gotoPlugins();
	await editor.setPresentationMode(mode);
	await editor.loadContent(source);
}

/** From the first cell's start, Shift+click to offset `end` of the block at `path`. */
async function selectFromFirstCell(cell: number[], path: number[], end: number): Promise<void> {
	await editor.clickBlockAtPath(cell, 0);
	await editor.shiftClickBlock(path, end);
	await editor.waitForCrossBlock(true);
}

test.beforeEach(({ page }) => {
	editor = new PluginsPage(page);
});

for (const mode of ['live', 'source'] as const) {
	test(`(${mode}) Backspace out of an open details keeps its closing line above the heading after it`, async ({
		page
	}) => {
		await open(
			mode,
			`<details open>\n<summary>Sum</summary>\n\n${TABLE}\n\nbody\n\n</details>\n\npara\n\n# h\n`
		);
		await selectFromFirstCell([0, 1, 0, 0], [1], 4);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals(
			'<details open>\n<summary>Sum</summary>\n\n</details>\n\n# h\n'
		);
	});

	test(`(${mode}) a cut out of a tip inside a note keeps the tip's closing line first`, async ({
		page
	}) => {
		await open(mode, `::::note\n:::tip\n${TABLE}\n\nbody\n:::\n\npara\n::::\n`);
		await selectFromFirstCell([0, 1, 1, 0, 0], [0, 2], 4);

		await page.keyboard.press('ControlOrMeta+x');
		await editor.bridge.waitForSourceEquals('::::note\n:::tip\n:::\n::::\n');
	});

	test(`(${mode}) Delete out of a note into a tip's body puts the next letter at the tip's text`, async ({
		page
	}) => {
		await open(mode, `:::note\n${TABLE}\n\nbody\n:::\n\n:::tip\ninner\nmore\n:::\n\n# h\n`);
		await selectFromFirstCell([0, 1, 0, 0], [1, 1], 2);

		await page.keyboard.press('Delete');
		await editor.bridge.waitForSourceEquals(':::note\n:::\n\n:::tip\nner\nmore\n:::\n\n# h\n');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals(':::note\n:::\n\n:::tip\nxner\nmore\n:::\n\n# h\n');
	});

	test(`(${mode}) Delete to a code line's end in a quote keeps one marker on the line after`, async ({
		page
	}) => {
		await open(mode, `${TABLE}\n\nbody\n\n> \`\`\`\n> code\n> more\n> \`\`\`\n`);
		await selectFromFirstCell([0, 0, 0], [2, 0], 8);

		await page.keyboard.press('Delete');
		await editor.bridge.waitForSourceEquals('> ```\n> more\n> ```\n');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('> ```\n> xmore\n> ```\n');
	});

	test(`(${mode}) Enter into a tip inside a note breaks the line before the tip's text`, async ({
		page
	}) => {
		await open(mode, `${TABLE}\n\nbody\n\n::::note\n:::tip\ninner\nmore\n:::\n::::\n`);
		await selectFromFirstCell([0, 0, 0], [2, 1, 1], 2);

		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('::::note\n:::tip\n\n\nner\nmore\n:::\n::::\n');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('::::note\n:::tip\n\n\nxner\nmore\n:::\n::::\n');
	});
}
