/**
 * Relocate a rendered element into a consumer-supplied host, without a second component
 * instance: the node keeps its identity, its Svelte scope classes and its place in the
 * reactive tree, so only its position in the DOM moves.
 */

/**
 * Attachment factory: appends the node to `target`, and puts it back where it was when the
 * target changes or the attachment tears down. A null target leaves the node home, which is
 * how the seam stays absent by default.
 */
export function portalInto(target: HTMLElement | null | undefined) {
	return (node: HTMLElement): (() => void) | void => {
		if (!target) return;
		// A marker holds the home position: the siblings around it can change while the node
		// is away, so a captured `nextSibling` would insert against a stale reference.
		const marker = node.ownerDocument.createComment('');
		node.parentNode?.insertBefore(marker, node);
		target.appendChild(node);
		return () => {
			// Only when the node is still ours: on unmount Svelte removes it first, and
			// re-inserting it here would strand it in the document.
			if (node.parentNode === target && marker.isConnected) marker.replaceWith(node);
			else marker.remove();
		};
	};
}
