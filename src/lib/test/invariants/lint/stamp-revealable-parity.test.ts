/**
 * G4.35: markers and the policy table stay in step, in two parts. First, `tagConstruct` makes a
 * marker span reachable by preview-inline's reveal and `revealable` permits it, so a kind with one
 * and not the other either reveals nothing or marks DOM nobody reads. Second, a kind that renders
 * a `markerSpan` at all hides bytes, so it needs a row in the policy table, which is where the
 * code deciding a typed byte's position learns whether it may land between delimiters. The second
 * part catches a kind shipping hideable delimiters with no row on the day it lands.
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

/**
 * The kinds whose `renderNode` branch reaches `helper`, called in the branch itself or through
 * another top-level render helper that calls it. `excludeHelper` drops the helper's own definition
 * from that set, for a helper the branches also call directly.
 */
function kindsWhoseArmReaches(helper: string, excludeHelper?: string): Set<string> {
	const token = `${helper}(`;
	const { code } = readEditorFile(RENDER);
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

describe('G4.35 stamp↔revealable parity', () => {
	it('every stamped construct declares revealable, and every revealable one stamps', () => {
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

	// The other list: kinds that render marker spans without marking a construct range. Their runs
	// hide with the block in preview-inline rather than by how close the caret is, which is the
	// whole difference `revealable: false` (or no row at all) declares.
	it('unstamped marker kinds are not revealable', () => {
		const stamped = stampedKinds();
		for (const kind of ['escape', 'hardLineBreak', 'autolink']) {
			expect(stamped.has(kind), `${kind} unexpectedly marks`).toBe(false);
			expect(revealableKinds().has(kind), `${kind} is revealable without a mark`).toBe(false);
		}
	});

	// The other direction. A list names the kinds someone knew about; this one fails for a kind
	// nobody thought to name, which is the shape that shipped before.
	it('every kind that mints a marker span declares a policy row', () => {
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
