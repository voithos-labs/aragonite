// Runs two container writers over the same container after the same edit, and collects every
// place their bytes, or their asks to read the node whole, differ.

import fc from 'fast-check';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { firstLineEnding, ownTrailingLineEnding, splitLines } from '#lib/core/lines.js';
import type { ChildRawChange } from '#lib/schema/child-spans.js';
import type { StripRebuild } from '#lib/schema/strip-rebuild.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { loadDefinitionExamples, loadSpecExamples } from '../../gfm-conformance/corpus';
import { FLUSH_JOIN_DOCUMENTS, LONG_DOCUMENTS, SMALL_DOCUMENTS } from '../../behavior/corpus';
import { arbLawDocument } from '../../range-laws/shapes';
import {
	arbRespelledContainerDoc,
	arbRespelledPluginContainerDoc
} from '../../invariants/arbitraries/index';

/** A container writer as the differential calls it. */
export type Writer = (node: CstNode, changed?: ChildRawChange) => StripRebuild | void | undefined;

export interface Mismatch {
	doc: string;
	kind: string;
	edit: string;
	before: string;
	today: string;
	shaped: string;
	/** Whether each writer asked for the node to be read whole. */
	rereads: [boolean, boolean];
}

export interface Tally {
	cases: number;
	mismatches: Mismatch[];
	throws: { doc: string; kind: string; edit: string; message: string }[];
	/** Dev warnings over every case, by tag: a region splice disagreeing with its full rebuild. */
	warns: Record<string, number>;
}

/** The container kinds the differential edits, the generic `:::` container included. */
export const CONTAINER_KINDS = [
	'blockquote',
	'githubAlert',
	'listItem',
	'footnote-def',
	'directiveContainer',
	'admonition',
	'details'
] as const;

/** The cases no generator is sure to draw, by name: tab columns, lazy lines, and the container
 *  facts' examples. */
export const NAMED_DOCUMENTS: Readonly<Record<string, string>> = {
	// The spec's own tab examples (4, 5, 6, 7, 9), which the committed spec slice leaves out.
	'spec tab 4': '  - foo\n\n\tbar\n',
	'spec tab 5': '- foo\n\n\t\tbar\n',
	'spec tab 6': '>\t\tfoo\n',
	'spec tab 7': '-\t\tfoo\n',
	'spec tab 9': ' - foo\n   - bar\n\t - baz\n',
	'tab after quote marker': '>\tfoo\n>\tbar\n',
	'two tabs after quote marker': '>\t\tfoo\n',
	'tab gap after bullet': '-\tfoo\n\tbar\n',
	'tab gap after ordinal': '1.\tfoo\n\tbar\n',
	'tab straddles item column': '- a\n\n\tcode\n',
	'tab straddles nested item': '  -\ta\n\tb\n',
	'tab in footnote body': '[^1]: a\n\n\tb\n',
	'tab straddles three-wide item': '1. a\n\n \tb\n',
	'lazy quote line': '> a\nb\n',
	'lazy item line': '- a\nb\n',
	'lazy footnote line': '[^1]: a\nb\n',
	'lazy alert line': '> [!NOTE]\n> a\nb\n',
	'lazy under task box': '- [ ] \nb\n',
	'task box before a quote': '- [x]\t> q\nx y\n',
	'marker moves (item)': 'p\n\n- a\n\n  b\n',
	'marker moves (footnote)': 'p\n\n[^1]: a\n\n    b\n',
	'only a quote': '> quoted',
	'only an item': '- item',
	'only a footnote': '[^1]: A rock.\n',
	'only an alert': '> [!NOTE]\n> a\n',
	'callout closer in body': ':::note\nx\n:::\n',
	'generic directive': ':::spoiler\n\nhidden\n\n:::\n',
	'generic directive, longer closer': ':::spoiler\nhidden\n:::::\n',
	'generic directive in a quote': '> :::spoiler\n> a\n> :::\n',
	'callout with a title': ':::note Heads up\nbody\n:::\n',
	details: '<details open>\n<summary>Spoilers</summary>\n\nbody\n\n</details>\n',
	'closed details': '<details>\n<summary>Closed</summary>\n\nhidden\n\n</details>',
	'crlf details': '<details>\r\n<summary>T</summary>\r\n\r\nx\r\n\r\n</details>\r\n',
	'nested callout': '::::note\n:::tip\nx\n:::\n::::\n',
	'quote holds a closer': '> :::\n> a\n',
	'no final break (quote)': '> a\n> b',
	'no final break (callout)': ':::note\nx\n:::',
	'no final break (item)': '- a\n\n  b',
	'unspaced alert head': '>[!NOTE]\n> a\n',
	'spaced alert head': '>   [!TIP]  \n> a\n',
	'alert keeps a spelled line': '> [!TIP]\n>b\n> c\n',
	'crlf quote': '> a\r\n> b\r\n',
	'crlf callout': ':::note\r\nx\r\n:::\r\n',
	'blank in quote': '> a\n>\n> b\n',
	'blank with space in quote': '> a\n> \n> b\n',
	'trailing blank in item': '- a\n\n  b\n  \n'
};

