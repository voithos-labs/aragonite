import type { BlockComponent } from '../../block-component';
import { HAND_BUILT_MEMBERS, type HandBuiltBlock } from '../../schema/block-view';

/** G3.20: what a hand-built block answers before it publishes, so focus passes over it and no
 *  call throws. A new required member fails `npm run check` here until it has a default. */
const NOTHING_PUBLISHED = {
	focus() {},
	getCursorOffset: () => null,
	focusable: false
} satisfies HandBuiltBlock;

/** A publication's ref: the view members it has, so a caller testing for one finds only real ones,
 *  plus `editable` from the kind. Built once per publication, since the ref slot compares identity. */
export function handBuiltRef(
	block: HandBuiltBlock | null,
	editable: () => boolean
): BlockComponent {
	const ref: Record<string, unknown> = {};
	for (const key of HAND_BUILT_MEMBERS) {
		const from: HandBuiltBlock | null =
			block && key in block ? block : key in NOTHING_PUBLISHED ? NOTHING_PUBLISHED : null;
		if (!from) continue;
		const value = from[key];
		if (typeof value === 'function') ref[key] = value.bind(from);
		else Object.defineProperty(ref, key, { enumerable: true, get: () => from[key] });
	}
	Object.defineProperty(ref, 'editable', { enumerable: true, get: editable });
	return ref as unknown as BlockComponent;
}

/** Whether two publications hand over the same members, so publishing again keeps the ref. */
export function samePublication(a: HandBuiltBlock | null, b: HandBuiltBlock | null): boolean {
	if (!a || !b) return a === b;
	return HAND_BUILT_MEMBERS.every((key) => key in a === key in b && a[key] === b[key]);
}
