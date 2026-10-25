// The block parser as the rebuilt fix-up's bundle ships it: every answer here is one any Markdown
// block parser knows, never a question only the fix-up asks. Built by `scripts/fixup-bundle/`.

import type { CstNode, Document } from '../../core/nodes';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitLines } from '../../core/lines';
import { tableTakesLine } from '../../core/parsers/table';
import { defaultGrammarView as grammar } from '../../schema/block-openers';
import { readAsOpened } from '../../schema/opened-reading';
import { isGridKind, tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { reservedChromeKindOf } from '../../schema/reserved-chrome';
import { childHoldingLastLine, followBytes } from '../../schema/container-raw';
import { fragmentReaderAt } from '../../tree-operations/list/task-paragraph';

export const host = {
	read: (text: string): Document => parse(text, { grammar, scope: 'fragment' }),
	readOpened: (text: string): Document => readAsOpened(text, { grammar, scope: 'fragment' }),
	readInSlot: (owner: CstNode | undefined, index: number, text: string): Document =>
		fragmentReaderAt(owner, index, grammar)(text),
	continuesTableAbove: (raw: string): boolean => {
		const lines = splitLines(raw);
		return lines.length > 0 && tableTakesLine(lines, 0, lines.length, grammar);
	},
	readingsThatMayChange: () => [
		...new Set(grammar.orderedOpeners().flatMap((opener) => opener.readingNotFinal ?? []))
	],
	kindTraits: (kind: string) => {
		const descriptor = tryGetBlockKindDescriptor(kind as CstNode['kind']);
		const titleRowKind = reservedChromeKindOf(kind as CstNode['kind']);
		return {
			...(descriptor?.bodyWrap ? { bodyWrap: { ...descriptor.bodyWrap } } : {}),
			contextDependent: descriptor?.contextDependentKind === true,
			stripContainer: descriptor?.containerContract === 'strip',
			grid: isGridKind(kind as CstNode['kind']),
			...(titleRowKind ? { titleRowKind } : {})
		};
	},
	containerAfterRewrite: (node: CstNode, rawBefore: string) => {
		const copy = structuredClone(node);
		return { node: copy, outcome: followBytes(copy, rawBefore, grammar).outcome };
	},
	childWithLastLine: (node: CstNode): number => childHoldingLastLine(node),
	serialize: (doc: Document): string => serialize(doc)
};