/** The documents the differential reads, by id. `quick` is the named cases and a few draws of each
 *  generator; `full` adds the behavior corpus, the spec's examples and hundreds of draws. */
export function differentialDocuments(
	scale: 'quick' | 'full',
	seed: number
): Record<string, string> {
	const draws = scale === 'full' ? 300 : 6;
	const docs: Record<string, string> = { ...NAMED_DOCUMENTS };
	if (scale === 'full') {
		for (const [id, source] of Object.entries({ ...SMALL_DOCUMENTS, ...FLUSH_JOIN_DOCUMENTS })) {
			docs[`small ${id}`] = source;
		}
		for (const long of LONG_DOCUMENTS) docs[`long ${long.id}`] = long.source;
		for (const e of [...loadSpecExamples(), ...loadDefinitionExamples()]) {
			docs[`spec ${e.example}`] = e.markdown;
		}
	}
	const sample = (name: string, arb: fc.Arbitrary<string>) =>
		fc
			.sample(arb, { numRuns: draws, seed })
			.forEach((source, i) => (docs[`${name} ${i}`] = source));
	sample('law', arbLawDocument);
	sample('respelled', arbRespelledContainerDoc);
	sample('respelled-plugin', arbRespelledPluginContainerDoc);
	// The respelled bodies inside a callout, a generic directive and a section.
	fc.sample(arbRespelledContainerDoc, { numRuns: draws, seed: seed + 1 }).forEach((body, i) => {
		const end = firstLineEnding(body) ?? '\n';
		docs[`colon ${i}`] = `:::note Title${end}${body}:::${end}`;
		docs[`colon generic ${i}`] = `::::spoiler{.x}${end}${end}${body}${end}::::${end}`;
		docs[`details ${i}`] =
			`<details open>${end}<summary>S</summary>${end}${end}${body}${end}</details>${end}`;
	});
	// Each document again without its last line break, where the file's last line ends.
	for (const [id, source] of Object.entries(docs)) {
		const cut = source.replace(/\r?\n$/, '');
		if (cut !== source) docs[`${id} (no final break)`] = cut;
	}
	return docs;
}

// ── Edits ────────────────────────────────────────────────────────────────────

interface Edit {
	name: string;
	/** Changes the node in place; returns the changed child when one child's bytes changed. */
	apply(node: CstNode): ChildRawChange | undefined | 'skip';
}

function lineEdit(i: number, name: string, rewrite: (lines: string[]) => string[] | null): Edit {
	return {
		name: `${name} child ${i}`,
		apply(node) {
			const child = node.children![i];
			const lines = splitLines(child.raw).map((l) => l.text + l.lineEnding);
			const next = rewrite(lines);
			if (next === null) return 'skip';
			const previousRaw = child.raw;
			child.raw = next.join('');
			return { index: i, previousRaw };
		}
	};
}

