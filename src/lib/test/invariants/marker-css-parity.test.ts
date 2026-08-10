// @vitest-environment jsdom
//
// The CSS↔TS parity probe: the hidden-run predicate mirrors the stylesheet's class scoping by
// hand, and the branch paid for one silent mismatch. jsdom applies simple class rules, which is
// enough to prove both arms of the probe: it stands down with no stylesheet signal, and it
// names the family whose two answers diverge. Full computed-style fidelity needs a real engine;
// there the presentation e2e battery asserts it via the automatic invariant-console gate.
import { describe, it, expect, afterEach } from 'vitest';
import { checkMarkerCssParity } from '../../invariants/marker-css-parity';

function mountRoot(mode?: string): HTMLElement {
	const root = document.createElement('div');
	root.className = 'editor';
	if (mode) root.setAttribute('data-presentation', mode);
	document.body.appendChild(root);
	return root;
}

function installStyle(css: string): void {
	const style = document.createElement('style');
	style.textContent = css;
	document.head.appendChild(style);
}

afterEach(() => {
	document.head.querySelectorAll('style').forEach((el) => el.remove());
	document.body.replaceChildren();
});

describe('checkMarkerCssParity', () => {
	it('stands down when no stylesheet computes a hidden family (jsdom, source mode)', () => {
		expect(checkMarkerCssParity(mountRoot('live'))).toBeNull();
		expect(checkMarkerCssParity(mountRoot(undefined))).toBeNull();
	});

	it('names the family whose two answers diverge once a stylesheet shows signal', () => {
		// Fence lines hide (agreeing with the predicate, and proving a stylesheet is present);
		// .md-marker stays visible while the predicate hides it in live — the drift shape.
		installStyle('.md-fence-line { display: none; } .md-ref-label { display: none; }');
		const violation = checkMarkerCssParity(mountRoot('live'));
		expect(violation?.code).toBe('marker-css-parity');
		expect(violation?.message).toContain('md-marker');
	});

	it('reports agreement when the stylesheet hides what the predicate hides', () => {
		installStyle(
			'.md-marker { display: none; } .md-fence-line { display: none; } .md-ref-label { display: none; }'
		);
		// Reading hides every family with no reveal arm, so the flat rules above are exact.
		expect(checkMarkerCssParity(mountRoot('reading'))).toBeNull();
	});

	it('leaves no probe DOM behind', () => {
		const root = mountRoot('live');
		checkMarkerCssParity(root);
		expect(root.childElementCount).toBe(0);
	});
});
