import { describe, it, expect, beforeEach } from 'vitest';
import { checkStaleRaw, checkOpaqueStaleRaw } from '../../invariants/node-shape';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { registerBlockOpener } from '../../schema/block-openers';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { registerOpaque } from '$lib/test/harness/opaque-kind';
import { parse } from '../../core/parser';
import { concatChildren } from '../../core/serializer';
import { trimTrailingLineEnding } from '../../core/lines';
import type { AnyBlockKind, CstNode } from '../../core/nodes';

// ── Callout-shaped opaque kind with a registered opener ────────────────────
// A chrome title child at index 0 makes `strip(raw) !== serialize(children)`, and the
// opener stores extra whitespace verbatim — a faithful but NON-canonical parse.

const OPEN = /^::note(?:[ \t]+(.*\S))?[ \t]*$/;
const CLOSE = /^::$/;

function rebuildNoteRaw(node: CstNode): void {
	const children = node.children ?? [];
	const title = trimTrailingLineEnding(children[0]?.raw ?? '');
	const inner =
		(node.innerPrefix ?? '') + concatChildren(children.slice(1)) + (node.innerSuffix ?? '');
	node.raw = `${title ? `::note ${title}` : '::note'}\n${inner}::\n`;
}

function registerNoteKind(opts: { declareChrome?: boolean } = {}): AnyBlockKind {
	const title = declarePluginKind('spec-note-title');
	registerBlockKind(title, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		contextDependentKind: true
	});
	const note = registerOpaque('spec-note', {
		rebuildRaw: rebuildNoteRaw,
		...(opts.declareChrome ? { reservedChrome: { kind: title } } : {})
	});
	registerBlockOpener(note, {
		priority: 45,
		interruptsParagraph: false,
		tryOpen(ctx) {
			const opener = ctx.line.text.match(OPEN);
			if (!opener) return null;
			let i = ctx.index + 1;
			while (i < ctx.end && !CLOSE.test(ctx.lines[i].text)) i++;
			if (i >= ctx.end) return null;
			const body = parse(
				ctx.lines
					.slice(ctx.index + 1, i)
					.map((l) => l.raw)
					.join('')
			);
			const raw = ctx.lines
				.slice(ctx.index, i + 1)
				.map((l) => l.raw)
				.join('');
			const titleChild: CstNode = {
				kind: title,
				leadingTrivia: '',
				raw: opener[1] ? `${opener[1]}\n` : '\n'
			};
			return {
				node: {
					kind: note,
					leadingTrivia: ctx.leadingTrivia,
					raw,
					innerPrefix: body.prefix,
					children: [titleChild, ...body.children],
					innerSuffix: body.suffix
				},
				consumed: i + 1 - ctx.index
			};
		}
	});
	return note;
}

function parseNote(source: string): CstNode {
	return parse(source).children[0];
}

// ── checkStaleRaw exemption ─────────────────────────────────────────────────

describe('containerContract opaque — checkStaleRaw exemption', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('exempts an opaque container whose raw is not a strip of its children', () => {
		const kind = registerOpaque('spec-opaque', { rebuildRaw: () => {} });
		// raw deliberately diverges from serialize(children) — the opaque contract.
		const node: CstNode = {
			kind,
			leadingTrivia: '',
			raw: '::title::\nbody\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		};
		expect(checkStaleRaw(node)).toBeNull();
	});
});

// ── checkOpaqueStaleRaw ─────────────────────────────────────────────────────

describe('checkOpaqueStaleRaw (opaque containers)', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	// The byte-fixpoint false-fire: a faithful parse may be non-canonical, so raw must
	// never be byte-compared against a rebuild output.
	it('passes for a faithful non-canonical parse whose rebuild would emit different bytes', () => {
		const note = registerNoteKind();
		const node = parseNote('::note  Title\nbody\n::\n');
		expect(node.kind).toBe(note);

		const probe = { ...node };
		rebuildNoteRaw(probe);
		expect(probe.raw).not.toBe(node.raw);

		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});

	it('passes after a child mutation followed by a rebuild', () => {
		registerNoteKind();
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![1].raw = 'CHANGED\n';
		rebuildNoteRaw(node);
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});

	it('fires when a body child mutated without a rebuild', () => {
		registerNoteKind();
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![1].raw = 'CHANGED\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	it('fires when the opener-line title chrome mutated without a rebuild', () => {
		registerNoteKind();
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![0].raw = 'Renamed\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	// ── Declared reservedChrome: chrome bytes live in the opener line ────────
	// A reparse mints chrome before any body trivia, while the live tree may legally hold
	// a transient blank after it — so chrome and body are compared separately.

	it('passes for a declared-chrome container holding a transient empty body paragraph', () => {
		registerNoteKind({ declareChrome: true });
		const node = parseNote('::note Title\n::\n');
		expect(node.children).toHaveLength(1);

		node.children!.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		rebuildNoteRaw(node);
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});

	it('still fires on title-chrome drift when chrome is declared', () => {
		registerNoteKind({ declareChrome: true });
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![0].raw = 'Renamed\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	it('still fires on body drift when chrome is declared', () => {
		registerNoteKind({ declareChrome: true });
		const node = parseNote('::note Title\nbody\n::\n');
		node.children![1].raw = 'CHANGED\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	// Slicing chrome off and diffing the body as a unit must still catch a child added or
	// removed without a rebuild — the count mismatch alone has to fire.
	for (const mutation of ['added', 'removed'] as const) {
		it(`fires when a body child is ${mutation} without a rebuild (chrome declared)`, () => {
			registerNoteKind({ declareChrome: true });
			const node = parseNote('::note Title\nbody\n::\n');
			if (mutation === 'added') {
				node.children!.push({ kind: 'paragraph', leadingTrivia: '', raw: 'extra\n' });
			} else {
				node.children!.pop();
			}
			expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
		});
	}

	// The bail split: with an opener registered, a raw that no longer reparses to its kind
	// is genuine drift, not the openerless can't-validate case.
	it('fires when a registered-opener kind reparses to a divergent kind', () => {
		const note = registerNoteKind();
		const node = parseNote('::note Title\nbody\n::\n');
		expect(node.kind).toBe(note);
		node.raw = 'just a paragraph now\n'; // reparses to paragraph, not note
		const violation = checkOpaqueStaleRaw(node);
		expect(violation?.code).toBe('opaque-stale-raw');
		expect(violation?.detail).toMatchObject({ reason: 'reparse-diverges' });
	});

	// Without a registered opener the raw reparses to a paragraph, so the check cannot
	// validate the kind at all — even genuinely stale children must not fire.
	it('bails for a kind whose raw does not reparse standalone (no opener)', () => {
		const kind = registerOpaque('spec-openerless', { rebuildRaw: () => {} });
		const node: CstNode = {
			kind,
			leadingTrivia: '',
			raw: '::x\nbody\n::\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'CHANGED\n' }]
		};
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});
});
