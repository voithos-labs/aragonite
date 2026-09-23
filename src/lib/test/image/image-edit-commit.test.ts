// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { CstNode } from '../../core/nodes';
import { committerFor } from './committer-harness';

describe('image edit commit: a commit that changes nothing', () => {
	// As when the popover is dismissed after a resize already saved the change.
	it('does not commit when the new image bytes equal the current source', async () => {
		const { committer, controller, doc, target, seen } = committerFor('![alt](url)\n');
		committer.commitImageEdit(target, seen, seen);
		await Promise.resolve();

		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect((doc.children[0] as CstNode).raw).toBe('![alt](url)\n');
	});
});

// Miss-analysis: every commit test ran against the document the popover opened on, so none put
// another image at the target's bytes, as a source swap does.
describe('image edit commit: a draft whose image is gone', () => {
	it('writes nothing over another image now at the same bytes', async () => {
		const { committer, controller, doc, target } = committerFor('![two](url)\n');
		committer.commitImageEdit(target, { alt: 'one', url: 'url' }, { alt: 'draft', url: 'url' });
		await Promise.resolve();

		expect(controller.commitStructural).not.toHaveBeenCalled();
		expect((doc.children[0] as CstNode).raw).toBe('![two](url)\n');
	});

	it('writes the draft while the image still reads as the popover last showed it', async () => {
		const { committer, controller, target } = committerFor('![one](url)\n');
		committer.commitImageEdit(target, { alt: 'one', url: 'url' }, { alt: 'draft', url: 'url' });
		await Promise.resolve();

		expect(controller.commitStructural).toHaveBeenCalled();
	});
});
