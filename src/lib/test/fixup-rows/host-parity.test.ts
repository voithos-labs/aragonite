// The bundle's host gives every answer the fix-up's own call sites get today, over the spec
// examples, the showcase, the changelog, the README and generated strings. Runs only with
// `FIXUP_HOST=<path to the built host.mjs>`.
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { CstNode } from '#lib/core/nodes.js';
import { readBlocks } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { displayLines, firstLineEnding, splitLines } from '#lib/core/lines.js';
import { tableTakesLine } from '#lib/core/parsers/table.js';
import {
	defaultGrammarView as grammar,
	lineMayFinishReading,
	lineMayFinishReadingAbove,
	readingNotFinalIn,
	readsOnIn
} from '#lib/schema/block-openers.js';
import { ensureEditableContainers } from '#lib/schema/opened-reading.js';
import { isGridKind, tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { reservedChromeKindOf } from '#lib/schema/reserved-chrome.js';
import { childHoldingLastLine, followBytes } from '#lib/schema/container-raw.js';
import { fragmentReaderAt } from '#lib/tree-operations/list/task-paragraph.js';
import { loadSpecExamples } from '../gfm-conformance/corpus';
import { LONG_DOCUMENTS } from '../behavior/corpus';

const ALPHABET = [
	'a',
	' ',
	'\n',
	'>',
	'-',
	'*',
	'1.',
	'#',
	'```',
	'|',
	':::',
	'$$',
	'\t',
	'<div>',
	'[x]: y'
];

function inputs(): string[] {
	const texts = [
		...LONG_DOCUMENTS.map((doc) => doc.source),
		readFileSync('README.md', 'utf8'),
		...loadSpecExamples().map((example) => example.markdown)
	];
	for (let n = 0; n < 6000; n++) {
		let text = '';
		let x = (n * 2654435761) >>> 0;
		for (let i = 0; i < 6; i++) {
			text += ALPHABET[x % ALPHABET.length];
			x = Math.floor(x / ALPHABET.length) + i * 7919;
		}
		texts.push(text);
	}
	return texts;
}

const lineTexts = (raw: string) => displayLines(raw).map((line) => line.text);

/** Every answer for `text`, asked the way the fix-up's call sites ask today. */
function today(text: string) {
	const doc = readBlocks(text, { grammar, scope: 'fragment' });
	const opened = readBlocks(text, { grammar, scope: 'fragment' });
	for (const block of opened.children)
		ensureEditableContainers(block, firstLineEnding(text) ?? '\n');
	const notFinal = readingNotFinalIn(grammar);
	const readsOn = readsOnIn(grammar);
	return answers(doc.children, {
		read: serialize(doc) + JSON.stringify(doc),
		opened: JSON.stringify(opened),
		notFinal,
		readsOn,
		mayClose: (line) => lineMayFinishReading(line, grammar),
		mayCloseAbove: (line) => lineMayFinishReadingAbove(line, grammar),
		table: (raw) => {
			const lines = splitLines(raw);
			return lines.length > 0 && tableTakesLine(lines, 0, lines.length, grammar);
		},
		traits: (kind) => {
			const descriptor = tryGetBlockKindDescriptor(kind as CstNode['kind']);
			return {
				bodyWrap: descriptor?.bodyWrap,
				contextDependent: descriptor?.contextDependentKind === true,
				stripContainer: descriptor?.containerContract === 'strip',
				grid: isGridKind(kind as CstNode['kind']),
				titleRowKind: reservedChromeKindOf(kind as CstNode['kind'])
			};
		},
		slot: (owner, index) => JSON.stringify(fragmentReaderAt(owner, index, grammar)('x\n')),
		rewrite: (node) => {
			const copy = structuredClone(node);
			const rawBefore = copy.raw;
			copy.raw = ' ' + copy.raw;
			return JSON.stringify([followBytes(copy, rawBefore, grammar).outcome, copy]);
		},
		lastLine: (node) => childHoldingLastLine(node)
	});
}

interface Asks {
	read: string;
	opened: string;
	notFinal: (raw: string) => boolean;
	readsOn: (raw: string) => boolean;
	mayClose: (line: string) => boolean;
	mayCloseAbove: (line: string) => boolean;
	table: (raw: string) => boolean;
	traits: (kind: string) => unknown;
	slot: (owner: CstNode, index: number) => string;
	rewrite: (node: CstNode) => string;
	lastLine: (node: CstNode) => number;
}

function answers(children: readonly CstNode[], ask: Asks): string {
	const containers = children.filter((child) => child.children);
	return JSON.stringify({
		read: ask.read,
		opened: ask.opened,
		blocks: children.map((child) => [
			ask.notFinal(child.raw),
			ask.readsOn(child.raw),
			lineTexts(child.raw).map((line) => [ask.mayClose(line), ask.mayCloseAbove(line)]),
			ask.table(child.raw),
			ask.traits(child.kind)
		]),
		containers: containers.map((node) => [
			node.children!.map((_, i) => ask.slot(node, i)),
			ask.rewrite(node),
			ask.lastLine(node)
		])
	});
}

it('the host answers as the fix-up is answered today', async () => {
	const path = process.env.FIXUP_HOST;
	if (!path) return;
	const { host } = await import(/* @vite-ignore */ pathToFileURL(path).href);
	const readings = host.readingsThatMayChange() as {
		notFinal(raw: string): boolean;
		mayClose(line: string): boolean;
		readsOn?: boolean;
	}[];
	const traitsOf = (kind: string) => {
		const traits = host.kindTraits(kind);
		return {
			bodyWrap: traits.bodyWrap,
			contextDependent: traits.contextDependent,
			stripContainer: traits.stripContainer,
			grid: traits.grid,
			titleRowKind: traits.titleRowKind
		};
	};
	const differ: string[] = [];
	const texts = inputs();
	for (const text of texts) {
		const doc = host.read(text);
		const theirs = answers(doc.children, {
			read: host.serialize(doc) + JSON.stringify(doc),
			opened: JSON.stringify(host.readOpened(text)),
			notFinal: (raw) => readings.some((reading) => reading.notFinal(raw)),
			readsOn: (raw) => readings.some((reading) => reading.readsOn && reading.notFinal(raw)),
			mayClose: (line) => readings.some((reading) => reading.mayClose(line)),
			mayCloseAbove: (line) =>
				readings.some((reading) => !reading.readsOn && reading.mayClose(line)),
			table: (raw) => host.continuesTableAbove(raw),
			traits: traitsOf,
			slot: (owner, index) => JSON.stringify(host.readInSlot(owner, index, 'x\n')),
			rewrite: (node) => {
				const rawBefore = node.raw;
				const result = host.containerAfterRewrite({ ...node, raw: ' ' + node.raw }, rawBefore);
				return JSON.stringify([result.outcome, result.node]);
			},
			lastLine: (node) => host.childWithLastLine(node)
		});
		if (theirs !== today(text)) differ.push(JSON.stringify(text).slice(0, 80));
	}
	console.log(`host parity: ${texts.length} inputs, ${differ.length} differ`);
	expect(differ.slice(0, 10), `${differ.length} of ${texts.length} inputs differ`).toEqual([]);
});
