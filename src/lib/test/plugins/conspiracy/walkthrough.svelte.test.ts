// @vitest-environment jsdom
// The plugin guide's `:::conspiracy` walkthrough, compiled and run: the harness plugin is the page's
// code block for block, it passes `check`, reads as the page says, and its chords rename the box.
// Miss-analysis: the walkthrough's code had no twin in the repo, so it stood on a surface long gone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { grammar } from '#lib/plugin.js';
import { check } from '#lib/testing.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { conspiracyPlugin } from '../../../../routes/test/plugins/conspiracy/conspiracy-plugin';

const PAGE = 'docs/guide/plugin-guide/container-walkthrough.md';
const DIR = 'src/routes/test/plugins/conspiracy';
const SEED =
	':::conspiracy Birds are government drones\nThe quickstart parrot has danced since section one and never once eaten.\n:::\n';

const read = (relPath: string) => readFileSync(path.resolve(relPath), 'utf8');

/** The page's fenced block whose first line is `marker`. */
function fenceStartingWith(marker: string): string {
	const lines = read(PAGE).split('\n');
	const at = lines.indexOf(marker);
	expect(at, `no line ${marker} on the page`).toBeGreaterThan(0);
	expect(lines[at - 1]).toMatch(/^```/);
	const end = lines.findIndex((line, i) => i > at && line.startsWith('```'));
	return lines.slice(at, end).join('\n') + '\n';
}

beforeEach(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('the walkthrough', () => {
	it.each([
		['// conspiracy-plugin.ts', 'conspiracy-plugin.ts'],
		['/* conspiracy.css */', 'conspiracy.css']
	])('shows %s as the harness holds it, byte for byte', (marker, file) => {
		expect(read(`${DIR}/${file}`)).toBe(fenceStartingWith(marker));
	});

	it('passes check', async () => {
		await expect(check(conspiracyPlugin)).resolves.toBeDefined();
	});

	it('reads its seed as the page shows', () => {
		const [box] = grammar([conspiracyPlugin]).parse(SEED).blocks;
		expect({
			type: box.type.name,
			data: box.data,
			title: box.title?.text,
			children: box.children.map((child) => child.type.name)
		}).toEqual({
			type: 'conspiracy/conspiracy',
			data: { name: 'conspiracy' },
			title: 'Birds are government drones',
			children: ['paragraph']
		});
	});

	it('debunks on Mod+8 as one undo step, the stamp following the name', async () => {
		const editor = mountEditor({ source: SEED, plugins: [conspiracyPlugin] });
		await editor.settle();
		const body = surfaceAt(editor, [0, 0]);
		await pressKey(body, { key: '8', ctrlKey: true });
		await editor.settle();
		expect(editor.source()).toBe(SEED.replace(':::conspiracy', ':::debunked'));
		expect(blockHostAt(editor, [0]).querySelector('.conspiracy-block.debunked')).not.toBeNull();

		await pressKey(surfaceAt(editor, [0, 0]), { key: 'z', ctrlKey: true });
		await editor.settle();
		expect(editor.source()).toBe(SEED);
		expect(blockHostAt(editor, [0]).querySelector('.debunked')).toBeNull();
	});
});
