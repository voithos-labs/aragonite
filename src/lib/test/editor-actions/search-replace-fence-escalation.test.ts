import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createSearchReplace } from '$lib/editor-actions/search-replace';
import { compileMatcher } from '$lib/search/matcher';
import { scanDocument } from '$lib/search/document-scan';
import { expectParseConverged } from '../harness/parse-converged';
import { makeEditorActionsDeps } from '../harness/editor-actions';

// A replacement is literal content, so a fence run it lands in a code body must grow the
// block's fence instead of terminating it, and a replacement that CONSUMES the closer must
// get it back (issue #55, same door). Miss-analysis: the G4.24 funnel lint pinned the
// COMPONENT's write sites, and no test drove a byte sink that reaches a fencedCode raw
// without the surface — the descriptor-hook route (`normalizeRawWrite`) had no fence arm at
// all. Issue #45.

function makeDoc(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	return { deps, replace: createSearchReplace(deps, createUndoController(deps)) };
}

function scan(doc: Document, query: string) {
	const compiled = compileMatcher(query, { caseSensitive: true, wholeWord: false, regex: false });
	if (!compiled.ok) throw new Error(compiled.error);
	return scanDocument(doc, compiled.matcher);
}

const BACKTICKS = '```';

describe('search/replace into a fenced code block', () => {
	it('grows the fence past a replacement that lands a closer run in the body', async () => {
		const { deps, replace } = makeDoc('```js\nXX\nconst x = 1\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'XX'), BACKTICKS);

		expect(serialize(deps.doc)).toBe('````js\n```\nconst x = 1\n````\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	it('keeps the heading a sibling instead of feeding it to a trailing fence', async () => {
		const { deps, replace } = makeDoc('```js\nXX\nconst x = 1\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'XX'), BACKTICKS);

		expect(deps.doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'heading']);
	});

	it('escalates past a run longer than the fence, not just an equal one', async () => {
		const { deps, replace } = makeDoc('```js\nXX\nconst x = 1\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'XX'), '`````');

		expect(serialize(deps.doc)).toBe('``````js\n`````\nconst x = 1\n``````\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	it('escalates a tilde fence with tildes', async () => {
		const { deps, replace } = makeDoc('~~~js\nXX\nbody\n~~~\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'XX'), '~~~');

		expect(serialize(deps.doc)).toBe('~~~~js\n~~~\nbody\n~~~~\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	// The rule is the block's own marker: a backtick run cannot close a tilde fence, so
	// escalating for it would rewrite bytes the grammar never reads as a terminator.
	it('leaves a tilde fence alone when the replacement is a backtick run', async () => {
		const { deps, replace } = makeDoc('~~~js\nXX\nbody\n~~~\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'XX'), BACKTICKS);

		expect(serialize(deps.doc)).toBe('~~~js\n```\nbody\n~~~\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	it('leaves a fence alone when the replacement carries no closer run', async () => {
		const { deps, replace } = makeDoc('```js\nXX\nconst x = 1\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'XX'), 'let y = `t`');

		expect(serialize(deps.doc)).toBe('```js\nlet y = `t`\nconst x = 1\n```\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	it('drops a backtick a replacement lands in a backtick fence’s info string', async () => {
		const { deps, replace } = makeDoc('```js\nbody\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'js'), 'j`s');

		expect(serialize(deps.doc)).toBe('```js\nbody\n```\n\n# Heading\n');
		expect(deps.doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'heading']);
	});

	// A tilde fence's info string may hold backticks (CommonMark §4.5), so the pass must not
	// strip what the grammar allows.
	it('keeps a backtick a replacement lands in a tilde fence’s info string', async () => {
		const { deps, replace } = makeDoc('~~~js\nbody\n~~~\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'js'), 'j`s');

		expect(serialize(deps.doc)).toBe('~~~j`s\nbody\n~~~\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	// An unclosed fence ends the document, so the bytes still converge; the rule it needs is
	// that the replacement stays INSIDE the block rather than closing it.
	it('keeps a closer run inside an unclosed fence’s body', async () => {
		const { deps, replace } = makeDoc('```js\nXX\nconst x = 1\n');

		await replace.replaceAll(scan(deps.doc, 'XX'), BACKTICKS);

		expect(deps.doc.children.map((c) => c.kind)).toEqual(['fencedCode']);
		expect(serialize(deps.doc)).toBe('````js\n```\nconst x = 1\n');
	});

	it('does not demote an unclosed backtick fence over its info string', async () => {
		const { deps, replace } = makeDoc('```js\nbody\n');

		await replace.replaceAll(scan(deps.doc, 'js'), 'j`s');

		expect(deps.doc.children.map((c) => c.kind)).toEqual(['fencedCode']);
		expect(serialize(deps.doc)).toBe('```js\nbody\n');
	});

	// The escalation adds bytes the replacement never asked for, so the undo unit has to be
	// the whole rewrite: a snapshot holding the grown opener would strand it on Ctrl+Z.
	it('leaves one undo entry whose snapshot is the pre-escalation source', async () => {
		const source = '```js\nXX\nconst x = 1\n```\n\n# Heading\n';
		const { deps, replace } = makeDoc(source);

		await replace.replaceAll(scan(deps.doc, 'XX'), BACKTICKS);

		const stack = deps.undoManager.getStacks().undo;
		expect(stack.length).toBe(1);
		expect(serialize(stack[0].snapshot)).toBe(source);
	});

	// The escalation grows the OPENER, ahead of every body match, so a caret or a match
	// offset read off the pre-replace bytes lands wrong. Search re-scans after a replace;
	// the undo entry is the one offset that survives, and it addresses the old bytes.
	it('seeds the undo caret at the pre-replace match offset', async () => {
		const { deps, replace } = makeDoc('```js\nXX\nconst x = 1\n```\n\n# Heading\n');
		const match = scan(deps.doc, 'XX')[0];

		await replace.replaceOne(match, BACKTICKS);

		const entry = deps.undoManager.getStacks().undo[0];
		expect(entry.selection.anchor.path).toEqual(match.path);
		expect(entry.selection.anchor.offset).toBe(match.start);
	});

	// The match spans the body into the closer line, so the substitution deletes a terminator
	// the metadata still claims — the block would otherwise absorb the heading on reload.
	it('restores a closer the replacement consumed', async () => {
		const { deps, replace } = makeDoc('```js\nbody\n```\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, `body\n${BACKTICKS}`), 'x');

		expect(serialize(deps.doc)).toBe('```js\nx\n```\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});

	it('is idempotent — replacing into an already-escalated fence adds no backticks', async () => {
		const { deps, replace } = makeDoc('````js\n```\nXX\n````\n\n# Heading\n');

		await replace.replaceAll(scan(deps.doc, 'XX'), 'plain');

		expect(serialize(deps.doc)).toBe('````js\n```\nplain\n````\n\n# Heading\n');
		expectParseConverged(deps.doc);
	});
});
