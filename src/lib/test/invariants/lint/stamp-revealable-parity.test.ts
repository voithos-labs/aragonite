/**
 * G4.35 — stamp↔revealable parity. `tagConstruct` is what makes a marker span addressable by
 * preview-inline's reveal trigger, and `revealable` is what permits the flip; a kind that has
 * one without the other either reveals nothing the user can see or stamps DOM nobody reads.
 * The census is derived from `inline-render.ts` itself — which render helper stamps, and which
 * `renderNode` case reaches it — so a new construct joins the lint by existing.
 */
import { describe, it, expect } from 'vitest';
import { readEditorFile } from './scan-source';
import { listInlineConstructPolicies } from '../../../schema/inline-construct-policy';
import { registerBuiltInDescriptors } from '../../../schema/built-in-descriptors';

registerBuiltInDescriptors();

const RENDER = 'core/inline-render.ts';

/** Top-level `function name(…) {…}` bodies, split at column-0 `function` starts. */
function topLevelFunctions(code: string): Map<string, string> {
	const out = new Map<string, string>();
	const starts = [...code.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)];
	starts.forEach((match, i) => {
		const from = match.index!;
		const to = i + 1 < starts.length ? starts[i + 1].index! : code.length;
		out.set(match[1], code.slice(from, to));
	});
	return out;
}

/** The inline kinds whose render path stamps a construct range on its marker spans. */
function stampedKinds(): Set<string> {
	const { code } = readEditorFile(RENDER);
	const functions = topLevelFunctions(code);
	const stamping = [...functions]
		.filter(([, body]) => body.includes('tagConstruct('))
		.map(([n]) => n);
	expect(
		stamping.length,
		'no render helper calls tagConstruct — the scan has drifted'
	).toBeGreaterThan(0);

	const dispatch = functions.get('renderNode');
	if (!dispatch) throw new Error('stamp-revealable-parity: renderNode not found');
	const arms = [
		...dispatch.matchAll(/case\s+'([A-Za-z]+)'\s*:([\s\S]*?)(?=\n\t\tcase\s+'|\n\t\tdefault:)/g)
	];
	expect(arms.length, 'no renderNode case arms parsed — the scan has drifted').toBeGreaterThan(0);

	const kinds = new Set<string>();
	for (const [, kind, body] of arms) {
		// `tagConstruct` reached through a helper OR called in the arm itself; either stamps.
		const reaches =
			body.includes('tagConstruct(') ||
			stamping.some((fn) => fn !== 'renderNode' && body.includes(`${fn}(`));
		if (reaches) kinds.add(kind);
	}
	return kinds;
}

function revealableKinds(): Set<string> {
	return new Set(
		listInlineConstructPolicies()
			.filter((p) => p.revealable)
			.map((p) => p.kind)
	);
}

describe('G4.35 stamp↔revealable parity', () => {
	it('every stamped construct declares revealable, and every revealable one stamps', () => {
		const stamped = [...stampedKinds()].sort();
		const revealable = [...revealableKinds()].sort();
		expect(stamped).toEqual(revealable);
	});

	// The census itself, pinned: a scan that silently stopped matching would make the
	// equality above vacuous, and both sides would agree on nothing.
	it('the census names the constructs whose markers the reveal addresses', () => {
		expect([...stampedKinds()].sort()).toEqual([
			'emphasis',
			'image',
			'inlineCode',
			'link',
			'strikethrough',
			'strong'
		]);
	});

	// The counter-census: kinds that render marker spans WITHOUT a stamp. Their runs hide with
	// the block in preview-inline rather than by construct proximity, which is the whole
	// difference `revealable: false` (or no row at all) declares.
	it('unstamped marker kinds are not revealable', () => {
		const stamped = stampedKinds();
		for (const kind of ['escape', 'hardLineBreak', 'autolink']) {
			expect(stamped.has(kind), `${kind} unexpectedly stamps`).toBe(false);
			expect(revealableKinds().has(kind), `${kind} is revealable without a stamp`).toBe(false);
		}
	});
});
