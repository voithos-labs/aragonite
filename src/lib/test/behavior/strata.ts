// The differential's row families, each built from the corpus by one call so a suite file only
// picks a family and records it.

import type { CstNode, InlineNode } from '#lib/core/nodes.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { getContentRange, parseInline } from '#lib/core/inline/index.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { loadDefinitionExamples, loadSpecExamples } from '../gfm-conformance/corpus';
import {
	FLUSH_JOIN_DOCUMENTS,
	KEYS,
	MOVE_KEYS,
	SEQUENCE_SEEDS,
	SEQUENCE_STEPS,
	SMALL_DOCUMENTS,
	SYNTAX_PLUGINS,
	blockPairs,
	LONG_DOCUMENTS,
	type Key
} from './corpus';
import { keyRows, sequenceRows, sitesOf } from './key-driver';
import { textField, type Row } from './rows';

/** Every key at every offset of every site of the small documents and the flush joins, and each
 *  flush join's blocks moved up and down. */
export async function keystrokeRows(mode: PresentationMode): Promise<Row[]> {
	const rows: Row[] = [];
	const documents = { ...SMALL_DOCUMENTS, ...FLUSH_JOIN_DOCUMENTS };
	for (const [id, source] of Object.entries(documents)) {
		const label = `keys ${mode} ${id}`;
		for (const site of await sitesOf(source, mode)) {
			for (let offset = 0; offset <= site.end; offset++) {
				rows.push(...(await keyRows(label, source, mode, site, offset)));
			}
			if (id in FLUSH_JOIN_DOCUMENTS) {
				rows.push(...(await keyRows(label, source, mode, site, 0, MOVE_KEYS)));
			}
		}
	}
	return rows;
}

/** Each seed's keys in both modes, over the small document the seed names. */
export async function sequenceStratum(): Promise<Row[]> {
	const ids = Object.keys(SMALL_DOCUMENTS);
	const rows: Row[] = [];
	for (const seed of SEQUENCE_SEEDS) {
		const id = ids[seed % ids.length];
		for (const mode of ['source', 'live'] as const) {
			const label = `seq ${mode} ${seed} ${id}`;
			rows.push(...(await sequenceRows(label, seed, SMALL_DOCUMENTS[id], mode, SEQUENCE_STEPS)));
		}
	}
	return rows;
}

// ── Documents ────────────────────────────────────────────────────────────────

const pick = (...names: string[]): Key[] => names.map((name) => KEYS.find((k) => k.name === name)!);
const AT_FIRST_END = pick('a', 'Enter', 'Delete');
const AT_SECOND_START = pick('Backspace');

/** How each long document and spec example parses, then keys at the join of each adjacent block
 *  pair of the long documents, in live mode, the showcase's own. */
export async function documentRows(): Promise<Row[]> {
	installPlugins(SYNTAX_PLUGINS);
	const rows: Row[] = [];
	const parsed = [
		...loadSpecExamples().map((e) => ({ id: `spec ${e.example}`, source: e.markdown })),
		...loadDefinitionExamples().map((e) => ({
			id: `spec definition ${e.example}`,
			source: e.markdown
		})),
		...LONG_DOCUMENTS
	];
	for (const { id, source } of parsed) {
		const doc = parse(source);
		const read = serialize(doc);
		rows.push({
			in: `docs ${id}`,
			bytes: read === source ? '=' : textField(source, read),
			outline: textField('', outline(doc.children))
		});
	}
	for (const long of LONG_DOCUMENTS) {
		for (const pair of blockPairs(long)) rows.push(...(await pairRows(pair.id, pair.source)));
	}
	return rows;
}

async function pairRows(id: string, source: string): Promise<Row[]> {
	const sites = await sitesOf(source, 'live');
	const first = sites.filter((site) => site.path[0] === 0).at(-1);
	const second = sites.find((site) => site.path[0] === 1);
	const label = `docs pair ${id}`;
	const rows: Row[] = [];
	if (first) rows.push(...(await keyRows(label, source, 'live', first, first.end, AT_FIRST_END)));
	if (second) {
		rows.push(...(await keyRows(label, source, 'live', second, second.start, AT_SECOND_START)));
	}
	return rows;
}

/** Block kinds nested by container, each leaf with its inline node kinds nested the same way. */
function outline(nodes: readonly CstNode[]): string {
	return nodes
		.map((node) => {
			if (node.children) return `${node.kind}(${outline(node.children)})`;
			const { start, end } = getContentRange(node);
			return `${node.kind}[${inlineOutline(parseInline(node.raw, start, end))}]`;
		})
		.join(' ');
}

function inlineOutline(nodes: readonly InlineNode[]): string {
	return nodes
		.map((node) => (node.children ? `${node.kind}(${inlineOutline(node.children)})` : node.kind))
		.join(' ');
}
