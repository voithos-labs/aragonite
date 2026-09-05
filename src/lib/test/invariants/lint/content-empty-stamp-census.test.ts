/**
 * G4.37 — walk-container↔content-empty-stamp parity. A block whose only bytes are its own chrome
 * paints nothing under a marker-hiding mode unless its surface stamps `data-content-empty`, and
 * the three stamp sites are verbatim copies with no funnel. G1.33 is the runtime belt, and only
 * when a caret parks into the shape in dev; this scan fails the day surface N+1 mounts a rendered
 * fragment into a contenteditable without the stamp.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/**
 * The surfaces mounting a rendered fragment into a contenteditable the caret walk reads. Each
 * owes the stamp; the equality below is what makes the debt structural rather than remembered.
 */
const WALK_CONTAINER_SURFACES: Record<string, string> = {
	'src/lib/components/blocks/code/CodeBlock.svelte': 'the fenced-code surface',
	'src/lib/components/blocks/table/cell-render.ts': 'the table-cell surface',
	'src/lib/components/blocks/text/text-render.ts': 'the prose surface'
};

/** Files naming a renderer whose output no caret parks in, so nothing reads a stamp back. Each
 *  says why in its own right, so moving a renderer call between files cannot silently re-open the
 *  census. */
const NON_EDITING_RENDERERS: Record<string, string> = {
	'src/lib/core/inline-render.ts': 'defines renderInlineNodes; the caller mounts the fragment',
	'src/lib/core/inline/visibility.ts':
		'renders into a detached fragment to read what paints, and mounts nothing',
	'src/lib/components/blocks/code/code-renderer.ts':
		'defines renderCodeBlock and hands the fragment back — the caller mounts it',
	'src/lib/testing/inline-conformance.ts':
		'measures the offset walk over a synthetic container the editor never mounts'
};

/** Stamp writes that are not a render surface's: the parity probe mints the attribute on a
 *  synthetic block to compare the CSS arm against the walk's. */
const SYNTHETIC_STAMPERS: Record<string, string> = {
	'src/lib/invariants/marker-css-parity.ts': 'mounts a probe block carrying the stamp'
};

const RENDERER_CALL = /(?<![\w'"])(renderInlineNodes|renderCodeBlock)\s*\(/;
const STAMP_WRITE = /\.(?:toggle|set)Attribute\(\s*CONTENT_EMPTY_ATTR\b/;

const callsRenderer = (file: SourceFile): boolean => RENDERER_CALL.test(stripComments(file.text));
const writesStamp = (file: SourceFile): boolean => STAMP_WRITE.test(stripComments(file.text));

const paths = (sources: SourceFile[], matches: (file: SourceFile) => boolean): string[] =>
	sources
		.filter(matches)
		.map((file) => file.relPath)
		.sort();

const keys = (...groups: Record<string, string>[]): string[] =>
	groups.flatMap((group) => Object.keys(group)).sort();

describe('G4.37 walk-container↔content-empty-stamp census', () => {
	const sources = collectEditorSources();

	it('the files rendering into a walk container are exactly the files stamping content-empty', () => {
		const renderingIntoWalk = paths(sources, callsRenderer).filter(
			(relPath) => !(relPath in NON_EDITING_RENDERERS)
		);
		const stamping = paths(sources, writesStamp).filter(
			(relPath) => !(relPath in SYNTHETIC_STAMPERS)
		);
		expect(
			renderingIntoWalk,
			'a surface mounting rendered chrome into a contenteditable without the content-empty ' +
				'stamp leaves a marker-only block invisible under live and preview-inline'
		).toEqual(stamping);
	});

	// Both censuses pinned: a scan that silently stopped matching would make the equality above
	// agree on the empty set.
	it('the renderer census names the mounting surfaces and the non-editing ones', () => {
		expect(paths(sources, callsRenderer)).toEqual(
			keys(WALK_CONTAINER_SURFACES, NON_EDITING_RENDERERS)
		);
	});

	it('the stamp census names the mounting surfaces and the parity probe', () => {
		expect(paths(sources, writesStamp)).toEqual(keys(WALK_CONTAINER_SURFACES, SYNTHETIC_STAMPERS));
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the renderer matcher sees both calls and skips a prose mention', () => {
		const probe = (text: string) => callsRenderer({ relPath: 'x', text, code: '' });
		expect(probe('el.replaceChildren(renderInlineNodes(content, node.raw, opts));')).toBe(true);
		expect(probe('el.replaceChildren(renderCodeBlock(node));')).toBe(true);
		expect(probe('// renderInlineNodes(…) builds the fragment\n')).toBe(false);
		expect(probe("const name = 'renderCodeBlock';")).toBe(false);
	});

	it('the stamp matcher sees both write spellings and skips the read', () => {
		const probe = (text: string) => writesStamp({ relPath: 'x', text, code: '' });
		expect(probe('el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));')).toBe(true);
		expect(probe("block.setAttribute(CONTENT_EMPTY_ATTR, '');")).toBe(true);
		expect(probe('return root.hasAttribute(CONTENT_EMPTY_ATTR);')).toBe(false);
	});
});
