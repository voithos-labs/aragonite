// The block parser the list fix-up reads with: the editor's own grammar, plugins included.
import type { CstNode } from '../../core/nodes';
import { splitLines } from '../../core/lines';
import { tableTakesLine } from '../../core/parsers/table';
import {
	unfinishedReadings,
	waitingAboveClosedBy,
	type GrammarView
} from '../../schema/block-openers';
import { readAsOpened } from '../../schema/opened-reading';
import { isGridKind, tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { childHoldingLastLine, followBytes } from '../../schema/container-raw';
import { dropChildSpans } from '../../schema/child-spans';
import { cloneMetadata } from '../clone';
import { fragmentReaderAt } from '../list/task-paragraph';
import { itemsShareList } from '../list/ordered-markers';
import type { Host } from './types';

const hosts = new WeakMap<GrammarView, Host>();

export function editorHost(grammar: GrammarView): Host {
	let host = hosts.get(grammar);
	if (!host) hosts.set(grammar, (host = createHost(grammar)));
	return host;
}

function createHost(grammar: GrammarView): Host {
	return {
		readOpened: (text) => readAsOpened(text, { grammar, scope: 'fragment' }),
		readInSlot: (owner, index, text) => fragmentReaderAt(owner, index, grammar)(text),
		continuesTableAbove: (raw) => {
			const lines = splitLines(raw);
			return lines.length > 0 && tableTakesLine(lines, 0, lines.length, grammar);
		},
		readingsThatMayChange: () => unfinishedReadings(grammar),
		waitingAboveClosedBy: (written, rawAbove, count) =>
			waitingAboveClosedBy(written, rawAbove, count, unfinishedReadings(grammar)),
		kindTraits: (kind) => {
			const descriptor = tryGetBlockKindDescriptor(kind as CstNode['kind']);
			return {
				bodyWrap: descriptor?.bodyWrap,
				titleRowKind: descriptor?.reservedChrome?.kind,
				container: descriptor?.isContainer === true,
				contextDependent: descriptor?.contextDependentKind === true,
				stripContainer: descriptor?.containerContract === 'strip',
				grid: isGridKind(kind as CstNode['kind'])
			};
		},
		containerAfterRewrite: (node, rawBefore) => {
			const copy = { ...node };
			if (node.metadata) copy.metadata = cloneMetadata(node.metadata);
			dropChildSpans(copy);
			followBytes(copy, rawBefore, grammar);
			return { node: copy };
		},
		listsContinue: (upper, lower) => itemsShareList(upper.children?.at(-1), lower.children?.[0]),
		childWithLastLine: (node) => childHoldingLastLine(node)
	};
}
