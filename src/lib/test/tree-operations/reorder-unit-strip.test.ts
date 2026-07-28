import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resolveReorderUnit } from '$lib/tree-operations/reorder-unit';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { footnotesPlugin } from '$lib/plugins/footnotes';

// A strip plugin container (githubAlert, footnote-def) reorders its body children
// among themselves, exactly as the built-in blockquote does — the resolver must land
// on the container, not walk past it to the document slot (the teleport). Reorder-within
// membership is the descriptor's declared `reorderChildren` capability, not a kind name.

beforeAll(() => {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
});

describe('resolveReorderUnit — strip plugin containers reorder within', () => {
	it('a githubAlert body child resolves to the alert, not the document', () => {
		const doc = parse('> [!NOTE]\n> a\n>\n> b\n');
		expect(doc.children[0].kind).toBe('githubAlert');
		// Pre-fix this walked past the alert to the document root, returning
		// { parentPath: [], index: 0 } — the whole-alert teleport.
		expect(resolveReorderUnit(doc, [0, 1])).toMatchObject({ parentPath: [0], index: 1 });
	});

	it('a footnote-def body child resolves to the definition, not the document', () => {
		const doc = parse('[^a]: first\n\n    second\n');
		expect(doc.children[0].kind).toBe('footnote-def');
		expect(doc.children[0].children?.length).toBe(2);
		expect(resolveReorderUnit(doc, [0, 1])).toMatchObject({ parentPath: [0], index: 1 });
	});
});
