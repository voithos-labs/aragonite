// Shared building blocks for the README chart renderers (render-perf-chart,
// render-loc-chart): the dataviz base palette, the SVG entity escaper, and the
// `<text>` element builder. Each renderer spreads its chart-specific colors over
// the base theme, so a palette change lands in one place instead of drifting the
// two chart pairs apart.

const FONT = 'system-ui, sans-serif';

// Base theme tokens common to both charts. Renderers extend these per mode with
// their own series colors (perf: axis/bundle/accent, loc: bar).
export const THEMES = {
	light: {
		surface: '#fcfcfb',
		inkPrimary: '#0b0b0b',
		inkSecondary: '#52514e',
		muted: '#898781',
		grid: '#e1e0d9'
	},
	dark: {
		surface: '#1a1a19',
		inkPrimary: '#ffffff',
		inkSecondary: '#c3c2b7',
		muted: '#898781',
		grid: '#2c2c2a'
	}
};

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Returns a `text(x, y, s, opts)` helper bound to a theme's default ink; each call
// appends one `<text>` element to `sink`.
export function textBuilder(theme, sink) {
	return (
		x,
		y,
		s,
		{ size = 12.5, fill = theme.inkSecondary, weight = 400, anchor = 'start', extra = '' } = {}
	) =>
		sink.push(
			`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${esc(s)}</text>`
		);
}
