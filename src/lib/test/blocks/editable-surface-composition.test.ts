// @vitest-environment jsdom
//
// G1.27 fired through the real surface skeleton: an unpaired compositionend
// reaches devWarn on `invariant:composition-window`; a paired start→end cycle
// stays silent and commits exactly once (the IME contract the per-keystroke
// bail defends).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import {
	createEditableSurface,
	type EditableSurfaceDeps
} from '$lib/components/blocks/editable-surface';

function makeSurface() {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	document.body.appendChild(el);

	let composing = false;
	let preEditOffset = 0;
	const commits: Array<{ text: string; preEdit: number; saved: number }> = [];

	const deps = {
		getEl: () => el,
		getAmbientLength: () => 0,
		backend: { getRaw: () => null, setRaw: () => {}, buildRange: () => null },
		getMyPath: () => [0],
		getIndex: () => 0,
		getComposing: () => composing,
		setComposing: (value: boolean) => {
			composing = value;
		},
		getPreEditOffset: () => preEditOffset,
		setPreEditOffset: (offset: number) => {
			preEditOffset = offset;
		},
		setPendingCursor: () => {},
		// The composition path touches only these two context reads; the rest of the
		// cross-block wiring is constructed but never invoked here.
		selection: { isCrossBlock: false },
		stickyColumn: { reset: () => {} },
		focusActions: { revealPath: async () => null },
		getDoc: () => null,
		getBlockElByPath: () => null,
		getEditorRoot: () => null,
		getEditorLifetime: () => null,
		containerEdit: {},
		blockEdit: {},
		controller: {},
		history: {},
		pluginEditor: undefined,
		onCommandError: undefined,
		getKeybindingOverrides: () => ({}),
		pasteCoordinator: {},
		getFocusOffset: () => null,
		getTextLen: () => 0,
		readText: () => 'abc',
		commitInput: (text: string, preEdit: number, saved: number) => {
			commits.push({ text, preEdit, saved });
		}
	} as unknown as EditableSurfaceDeps;

	return { surface: createEditableSurface(deps), commits };
}

function compositionFires(): unknown[][] {
	return vi.mocked(devWarn).mock.calls.filter(([tag]) => tag === 'invariant:composition-window');
}

beforeEach(() => {
	vi.stubEnv('DEV', true);
	vi.mocked(devWarn).mockClear();
});
afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllEnvs();
});

describe('editable surface — composition window (G1.27)', () => {
	it('compositionend with no open composition fires', () => {
		const { surface } = makeSurface();
		surface.onCompositionEnd();
		expect(compositionFires()).toHaveLength(1);
		expect(compositionFires()[0][2]).toBe('end-without-start');
	});

	it('a paired start → end cycle stays silent and commits exactly once', () => {
		const { surface, commits } = makeSurface();
		surface.onCompositionStart();
		surface.onCompositionEnd();
		expect(devWarn).not.toHaveBeenCalled();
		expect(commits).toEqual([{ text: 'abc', preEdit: 0, saved: 0 }]);
	});
});
