/**
 * Which document a write was made for. A block's write handles are stamped with the document it
 * mounted on, a menu's with the one it opened over, and the write gate refuses a write whose
 * document a `source` swap has replaced: a paste waiting on a slow clipboard read, or any other
 * write that outlives its document, lands nowhere.
 */

export interface DocumentStamp {
	/** False once a swap has replaced the document. */
	readonly live: boolean;
}

export interface DocumentStamps {
	/** The document in place now. */
	current(): DocumentStamp;
	/** A swap: the outgoing document's stamp dies, and the incoming one gets its own. */
	retire(): void;
	/** Run `write` as a write made for `stamp`; the gate reads it while `write` runs synchronously. */
	during<T>(stamp: DocumentStamp, write: () => T): T;
	/** The stamp of the write being made; null for one made for whatever document is in place. */
	active(): DocumentStamp | null;
}

export function createDocumentStamps(): DocumentStamps {
	let current = { live: true };
	let active: DocumentStamp | null = null;
	return {
		current: () => current,
		retire() {
			current.live = false;
			current = { live: true };
		},
		during(stamp, write) {
			const outer = active;
			active = stamp;
			try {
				return write();
			} finally {
				active = outer;
			}
		},
		active: () => active
	};
}

/** `handles` with every method run as a write made for `stamp`; any other member reads through. */
export function stampWrites<T extends object>(
	handles: T,
	stamp: DocumentStamp,
	stamps: DocumentStamps
): T {
	// Keyed on the member too, since a getter can hand back a different function on each read.
	const wrapped = new Map<PropertyKey, { member: unknown; method: unknown }>();
	return new Proxy(handles, {
		get(target, key) {
			const member = Reflect.get(target, key);
			if (typeof member !== 'function') return member;
			const hit = wrapped.get(key);
			if (hit?.member === member) return hit.method;
			const method = (...args: unknown[]) =>
				stamps.during(stamp, () => (member as (...a: unknown[]) => unknown).apply(target, args));
			wrapped.set(key, { member, method });
			return method;
		}
	});
}
