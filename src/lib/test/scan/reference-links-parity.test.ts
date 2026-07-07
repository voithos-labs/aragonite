import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';
import { scanInline } from '../../core/inline/scan';
import { buildLinkReferenceMap } from '../../core/inline/link-reference-resolver';
import { parse } from '../../core/parser';

// Old-parser parity pins — this suite dies at cutover with the old pipeline.
// unresolvedReference is invisible to commonmark, so the old parser is the
// only oracle for its shape, and for whether resolver-returned url/title
// reach the node raw or processed.

const doc = parse('[go]: /a\\(b)%zzé "Ti tle"');
const resolver = buildLinkReferenceMap(doc.children).resolve;

function pickReference(nodes: InlineNode[]) {
	const node = nodes.find((n) => n.kind === 'link' || n.kind === 'image');
	expect(node).toBeDefined();
	const { kind, start, end, url, title, label } = node!;
	return { kind, start, end, url, title, label };
}

describe('resolved reference fields match the old parser (raw url/title pass-through)', () => {
	for (const raw of ['[x][go]', '[go][]', '[go]', '![x][go]']) {
		it(raw, () => {
			const oldNodes = parseInline(raw, 0, raw.length, resolver);
			const newNodes = scanInline(raw, 0, raw.length, resolver);
			expect(pickReference(newNodes)).toEqual(pickReference(oldNodes));
		});
	}
});

describe('unresolvedReference output equals the old parser node-for-node', () => {
	for (const raw of ['[foo][bar]', '[foo][]', '[foo]', '![foo][bar]', '[`c`][bar]']) {
		it(`resolver miss: ${raw}`, () => {
			expect(scanInline(raw, 0, raw.length, resolver)).toEqual(
				parseInline(raw, 0, raw.length, resolver)
			);
		});
	}

	for (const raw of ['[foo][bar]', '[foo][]', '[foo]', '![foo][bar]']) {
		it(`no resolver: ${raw}`, () => {
			expect(scanInline(raw, 0, raw.length)).toEqual(parseInline(raw, 0, raw.length));
		});
	}
});
