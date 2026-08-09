/**
 * The link byte-write seam (G4.34), the image seam's twin (G4.21). An inline rung may mint a
 * built-in `link` over syntax of its own, which read paths treat as a link and write paths must
 * not: re-emitting its fields as GFM replaces the author's bytes wholesale. The serializer is
 * module-private, so the scan pins the CALLERS — the shape that lets a second write path appear.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';

const SEAM = 'src/lib/components/blocks/text/link-source-bytes.ts';

const GFM_SERIALIZER = /\bbuildLinkSourceBytes\b/;
const SEAM_CALL = /\bbuildLink(?:Edit|Unwrap)Bytes\b/;

/**
 * Every file naming the seam in code, and why. A new name is a new link write path: add it with
 * its reason rather than inherit the funnel by accident.
 */
const SEAM_SITES: Record<string, string> = {
	[SEAM]: 'the seam itself',
	'src/lib/components/link-card/link-card-commit.ts': 'the card’s url commit and its remove-link'
};

function namesInCode(sources: { relPath: string; code: string }[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('every link byte write routes through the claim-aware seam', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('the GFM serializer is named only inside the seam', () => {
		expect(namesInCode(sources, GFM_SERIALIZER)).toEqual([SEAM]);
	});

	it('exactly the documented write paths call the seam', () => {
		expect(namesInCode(sources, SEAM_CALL)).toEqual(Object.keys(SEAM_SITES).sort());
	});

	// The card compares the seam's answer to decide whether Enter has anything to write, and takes
	// it as a prop rather than by import — which the file-set check above cannot see.
	it('the card component decides nothing about link bytes itself', () => {
		const card = sources.find((f) => f.relPath === 'src/lib/components/link-card/LinkCard.svelte');
		expect(card, 'LinkCard.svelte not found').toBeDefined();
		expect(GFM_SERIALIZER.test(card!.code)).toBe(false);
		expect(SEAM_CALL.test(card!.code)).toBe(false);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('a serializer named only in a comment cannot satisfy the scan', () => {
		expect(GFM_SERIALIZER.test('buildLinkSourceBytes(fields)')).toBe(true);
		expect(GFM_SERIALIZER.test(stripComments('// buildLinkSourceBytes(fields)\n'))).toBe(false);
	});

	it('the seam matcher catches both doors, not just the edit', () => {
		expect(SEAM_CALL.test('buildLinkEditBytes(link, display, fields)')).toBe(true);
		expect(SEAM_CALL.test('buildLinkUnwrapBytes(link, display)')).toBe(true);
		expect(SEAM_CALL.test('buildImageEditBytes(image, raw, fields)')).toBe(false);
	});
});
