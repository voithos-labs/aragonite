/**
 * Type pins for the read-only view types on the public plugin API, so plugin code cannot write
 * bytes through a node an undo entry shares (G1.9). The `@ts-expect-error` directives are the
 * assertions: `npm run check` fails if a byte write starts compiling through a read-only type,
 * or if an implementation widens its view parameter back to the mutable one.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import type { DecorationSource, MarkDecoration } from '#lib/decorations/types.js';
import type { EditorContext } from '#lib/schema/plugin-install.js';
import type { BlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';

export function compileTimePins(editor: EditorContext): void {
	// @ts-expect-error raw is serialized bytes, read-only through EditorContext.document
	editor.document.children[0].raw = '# changed\n';
	// @ts-expect-error children structure is readonly through EditorContext.document
	editor.document.children = [];

	const byteWriter: DecorationSource = {
		name: 'pin-byte-write',
		provide: (doc) => {
			// @ts-expect-error a source reads its doc through the view, so byte writes don't compile
			doc.children[0].raw = '# changed\n';
			return [];
		}
	};

	const paramWidener: DecorationSource = {
		name: 'pin-mutable-param',
		// @ts-expect-error annotating the mutable Document is rejected; the view parameter
		// checks contravariantly, so a source cannot hand itself write access
		provide: (_doc: Document) => []
	};

	// @ts-expect-error a read hook annotated with the mutable CstNode is rejected:
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
				d.children.map((child, i): MarkDecoration => ({
					type: 'mark',
					path: [i],
					start: 0,
					end: child.raw.length,
					class: 'pin'
				}))
		};
		expect(source.provide(doc, { editEpoch: 0 })).toHaveLength(2);
	});
});
