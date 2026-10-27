// The view a suite registers a kind with when it isn't about the view: the editor's own text
// block, so the kind still mounts if the suite renders it.

import { textBlockView } from '#lib/plugin.js';
import type { BlockView } from '#lib/schema/block-view.js';
import type { DirectiveViews } from '#lib/core/directive/kinds.js';

export function testView(): BlockView {
	return textBlockView();
}

/** The two views `activateDirectiveGrammar` takes. */
export function testDirectiveViews(): DirectiveViews {
	return { container: testView(), leaf: testView() };
}
