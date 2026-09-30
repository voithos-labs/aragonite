/** A real Svelte runtime warning, so the check reads the emitter's own shape, not a copy of it. */
export function compareProxyToRaw(): boolean {
	const raw = { a: 1 };
	const holder = $state({ node: raw });
	return holder.node === raw;
}
