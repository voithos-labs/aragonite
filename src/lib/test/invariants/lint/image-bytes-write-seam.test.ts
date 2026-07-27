/**
 * The image byte-write seam (G4.21). An inline rung may mint a built-in `image`
 * over syntax of its own — `![[cat.png|300]]` — and every read path then treats it
 * as an image, which is the point. The write paths must not: re-emitting that
 * node's fields through the GFM serializer replaces the author's bytes wholesale,
 * which is what shipped until `buildImageEditBytes` became the funnel.
 *
 * The funnel cannot be closed by unexporting the serializer — it is the GFM branch
 * and carries its own unit suite — so the rule is scanned instead: only the seam's
 * own module names it. Three write sites carried the bytes independently (the
 * commit path, the keyboard resize, the popover's dirty check) and all three
 * emitted GFM; a fourth is the shape this fails on.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';

const SEAM = 'src/lib/components/image/image-source-bytes.ts';

const GFM_SERIALIZER = /\bbuildImageSourceBytes\b/;
const SEAM_CALL = /\bbuildImageEditBytes\b/;

/**
 * Every file naming the seam in code, and why. A new name here is a new image
 * write path — welcome, but it routes through the seam by construction, so add it
 * with its reason rather than inherit the funnel by accident.
 */
const SEAM_SITES: Record<string, string> = {
	[SEAM]: 'the seam itself',
	'src/lib/components/image/image-edit-commit.ts': 'the drag-resize and popover commit',
	'src/lib/components/image/image-widget-editing.ts': 'the Shift+Arrow keyboard resize'
};

function namesInCode(sources: { relPath: string; code: string }[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('every image byte write routes through the claim-aware seam', () => {
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

	// The popover decides whether to commit by comparing bytes, so it needs the
	// seam's answer too — but it takes it as a prop rather than importing, which
	// the file-set check above cannot see.
	it('the properties popover compares the bytes a commit would write, not GFM', () => {
		const popover = sources.find(
			(f) => f.relPath === 'src/lib/components/image/ImageProperties.svelte'
		);
		expect(popover, 'ImageProperties.svelte not found').toBeDefined();
		expect(GFM_SERIALIZER.test(popover!.code)).toBe(false);
		expect(/\bbuildBytes\s*\(/.test(popover!.code)).toBe(true);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('a serializer named only in a comment cannot satisfy the scan', () => {
		expect(GFM_SERIALIZER.test('buildImageSourceBytes(fields)')).toBe(true);
		expect(GFM_SERIALIZER.test(stripComments('// buildImageSourceBytes(fields)\n'))).toBe(false);
	});
});