const endingOf = (line: string) => line.match(/\r?\n$/)?.[0] ?? '';
const textOf = (line: string) => line.slice(0, line.length - endingOf(line).length);
const appendX = (line: string) => textOf(line) + 'x' + endingOf(line);

/** A new line after `line`, ending like the document's lines. */
const linesAfter = (line: string, text: string, ending: string): string[] =>
	endingOf(line) ? [line, text + endingOf(line)] : [line + ending, text];

/** The edits for one container: each child's bytes changed, grown, cut short, removed; the body
 *  emptied; and the metadata a gesture can change without touching a child. */
function editsFor(node: CstNode, kind: string): Edit[] {
	const children = node.children!;
	const ending = firstLineEnding(node.raw) ?? '\n';
	// A `:::` container's and a section's child 0 is a title row; the body starts after it.
	const bodyStart = ['directiveContainer', 'admonition', 'details'].includes(kind) ? 1 : 0;
	const closerLike = kind === 'details' ? '</details>' : ':::';
	const edits: Edit[] = [];
	children.forEach((_, i) => {
		edits.push(lineEdit(i, 'x on line 0', (lines) => [appendX(lines[0] ?? ''), ...lines.slice(1)]));
		edits.push(
			lineEdit(i, 'x on last line', (lines) =>
				lines.length > 1 ? [...lines.slice(0, -1), appendX(lines.at(-1)!)] : null
			)
		);
		edits.push(
			lineEdit(i, 'line added', (lines) =>
				lines.length ? [...linesAfter(lines[0], 'new', ending), ...lines.slice(1)] : null
			)
		);
		edits.push(
			lineEdit(i, 'closer-like line added', (lines) =>
				lines.length && i >= bodyStart
					? [...linesAfter(lines[0], closerLike, ending), ...lines.slice(1)]
					: null
			)
		);
		edits.push(
			lineEdit(i, 'blank line added', (lines) =>
				lines.length && i >= bodyStart
					? [...linesAfter(lines[0], '', ending), ...lines.slice(1)]
					: null
			)
		);
		edits.push(
			lineEdit(i, 'first line removed', (lines) => (lines.length > 1 ? lines.slice(1) : null))
		);
		if (i >= bodyStart) {
			for (const trivia of ['kept', 'cleared'] as const) {
				edits.push({
					name: `child ${i} removed, next trivia ${trivia}`,
					apply(n) {
						if (n.children!.length - bodyStart < 2) return 'skip';
						n.children!.splice(i, 1);
						if (trivia === 'cleared' && n.children![i]) n.children![i].leadingTrivia = '';
						n.childSpans = undefined;
						return undefined;
					}
				});
			}
		}
	});
	// A range delete leaves an empty paragraph; deleting the text keeps its line ending.
	for (const [name, raw] of [
		['body emptied', ''],
		['text deleted', ownTrailingLineEnding(node.raw)]
	]) {
		edits.push({
			name,
			apply(n) {
				const empty: CstNode = { kind: 'paragraph', leadingTrivia: '', raw };
				n.children = [...n.children!.slice(0, bodyStart), empty];
				n.innerSuffix = '';
				n.childSpans = undefined;
				return undefined;
			}
		});
	}
	edits.push(...metadataEdits(node, kind));
	return edits;
}

