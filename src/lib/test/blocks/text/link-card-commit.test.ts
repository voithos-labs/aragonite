// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createLinkCardCommitter } from '$lib/components/link-card/link-card-commit';
import type { LinkTarget } from '$lib/components/blocks/text/link-at-point';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

// What the card decides ON TOP of the write seam: which fields survive a url edit, and when the
// reference form is kept. The bytes themselves are the seam's business.

function makeCard(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const map = buildLinkReferenceMap(harness.doc.children);
	const controller = createUndoController(harness.deps);
	const committer = createLinkCardCommitter({
		getDoc: () => harness.doc,
		getEditorEl: () => null,
		getTarget: () => null,
		controller,
		events: harness.events,
		measureRange: () => [],
		landCaret: vi.fn().mockResolvedValue(true),
		linkRef: { current: map.resolve, signature: map.signature }
	});
	const raw = () => harness.doc.children[0].raw;
	return { committer, raw, target: { path: [0], sourceStart: raw().indexOf('[') } as LinkTarget };
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe('link card commit — which fields survive a url edit', () => {
	it('keeps a title the card never showed', async () => {
		const card = makeCard('Visit [x](old "Ti") now\n');
		card.committer.commitUrl(card.target, 'new');
		await settle();
		expect(card.raw()).toBe('Visit [x](new "Ti") now\n');
	});

	it('keeps the link text bytes, nested constructs and all', async () => {
		const card = makeCard('Visit [**b** c](old) now\n');
		card.committer.commitUrl(card.target, 'new');
		await settle();
		expect(card.raw()).toBe('Visit [**b** c](new) now\n');
	});

	it('an unchanged url writes nothing at all', async () => {
		const card = makeCard('Visit [x](old) now\n');
		card.committer.commitUrl(card.target, 'old');
		await settle();
		expect(card.raw()).toBe('Visit [x](old) now\n');
	});

	// Miss: the unchanged-url pin above used a destination the serializer reproduces
	// byte-identically, so the rebuild-and-rewrite it actually performed looked like a no-op.
	it('an unchanged url never respells author bytes the serializer would normalize', async () => {
		const card = makeCard('Visit [x](<a b>) now\n');
		// What the field shows for the angle form, committed back untouched.
		expect(card.committer.resolve(card.target)?.url).toBe('a%20b');
		card.committer.commitUrl(card.target, 'a%20b');
		await settle();
		expect(card.raw()).toBe('Visit [x](<a b>) now\n');
	});
});

describe('link card commit — reference forms', () => {
	const DOC = 'Read [docs][ref] later\n\n[ref]: https://example.com/d\n';

	it('resolves the destination the definition supplies', () => {
		const card = makeCard(DOC);
		expect(card.committer.resolve(card.target)?.url).toBe('https://example.com/d');
	});

	it('a NEW url inlines the form and leaves the definition alone', async () => {
		const card = makeCard(DOC);
		card.committer.commitUrl(card.target, 'https://example.com/new');
		await settle();
		expect(card.raw()).toBe('Read [docs](https://example.com/new) later\n');
	});

	it('remove-link unwraps to the text, definition untouched', async () => {
		const card = makeCard(DOC);
		card.committer.removeLink(card.target);
		await settle();
		expect(card.raw()).toBe('Read docs later\n');
	});
});
