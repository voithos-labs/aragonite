// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getInlineContent } from '../../core/inline/inline-cache';
import type { CstNode } from '../../core/nodes';
import { committerFor } from './committer-harness';

describe('image edit commit — redundant-commit guard (E1)', () => {
	it('does not commit when the new image bytes equal the current source', async () => {
		const { committer, controller, doc } = committerFor('![alt](url)\n');
		const para = doc.children[0] as CstNode;
		const image = getInlineContent(para).find((n) => n.kind === 'image')!;

		// Commit the image's existing fields back, which produces the same raw bytes.
		// (The same as dismissing the popover after a resize already saved the change.)
		committer.commitImageEdit(
			{ paragraphPath: [0], sourceStart: image.start, preSelectOffset: 0 },
			{ alt: image.alt ?? '', url: image.url ?? '' }
		);
		await Promise.resolve();

		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect(para.raw).toBe('![alt](url)\n');
	});
});
