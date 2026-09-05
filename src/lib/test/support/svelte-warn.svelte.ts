/** A real Svelte runtime warn, so the gate's probe reads the emitter's own shape, not a copy of it. */
export function compareProxyToRaw(): boolean {
	const raw = { a: 1 };
	const holder = $state({ node: raw });
	return holder.node === raw;
}
