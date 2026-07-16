/**
 * Type pins for the CstNode discriminated union. The `@ts-expect-error`
 * directives ARE the assertions: `npm run check` fails if one goes unused (an
 * illegal shape started compiling). The positive reads pin that narrowing still
 * yields per-arm metadata. `compileTimePins` is never invoked — only the runtime
 * cases execute.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { isBuiltinBlockNode, makeBlockNode } from '../../core/nodes';
import type { CstNode, HeadingNode, ParagraphNode, PluginBlockKind } from '../../core/nodes';

export function compileTimePins(node: CstNode, pluginKind: PluginBlockKind): void {
	// Guarding to the built-in union lets `switch (node.kind)` yield each arm's
	// metadata with no cast (positive pin — stops compiling if discrimination breaks).
	if (isBuiltinBlockNode(node)) {
		switch (node.kind) {
			case 'heading': {
				const level: number = node.metadata.level;
				void level;
				break;
			}
			case 'list': {
				const ordered: boolean = node.metadata.ordered;
				void ordered;
				break;
			}
		}
	}

	// The guard is load-bearing: on the full union the branded plugin arm blocks
	// discrimination, so a bare kind check does NOT narrow metadata.
	switch (node.kind) {
		case 'heading': {
			// @ts-expect-error full-union kind check does not narrow past the plugin arm
			const blocked: number = node.metadata.level;
			void blocked;
			break;
		}
	}

	const wrongMeta: HeadingNode = {
		kind: 'heading',
		leadingTrivia: '',
		raw: '',
		// @ts-expect-error a heading carries HeadingMetadata, not list metadata
		metadata: { ordered: true }
	};
	void wrongMeta;

	// @ts-expect-error a heading's metadata is required
	const noMeta: HeadingNode = { kind: 'heading', leadingTrivia: '', raw: '' };
	void noMeta;

	const leafWithChildren: ParagraphNode = {
		kind: 'paragraph',
		leadingTrivia: '',
		raw: '',
		// @ts-expect-error a leaf arm cannot carry children (G1.5 stated as a type)
		children: []
	};
	void leafWithChildren;

	// The open plugin arm accepts any branded kind (positive pin).
	const pluginNode: CstNode = { kind: pluginKind, leadingTrivia: '', raw: '' };
	void pluginNode;
}

describe('CstNode discriminated union', () => {
	it('narrows a parsed node to its built-in arm and reads typed metadata', () => {
		const doc = parse('### deep\n');
		const node = doc.children[0];
		let level = 0;
		if (isBuiltinBlockNode(node) && node.kind === 'heading') level = node.metadata.level;
		expect(level).toBe(3);
	});

	it('makeBlockNode mints a fresh object so it cannot strip a passed view', () => {
		const fields = { kind: 'paragraph' as const, leadingTrivia: '', raw: 'x\n' };
		const node = makeBlockNode(fields);
		expect(node).not.toBe(fields);
		expect(node.raw).toBe('x\n');
	});
});
