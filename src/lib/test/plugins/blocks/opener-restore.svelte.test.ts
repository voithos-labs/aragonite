// @vitest-environment jsdom
// A character typed on a container's opening row and taken back by Backspace leaves the document's
// bytes as they started: at every offset of the row, in every host and body, LF and CRLF, on colon
// and fenced lines. Run with OPENER_RESTORE=full for every case instead of a sample.
// Miss-analysis: every closer row typed an opener onto a fresh line, so no row broke an opener
// whose closing line stayed below and then put it back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { writeFileSync } from 'node:fs';
import type { CstNode } from '#lib/plugin.js';
import { admonitions } from '#packages/admonitions/src/index.js';
import { details } from '#packages/details/src/index.js';
import {
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { deleteBy, insertBy } from '#lib/test/harness/insertion-routes.js';
import { displayLength } from '#lib/core/lines.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

type Seam = { getDocument(): CstNode };

const BODIES: Record<string, string> = {
	empty: '',
	paragraph: 'body\n',
	'two paragraphs': 'a\n\nb\n',
	list: '- a\n- b\n',
	code: '```\nc\n```\n',
	quote: '> q\n',
	'nested box': ':::note\nn\n:::\n'
};

/** The container on `shape`'s lines around `body`; a colon fence wider than any colon run inside. */
function boxed(shape: 'colon' | 'fenced', body: string): string {
	if (shape === 'fenced') {
		const inner = body ? `\n${body}\n` : '\n';
		return `<details open>\n<summary>T</summary>\n${inner}</details>\n`;
	}
	const fence = body.includes(':::') ? '::::' : ':::';
	return `${fence}tip T\n${body}${fence}\n`;
}

const HOSTS: Record<string, (box: string) => string> = {
	'top level': (box) => `above\n\n${box}\nafter\n`,
	quote: (box) => box.replace(/^/gm, '> ').replace(/> $/, ''),
	'list item': (box) => `- ${box.replace(/\n(?=.)/g, '\n  ')}`,
	'nested box': (box) => `:::::note O\n${box}:::::\n`
};

interface Case {
	host: string;
	shape: 'colon' | 'fenced';
	body: string;
	crlf: boolean;
}

const sourceOf = ({ host, shape, body, crlf }: Case): string => {
	const lf = HOSTS[host](boxed(shape, BODIES[body]));
	return crlf ? lf.replace(/\n/g, '\r\n') : lf;
};

/** The path of the row a case types on: child 0 of the innermost container opened by `tip T` or
 *  a `<summary>`. */
function rowPath(doc: CstNode): number[] {
	let found: number[] | null = null;
	const walk = (node: CstNode, path: number[]) => {
		node.children?.forEach((child, i) => {
			const row = child.children?.[0];
			if (row && /^(:+tip T|T)\r?\n?$/.test(row.raw) && child.kind !== 'paragraph') {
				found = [...path, i, 0];
			}
			walk(child, [...path, i]);
		});
	};
	walk(doc, []);
	if (!found) throw new Error('no opening row in the case');
	return found;
}

// Mounted inside the test: the env resets registries between a hook and the test.
let m: MountedEditor<Seam>;
beforeAll(() => installLayoutStubs());
afterAll(() => m?.destroy());

/** The bytes after `ch` is typed at `offset` of the case's row and Backspace takes it back. */
async function typedAndTakenBack(source: string, offset: number, ch: string): Promise<string> {
	await m.instance.load(source);
	await m.settle();
	const path = rowPath(m.instance.__test.getDocument());
	placeCaret(surfaceAt(m, path), offset);
	await insertBy('hardware key', document.activeElement as HTMLElement, ch);
	await deleteBy(document.activeElement as HTMLElement, 'Backspace');
	await m.settle();
	takeDevWarns();
	return m.source();
}

async function rowLength(source: string): Promise<number> {
	await m.instance.load(source);
	await m.settle();
	const doc = m.instance.__test.getDocument();
	const path = rowPath(doc);
	let node: CstNode = doc;
	for (const i of path) node = node.children![i];
	return displayLength(node.raw);
}

/** Two rare shapes the law leaves out, booked: a letter splitting a four-colon run into a narrower
 *  opener of another name, and a colon that widened a box's box's fence, which never narrows. */
const booked = (c: Case, offset: number, ch: string): boolean =>
	c.shape === 'colon' &&
	c.body === 'nested box' &&
	((ch === 'x' && offset === 3) || (ch === ':' && c.host === 'nested box'));

const CASES: Case[] = Object.keys(HOSTS).flatMap((host) =>
	(['colon', 'fenced'] as const).flatMap((shape) =>
		Object.keys(BODIES).flatMap((body) =>
			[false, true].map((crlf) => ({ host, shape, body, crlf }))
		)
	)
);

describe('an opening row, a character typed then taken back by Backspace', () => {
	it('leaves the bytes as they started', { timeout: 600_000 }, async () => {
		m = mountEditor<Seam>({ source: '', plugins: [admonitions, details] });
		await m.settle();
		const full = process.env.OPENER_RESTORE === 'full';
		const misses: string[] = [];
		const check = async (c: Case, offset: number, ch: string) => {
			if (booked(c, offset, ch)) return;
			const source = sourceOf(c);
			const after = await typedAndTakenBack(source, offset, ch);
			if (after !== source) {
				misses.push(`${JSON.stringify(c)} @${offset} '${ch}': ${JSON.stringify(after)}`);
			}
		};
		if (full) {
			for (const c of CASES) {
				const length = await rowLength(sourceOf(c));
				for (let offset = 0; offset <= length; offset++) {
					for (const ch of ['x', ':']) await check(c, offset, ch);
				}
			}
		} else {
			await fc.assert(
				fc.asyncProperty(
					fc.constantFrom(...CASES),
					fc.nat(9),
					fc.constantFrom('x', ':'),
					async (c, at, ch) => {
						const length = await rowLength(sourceOf(c));
						await check(c, at % (length + 1), ch);
					}
				),
				{ numRuns: 120 }
			);
		}
		const out = process.env.OPENER_RESTORE_OUT;
		if (out) writeFileSync(out, misses.join('\n'));
		expect(misses).toEqual([]);
	});
});
