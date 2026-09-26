/**
 * G4.70: the `data-` names a block decoration may not set are exactly the ones the editor uses on a
 * decorated element (a block host, a list item's box, a table row or cell): set on its tag, looked
 * up through `closest()`, or read by a selector that could match it as an ancestor or as the element
 * styled. The scan derives that set and holds `RESERVED_BLOCK_ATTRS` to it both ways.
 * Miss-analysis: the reserved set was pinned against a copy of itself, so an attribute added later
 * (the kind cue's label) never had to be reserved and a decoration could paint it.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC, splitTopLevel, type SourceFile } from './scan-source';
import { RESERVED_BLOCK_ATTRS } from '$lib/decorations/reserved-attrs';

// ── Derivation ──────────────────────────────────────────────────────────────

const DATA_NAME = /\[\s*(data-[a-z0-9-]+)/g;
const DECORATED_TAG = /<div\b[^>]*?blockDecorations\.classes[\s\S]*?>/g;
const CLOSEST_ARG = /\.closest(?:<[^>]*>)?\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|([A-Z_]+))/g;

const namesIn = (text: string) => [...text.matchAll(DATA_NAME)].map((m) => m[1]);

/** String constants by name, so a selector spelled through one (`[${ATTR}]`) is read in full. */
function stringConstants(files: readonly SourceFile[]): Map<string, string> {
	const constants = new Map<string, string>();
	for (const file of files) {
		for (const m of file.code.matchAll(/const\s+([A-Z_]+)\s*=\s*(['"`])([^'"`\n]*)\2/g)) {
			constants.set(m[1], m[3]);
		}
	}
	return constants;
}

const resolve = (text: string, constants: ReadonlyMap<string, string>) =>
	text.replace(/\$\{\s*([A-Z_]+)\s*\}/g, (whole, name: string) => constants.get(name) ?? whole);

/**
 * The `data-` names a selector reads on an element that could be a decorated one. A compound
 * qualifies when its classes are all a decorated element's and its tag, if any, is a div. As an
 * ancestor it reads its names on whatever contains the match; as the styled element it must also
 * name something a decorated element carries (its class, `[contenteditable]`), since a bare
 * `[data-x]` there only finds an inner element that set the name itself.
 */
export function namesReadOnDecorated(selector: string, decorated: ReadonlySet<string>): string[] {
	let text = selector;
	for (let prev = ''; prev !== text;) {
		prev = text;
		text = text.replace(/:(?:global|where|is)\(([^()]*)\)/g, '$1');
	}
	const names: string[] = [];
	for (const one of splitTopLevel(text, ',').filter(Boolean)) {
		// One space between compounds, so a split at the space finds each of them.
		const spaced = one.replace(/\s*[>+~]\s*|\s+/g, ' ').trim();
		const compounds = splitTopLevel(spaced, ' ').filter(Boolean);
		compounds.forEach((compound, i) => {
			if (!compound.includes('[data-')) return;
			const outer = compound.replace(/\([^()]*\)/g, '');
			const classes = [...outer.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
			const tag = /^[a-z][a-z0-9]*/.exec(outer)?.[0];
			if (classes.some((c) => !decorated.has(c)) || (tag && tag !== 'div')) return;
			const otherAttr = /\[\s*(?!data-)[a-z]/.test(outer);
			const isSubject = i === compounds.length - 1;
			if (isSubject && classes.length === 0 && !otherAttr) return;
			names.push(...namesIn(compound));
		});
	}
	return names;
}

/** Every reserved name the files imply. */
export function deriveReserved(files: readonly SourceFile[]): Set<string> {
	const constants = stringConstants(files);
	const reserved = new Set<string>();
	const decorated = new Set<string>();
	for (const file of files) {
		for (const [tag] of file.code.matchAll(DECORATED_TAG)) {
			for (const m of tag.matchAll(/\s(data-[a-z0-9-]+)=/g)) reserved.add(m[1]);
			for (const m of tag.matchAll(/'([a-z][a-z-]*)'/g)) decorated.add(m[1]);
		}
	}
	for (const file of files) {
		for (const m of file.code.matchAll(CLOSEST_ARG)) {
			const arg = m[4] !== undefined ? (constants.get(m[4]) ?? '') : (m[1] ?? m[2] ?? m[3]);
			for (const name of namesIn(resolve(arg, constants))) reserved.add(name);
		}
		for (const selector of selectorTexts(file, constants)) {
			for (const name of namesReadOnDecorated(selector, decorated)) reserved.add(name);
		}
	}
	return reserved;
}

/** Selector text in a file: CSS rule preludes, and string literals holding an attribute selector. */
function selectorTexts(file: SourceFile, constants: ReadonlyMap<string, string>): string[] {
	const texts: string[] = [];
	const sheets = file.relPath.endsWith('.css')
		? [file.code]
		: [...file.code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
	for (const sheet of sheets) {
		for (const m of sheet.matchAll(/(?:^|[{};])\s*([^{}@;]+?)\s*\{/g)) texts.push(m[1]);
	}
	if (file.relPath.endsWith('.css')) return texts;
	for (const m of file.code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
		const literal = resolve(m[1] ?? m[2] ?? m[3], constants);
		if (literal.includes('[data-')) texts.push(literal);
	}
	return texts;
}

// ── The check ───────────────────────────────────────────────────────────────

const file = (relPath: string, code: string): SourceFile => ({ relPath, text: code, code });

const HOST = file(
	'src/lib/Host.svelte',
	"<div class={['block-host', ...blockDecorations.classes]} data-block-path={p}></div>"
);

describe('G4.70 a block decoration keeps off the attributes the editor uses on its element', () => {
	const derived = deriveReserved(collectEditorSources(EDITOR_SRC, { includeStyles: true }));

	it('finds the decorated elements, so an empty scan cannot pass', () => {
		expect(derived.has('data-block-path')).toBe(true);
		expect(derived.has('data-table-row-idx')).toBe(true);
	});

	it('reserves exactly the derived names', () => {
		expect([...RESERVED_BLOCK_ATTRS].sort()).toEqual([...derived].sort());
	});

	it.each([
		['a closest() lookup', "const at = el.closest('[data-new-thing]');", 'data-new-thing'],
		[
			'a lookup through a constant',
			"const A = 'data-new-thing';\nx.closest(`[${A}]`);",
			'data-new-thing'
		],
		[
			'a host-level rule',
			'<style>\n.block-host[data-new-thing]::after { color: red; }\n</style>',
			'data-new-thing'
		],
		[
			'an ancestor rule',
			"<style>\n:global([data-new-thing='on']) .md-link { color: red; }\n</style>",
			'data-new-thing'
		],
		[
			'an editable-element rule',
			"const s = '[contenteditable]:not([data-new-thing])';",
			'data-new-thing'
		]
	])('reserves a name read on a decorated element through %s', (_how, code, name) => {
		expect(deriveReserved([HOST, file('src/lib/X.svelte', code)])).toEqual(
			new Set(['data-block-path', name])
		);
	});

	it.each([
		['set on an inner element', '<span data-new-thing={v}></span>'],
		['styled on an inner class', '<style>\n.menu-item[data-new-thing] { color: red; }\n</style>'],
		['found below an inner element', 'menuEl.querySelector(\'[data-new-thing="true"]\');'],
		['styled on an inner tag', '<style>\nspan[data-new-thing] { color: red; }\n</style>']
	])('leaves a name %s', (_how, code) => {
		expect(deriveReserved([HOST, file('src/lib/X.svelte', code)])).toEqual(
			new Set(['data-block-path'])
		);
	});
});
