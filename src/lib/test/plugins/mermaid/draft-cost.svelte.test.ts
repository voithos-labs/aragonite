// @vitest-environment jsdom
// A diagram whose box is closed holds no draft open, so typing elsewhere records no write for one:
// every write a held draft hears costs a record of what it changed.
// Miss-analysis: no row counted the records a mounted diagram costs, so a box that held a draft
// from the moment it was drawn would have slowed every key in the document unseen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { headless } from '#lib/testing.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

const records = vi.hoisted(() => ({ count: 0 }));
vi.mock('#lib/editor-actions/commit/change-record.js', async (load) => {
	const real = await load<typeof import('#lib/editor-actions/commit/change-record.js')>();
	return {
		...real,
		captureChange: (...args: Parameters<typeof real.captureChange>) => {
			records.count++;
			return real.captureChange(...args);
		}
	};
});

beforeEach(() => {
	headless();
	installLayoutStubs();
	records.count = 0;
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const DIAGRAMS = Array.from(
	{ length: 5 },
	(_, i) => `\`\`\`mermaid\ngraph TD\n\tA${i} --> B\n\`\`\``
);

describe('diagrams with their boxes closed', () => {
	it('record nothing for a letter typed in a paragraph beside them', async () => {
		const source = `${DIAGRAMS.join('\n\n')}\n\ntail\n`;
		const editor = mountEditor({ source, plugins: [mermaidPlugin()] });
		await editor.settle();
		typeInto(surfaceAt(editor, [DIAGRAMS.length]), 'tails');
		await editor.settle();
		expect(editor.source()).toBe(`${DIAGRAMS.join('\n\n')}\n\ntails\n`);
		expect(records.count).toBe(0);
	});
});
