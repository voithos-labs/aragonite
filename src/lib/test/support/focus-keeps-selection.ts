// Vitest setup: jsdom moves the selection to an editing host's start whenever it takes focus, where
// Chromium keeps a selection already inside it. A restored caret is written before its block takes
// focus, so it reads back only under Chromium's rule.

if (typeof HTMLElement !== 'undefined') {
	const focus = HTMLElement.prototype.focus;
	HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
		const sel = window.getSelection();
		const held =
			sel && sel.rangeCount > 0 && this.contains(sel.anchorNode) && this.contains(sel.focusNode)
				? ([sel.anchorNode!, sel.anchorOffset, sel.focusNode!, sel.focusOffset] as const)
				: null;
		focus.call(this, options);
		if (held) sel!.setBaseAndExtent(...held);
	};
}
