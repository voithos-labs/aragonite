/**
 * Markers and the policy table stay in step (G4.35). A kind whose render marks a construct range
 * (`tagConstruct`) is `revealable` and the reverse, or it reveals nothing or marks DOM nobody
 * reads. A kind rendering any `markerSpan` hides bytes, so it needs a policy row, which is where
 * caret placement learns whether a typed byte may land between delimiters.
 */
import { describe, it, expect } from 'vitest';
import { readSource } from './scan-source';
import { SOURCE } from './source-paths';
import { listInlineConstructPolicies } from '../../../schema/inline-construct-policy';
import { registerBuiltInDescriptors } from '../../../schema/built-in-descriptors';

registerBuiltInDescriptors();

const RENDER = SOURCE.inlineRender;

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

/** The kinds whose `renderNode` branch reaches `helper`, directly or through another render helper;
 *  `excludeHelper` drops the helper's own definition, for a helper the branches call directly. */
function kindsWhoseArmReaches(helper: string, excludeHelper?: string): Set<string> {
	const token = `${helper}(`;
	const { code } = readSource(RENDER);
	const functions = topLevelFunctions(code);
	const reaching = [...functions]
		.filter(([name, body]) => name !== excludeHelper && body.includes(token))
		.map(([name]) => name);
	expect(reaching.length, `no render helper calls ${helper}: the scan has drifted`).toBeGreaterThan(
		0
	);

	const dispatch = functions.get('renderNode');
	if (!dispatch) throw new Error('stamp-revealable-parity: renderNode not found');
	const arms = [
		...dispatch.matchAll(/case\s+'([A-Za-z]+)'\s*:([\s\S]*?)(?=\n\t\tcase\s+'|\n\t\tdefault:)/g)
	];
	expect(arms.length, 'no renderNode case branches parsed: the scan has drifted').toBeGreaterThan(
		0
	);

	const kinds = new Set<string>();
	for (const [, kind, body] of arms) {
		const reaches =
			body.includes(token) || reaching.some((fn) => fn !== 'renderNode' && body.includes(`${fn}(`));
		if (reaches) kinds.add(kind);
	}
	return kinds;
}

/** The inline kinds whose render path marks a construct range on its marker spans. */
const stampedKinds = (): Set<string> => kindsWhoseArmReaches('tagConstruct');

/** The inline kinds whose render path creates a marker span, marked or not. */
const markerKinds = (): Set<string> => kindsWhoseArmReaches('markerSpan', 'markerSpan');

function rowedKinds(): Set<string> {
	return new Set(listInlineConstructPolicies().map((p) => p.kind));
}

function revealableKinds(): Set<string> {
	return new Set(
		listInlineConstructPolicies()
			.filter((p) => p.revealable)
			.map((p) => p.kind)
	);
}

describe('G4.35 mark↔revealable parity', () => {
	it('every marked construct declares revealable, and every revealable one marks', () => {
		const stamped = [...stampedKinds()].sort();
		const revealable = [...revealableKinds()].sort();
		expect(stamped).toEqual(revealable);
	});

	// The list itself, pinned: a scan that silently stopped matching would make the equality
	// above prove nothing, with both sides agreeing on an empty set.
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

	// Kinds rendering marker spans without marking a construct range hide their runs with the block
	// in preview-inline, not by caret distance, which is what `revealable: false` or no row declares.
	it('unstamped marker kinds are not revealable', () => {
		const stamped = stampedKinds();
		for (const kind of ['escape', 'hardLineBreak', 'autolink']) {
			expect(stamped.has(kind), `${kind} unexpectedly marks`).toBe(false);
			expect(revealableKinds().has(kind), `${kind} is revealable without a mark`).toBe(false);
		}
	});

	// The other direction: a list names the kinds someone knew about, and this check fails for a
	// kind nobody thought to name.
	it('every kind that creates a marker span declares a policy row', () => {
		const unrowed = [...markerKinds()].filter((kind) => !rowedKinds().has(kind)).sort();
		expect(
			unrowed,
			`marker spans with no policy row: where typing lands, the split and the join all read the ` +
				`table, so an unrowed kind is invisible to every one of them:
  ${unrowed.join('\n  ')}`
		).toEqual([]);
	});

	it('the marker census names every construct that hides bytes', () => {
		expect([...markerKinds()].sort()).toEqual([
			'autolink',
			'emphasis',
			'escape',
			'hardLineBreak',
			'image',
			'inlineCode',
			'link',
			'strikethrough',
			'strong'
		]);
	});
});
