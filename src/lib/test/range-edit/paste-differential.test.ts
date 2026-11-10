// @vitest-environment jsdom
// The paste differential: `PASTE_DIFF=<file>` writes one JSON line per case, today's editor beside
// the range-edit core, over drawn documents in both modes, LF and CRLF, and the named cases.
// `PASTE_DIFF_DOCS` and `PASTE_DIFF_SEED` size and seed the draw, `PASTE_DIFF_NAMED=1` runs the named
// cases alone. Skipped without `PASTE_DIFF`, so the unit suite never runs it.

import { appendFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import fc from 'fast-check';
import type { Document } from '#lib/core/nodes.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { arbClipboardText, arbLawDocument } from '../range-laws/shapes';
import { arbEnd, arbRangeSeed, resolveCaret, resolveRange } from '../range-laws/ranges';
import { diffCase, type PasteCase } from './paste-differential';
import { namedCases } from './paste-differential-cases';

const OUT = process.env.PASTE_DIFF;
const DOCS = Number(process.env.PASTE_DIFF_DOCS ?? 150);
const SEED = Number(process.env.PASTE_DIFF_SEED ?? 20261110);

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const crlf = (text: string) => text.replace(/\r?\n/g, '\r\n');

/** The drawn cases: per document and mode, two pastes and a plain paste at a caret, and per range
 *  a paste over it and a cut pasted back; every other document in CRLF, its clipboard too. */
function drawnCases(grammar: typeof defaultGrammarView): PasteCase[] {
	const clips = fc.sample(arbClipboardText, { numRuns: 400, seed: SEED + 1 });
	const sources = fc.sample(arbLawDocument, { numRuns: DOCS, seed: SEED });
	return sources.flatMap((drawn, d) => {
		const windows = d % 2 === 1;
		const source = windows ? crlf(drawn) : drawn;
		const doc = readAsOpened(source, { grammar, scope: 'document' }) as Document;
		return (['source', 'live'] as const).flatMap((mode, m) => {
			const n = d * 2 + m;
			const clip = (k: number) => (windows ? crlf : String)(clips[(n * 5 + k) % clips.length]);
			const cases: PasteCase[] = [];
			const caret = resolveCaret(doc, fc.sample(arbEnd, { numRuns: 1, seed: SEED + 7 * n + 3 })[0]);
			if (caret) {
				cases.push({ source, mode, via: caret, clip: clip(0), route: 'key' });
				cases.push({ source, mode, via: caret, clip: clip(2), route: 'key' });
				cases.push({ source, mode, via: caret, clip: clip(0), route: 'plain menu' });
			}
			const seeds = fc.sample(arbRangeSeed, { numRuns: 2, seed: SEED + 7 * n });
			seeds.forEach((seed, i) => {
				const via = resolveRange(doc, seed);
				if (!via) return;
				cases.push({ source, mode, via, clip: clip(3 + i), route: 'key' });
				cases.push({ source, mode, via, clip: '', route: 'cut then key' });
			});
			return cases;
		});
	});
}

describe.skipIf(!OUT)('the paste differential', () => {
	it('writes a row per case', { timeout: 3_600_000 }, async () => {
		writeFileSync(OUT!, '');
		installPlugins(SYNTAX_PLUGINS);
		const named = namedCases(defaultGrammarView);
		const cases = process.env.PASTE_DIFF_NAMED
			? named
			: [...named, ...drawnCases(defaultGrammarView)];
		for (const input of cases) {
			const row = await diffCase(input);
			appendFileSync(OUT!, JSON.stringify(row) + '\n');
		}
	});
});
