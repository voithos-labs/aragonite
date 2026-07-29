// @vitest-environment jsdom
//
// The content version is the memo key every whole-document derivation hangs on,
// so its one contract is coverage: if a byte-carrying field can move without the
// version moving, a consumer memoized on it silently serves a stale answer. These
// cases walk the `BytesView` field set (core/node-views.ts) one field at a time,
// plus the stability case that makes it a memo key rather than a clock.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { createContentVersion } from '../../reactivity/content-version.svelte';
import type { Document } from '../../core/nodes';
import type { DocumentView } from '../../core/node-views';

function setup(build: () => Document) {
	const doc = $state(build());
	let version!: () => number;
	const cleanup = $effect.root(() => {
		version = createContentVersion(() => doc as DocumentView);
	});
	return {
		get doc() {
			return doc;
		},
		version: () => version(),
		cleanup
	};
}

function paragraph(raw: string): Document['children'][number] {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

function quoteWith(raw: string): Document['children'][number] {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: `> ${raw}`,
		innerPrefix: '',
		innerSuffix: '',
		children: [paragraph(raw)]
	} as Document['children'][number];
}

// The one metadata array in the model (`cloneMetadata` names it), and its writers
// set elements in place (tree-operations/table-mutations.ts).
function tableWithAlignments(): Document['children'][number] {
	return {
		kind: 'table',
		leadingTrivia: '',
		raw: '| a |\n| --- |\n',
		metadata: { alignments: ['none'] }
	} as unknown as Document['children'][number];
}

function makeDoc(children: Document['children']): Document {
	return { kind: 'document', prefix: '', children, suffix: '' };
}

describe('content version — every byte-carrying move changes it', () => {
	const mutations: Array<[string, (doc: Document) => void]> = [
		['a leaf raw write (routine typing)', (doc) => void (doc.children[0].raw = 'edited\n')],
		['a nested leaf raw write', (doc) => void (doc.children[1].children![0].raw = 'inner\n')],
		['a leaf kind swap', (doc) => void (doc.children[0].kind = 'heading')],
		['leading trivia', (doc) => void (doc.children[0].leadingTrivia = '\n')],
		[
			'metadata (a heading level, not a raw byte of its own)',
			(doc) => void (doc.children[0].metadata = { level: 3 } as never)
		],
		[
			'a metadata array element written in place (a table alignment)',
			(doc) => void ((doc.children[2].metadata as { alignments: string[] }).alignments[0] = 'left')
		],
		['a container inner prefix', (doc) => void (doc.children[1].innerPrefix = ' ')],
		['a children splice', (doc) => void doc.children.push(paragraph('added\n'))],
		['a whole children replacement (the commit publish)', (doc) => void (doc.children = [])],
		['the document suffix', (doc) => void (doc.suffix = '\n')]
	];

	for (const [name, mutate] of mutations) {
		it(`changes on ${name}`, () => {
			const h = setup(() =>
				makeDoc([paragraph('one\n'), quoteWith('two\n'), tableWithAlignments()])
			);
			const before = h.version();
			mutate(h.doc);
			flushSync();
			expect(h.version()).not.toBe(before);
			h.cleanup();
		});
	}

	it('is stable across reads when nothing moved — otherwise it is a clock, not a key', () => {
		const h = setup(() => makeDoc([paragraph('one\n')]));
		const first = h.version();
		flushSync();
		expect(h.version()).toBe(first);
		expect(h.version()).toBe(first);
		h.cleanup();
	});
});
