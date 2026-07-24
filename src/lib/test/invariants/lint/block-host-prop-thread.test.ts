/**
 * Sibling-path parity: BlockHost dispatches a block to one of TWO component
 * branches (the registered component, or the raw-editable fallback), and the
 * instance-delivered props read from editor context — `document` and `rects` —
 * must ride BOTH. A prop threaded on one branch but not the other is invisible to
 * any block that happens to render through the missing branch (a raw fallback, a
 * container's nested child), the exact hole the toc dogfood's nested e2e guards
 * for `document`. This scans the source so a NEW context-delivered prop, or a
 * dropped one, fails the day it lands rather than at the next audit.
 */

import { describe, it, expect } from 'vitest';
import { readEditorFile } from './scan-source';

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
		const { code } = readEditorFile('components/BlockHost.svelte');
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
