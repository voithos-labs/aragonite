// @vitest-environment jsdom
// Miss-analysis: every renderer row called the renderings directly with a string, so no row held what
// a mounted diagram hands a host's renderer, and the move dropped the body's last line ending.
// What a host's renderer is handed for a diagram, which also keys its cache: the body's lines with
// their own endings, the last included, as 0.11.5 handed them (recorded on its package in jsdom).
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mermaid, type MermaidRenderer } from '#packages/mermaid/src/index.js';
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

const F = '```';

it.each([
	['an LF diagram', `${F}mermaid\ngraph TD\nA-->B\n${F}\n`, ['graph TD\nA-->B\n']],
	['a CRLF diagram', `${F}mermaid\r\ngraph TD\r\nA-->B\r\n${F}\r\n`, ['graph TD\r\nA-->B\r\n']],
	['an unclosed diagram ending in a line break', `${F}mermaid\ngraph TD\n`, ['graph TD\n']],
	['an unclosed diagram with no last line break', `${F}mermaid\ngraph TD`, ['graph TD']],
	['a diagram whose closer ends the document', `${F}mermaid\ngraph TD\n${F}`, ['graph TD\n']],
	['a diagram in a quote', `> ${F}mermaid\n> graph TD\n> ${F}\n`, ['graph TD\n']],
	['a diagram ending in a blank line', `${F}mermaid\ngraph TD\n\n${F}\n`, ['graph TD\n\n']],
	['an empty diagram', `${F}mermaid\n${F}\n`, []]
])('%s hands the renderer its body as 0.11.5 did', async (_, source, handed) => {
	const seen: string[] = [];
	const renderer: MermaidRenderer = async (code) => (seen.push(code), '<svg></svg>');
	const editor = mountEditor({ source, plugins: [mermaid({ renderer })] });
	await editor.settle();
	await expect.poll(() => seen.length).toBe(handed.length);
	expect(seen).toEqual(handed);
});