function metadataEdits(node: CstNode, kind: string): Edit[] {
	if (!node.metadata) return [];
	const patch = (name: string, change: (m: Record<string, unknown>) => boolean): Edit => ({
		name,
		apply(n) {
			const copy = { ...(n.metadata as unknown as Record<string, unknown>) };
			if (!change(copy)) return 'skip';
			n.metadata = copy as unknown as CstNode['metadata'];
			n.childSpans = undefined;
			return undefined;
		}
	});
	if (kind === 'listItem') {
		return [
			patch('marker renumbered or swapped', (m) => {
				const marker = m.marker as string;
				const digits = /^\d+/.exec(marker)?.[0];
				m.marker = digits ? digits + '0' + marker.slice(digits.length) : swapBullet(marker);
				return true;
			}),
			patch('task toggled', (m) => {
				const task = m.taskMarker as string | null;
				if (!task) return false;
				m.taskMarker = task.startsWith('[ ]') ? '[x]' + task.slice(3) : '[ ]' + task.slice(3);
				m.taskChecked = !m.taskChecked;
				return true;
			})
		];
	}
	if (kind === 'details') return [patch('open toggled', (m) => ((m.open = !m.open), true))];
	if (kind === 'footnote-def') return [patch('label changed', (m) => ((m.label += 'b'), true))];
	if (kind === 'githubAlert') {
		return [
			patch('type changed', (m) => ((m.alertType = m.alertType === 'TIP' ? 'NOTE' : 'TIP'), true))
		];
	}
	return [];
}

const swapBullet = (marker: string) => (marker[0] === '-' ? '*' : '-') + marker.slice(1);

// ── The run ──────────────────────────────────────────────────────────────────

const KINDS = new Set<string>(CONTAINER_KINDS);

function containersOf(nodes: readonly CstNode[], out: CstNode[]): CstNode[] {
	for (const node of nodes) {
		if (!node.children) continue;
		if (KINDS.has(node.kind)) out.push(node);
		containersOf(node.children, out);
	}
	return out;
}

/** A copy of the container written by `write`, first unchanged (which also sets the child spans a
 *  keystroke's splice reads), then after `edit`; null when the edit doesn't apply to it. */
function writeAfter(
	node: CstNode,
	edit: Edit | null,
	write: Writer
): { raw: string; rereads: boolean } | null {
	const copy = structuredClone(node);
	const first = write(copy)?.rereads ?? false;
	if (!edit) return { raw: copy.raw, rereads: first };
	const changed = edit.apply(copy);
	if (changed === 'skip') return null;
	const rereads = write(copy, changed)?.rereads ?? false;
	return { raw: copy.raw, rereads };
}

function compare(node: CstNode, edit: Edit | null, today: Writer, shaped: Writer) {
	const a = writeAfter(node, edit, today);
	const b = writeAfter(node, edit, shaped);
	if (!a || !b) return null;
	return { today: a.raw, shaped: b.raw, rereads: [a.rereads, b.rereads] as [boolean, boolean] };
}

/** The bytes `write` gives every container of `source` after the edit named `edit`. */
export function rowsOf(
	source: string,
	edit: string,
	write: Writer
): { kind: string; raw: string }[] {
	return containersOf(parse(source).children, []).flatMap((node) => {
		const found = editsFor(node, node.kind).find((e) => e.name === edit);
		if (edit !== 'unchanged' && found === undefined) return [];
		const out = writeAfter(node, found ?? null, write);
		return out ? [{ kind: node.kind, raw: out.raw }] : [];
	});
}

/** Both writers over every container of every document, unchanged and after every edit. */
export function runDifferential(
	docs: Record<string, string>,
	today: Writer,
	shaped: Writer
): Tally {
	const tally: Tally = { cases: 0, mismatches: [], throws: [], warns: {} };
	for (const [doc, source] of Object.entries(docs)) {
		for (const node of containersOf(parse(source).children, [])) {
			for (const edit of [null, ...editsFor(node, node.kind)]) {
				const name = edit?.name ?? 'unchanged';
				try {
					const out = compare(node, edit, today, shaped);
					if (!out) continue;
					tally.cases++;
					for (const { tag } of takeDevWarns()) tally.warns[tag] = (tally.warns[tag] ?? 0) + 1;
					if (out.today === out.shaped && out.rereads[0] === out.rereads[1]) continue;
					tally.mismatches.push({ doc, kind: node.kind, edit: name, before: node.raw, ...out });
				} catch (error) {
					tally.throws.push({ doc, kind: node.kind, edit: name, message: String(error) });
				}
			}
		}
	}
	return tally;
}
