/**
 * BlockHost renders a block through one of two component branches, and every prop it reads from
 * editor context must reach both: a prop on one branch only is missing for every block rendered
 * through the other (a raw fallback, a container's nested child). A source scan, so a new or
 * dropped context prop fails the day it lands.
 */

import { describe, it, expect } from 'vitest';
import { readSource } from './scan-source';
import { SOURCE } from './source-paths';

const CONTEXT_PROPS = ['document', 'rects'] as const;
const BRANCH_TAGS = ['Comp', 'TextEditableBlock'] as const;

/** The attribute text of the first `<Tag …/>` element in `code`, or null. */
function elementAttrs(code: string, tag: string): string | null {
	const open = code.indexOf(`<${tag}`);
	if (open === -1) return null;
	const close = code.indexOf('/>', open);
	if (close === -1) return null;
	return code.slice(open + tag.length + 1, close);
}

interface MissingThread {
	tag: string;
	prop: string;
}

function findMissingThreads(code: string): MissingThread[] {
	const missing: MissingThread[] = [];
	for (const tag of BRANCH_TAGS) {
		const attrs = elementAttrs(code, tag);
		if (attrs === null) {
			missing.push({ tag, prop: '(branch not found)' });
			continue;
		}
		for (const prop of CONTEXT_PROPS) {
			if (!new RegExp(`(^|[\\s{])${prop}[\\s=}]`).test(attrs)) missing.push({ tag, prop });
		}
	}
	return missing;
}

describe('BlockHost context-prop thread source-scan', () => {
	it('both dispatch branches thread every context-delivered prop', () => {
		const { code } = readSource(SOURCE.blockHost);
		expect(findMissingThreads(code)).toEqual([]);
	});

	// ── Matcher self-test (non-vacuity) ─────────────────────────────────────

	it('flags a branch that drops a context prop', () => {
		const bad = '<Comp {node} {rects} /> <TextEditableBlock {node} document={x} />';
		expect(findMissingThreads(bad)).toEqual([
			{ tag: 'Comp', prop: 'document' },
			{ tag: 'TextEditableBlock', prop: 'rects' }
		]);
	});

	it('accepts both branches threading both props', () => {
		const good =
			'<Comp {node} document={getDoc?.()} {rects} /> <TextEditableBlock {node} document={getDoc?.()} {rects} blockClass="raw" />';
		expect(findMissingThreads(good)).toEqual([]);
	});
});
