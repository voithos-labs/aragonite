/**
 * Type pins for the view-typed public plugin surface (G1.9 at the barrel). The
 * `@ts-expect-error` directives are the assertions: `npm run check` fails if a
 * byte write starts compiling through a public read surface, or if an
 * implementation can re-widen its view param to the mutable type — the read
 * hooks are function-type properties, so params check contravariantly instead
 * of slipping through method bivariance. The pin function is never invoked;
 * the runtime case covers the one direction that runs: a freshly parsed
 * mutable Document feeds every view-typed reader with no conversion step.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import type { CstNode, Document } from '../../core/nodes';
import type { DecorationSource, MarkDecoration } from '../../decorations/types';
import type { EditorContext } from '../../schema/plugin-install';
import type { BlockKindDescriptor } from '../../schema/block-kind-descriptor';

export function compileTimePins(editor: EditorContext): void {
	// @ts-expect-error raw is serialized bytes — readonly through EditorContext.document
	editor.document.children[0].raw = '# changed\n';
	// @ts-expect-error children structure is readonly through EditorContext.document
	editor.document.children = [];

	const byteWriter: DecorationSource = {
		name: 'pin-byte-write',
		provide: (doc) => {
			// @ts-expect-error a source reads its doc through the view — byte writes don't compile
			doc.children[0].raw = '# changed\n';
			return [];
		}
	};

	const paramWidener: DecorationSource = {
		name: 'pin-mutable-param',
		// @ts-expect-error annotating the mutable Document is rejected — the view param
		// checks contravariantly, so a source cannot hand itself write access
		provide: (_doc: Document) => []
	};

	// @ts-expect-error a read hook annotated with the mutable CstNode is rejected —
	// descriptor read hooks receive views
	const hookWidener: BlockKindDescriptor['getContentRange'] = (node: CstNode) => ({
		start: 0,
		end: node.raw.length
	});

	void [byteWriter, paramWidener, hookWidener];
}

describe('plugin surface views', () => {
	it('a mutable Document feeds a view-typed source with no conversion step', () => {
		const doc: Document = parse('# h\n\npara\n');
		const source: DecorationSource = {
			name: 'reader',
			provide: (d) =>
				d.children.map(
					(child, i): MarkDecoration => ({
						type: 'mark',
						path: [i],
						start: 0,
						end: child.raw.length,
						class: 'pin'
					})
				)
		};
		expect(source.provide(doc, { editEpoch: 0 })).toHaveLength(2);
	});
});
