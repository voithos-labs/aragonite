# Feature: live mode (presentation-mode rung 4)

`presentationMode="live"` on `<Editor>` renders the document fully — every
Markdown marker hidden by root-attribute-scoped CSS, the same families reading
uses — while the surface stays editable. Its defining property is the absence of
any reveal: unlike `preview-block` and `preview-inline`, nothing un-hides when
the caret arrives, so the markers a user never sees are also the markers a
focused block never shows. The DOM keeps every marker node (offsets survive) and
reading's read-only chrome is NOT inherited: task checkboxes toggle, table grips
and drag handles stay, and links place a caret on a plain click instead of
navigating. Driven on `/test/editor` via `?presentationMode=live` and the header
"Live mode" toggle (a real click), and on `/test/plugins` — the only harness that
renders directive containers — through the `window.__test` bridge; source is
asserted through the same bridge.

## Happy paths

- entering live sets `data-presentation="live"` on the editor root; the header
  toggle enters and leaves it the same way the query param does
- inline markers (`**`), block-own prefixes (`# `), code-fence chrome, and
  reference labels (`[ref]`) hide from paint (computed `display: none`)
- directive container chrome (`:::foo`) hides too, and stays hidden with the
  caret in the container's body — driven on `/test/plugins`, the harness that
  renders plugin containers, entered through the `window.__test` bridge
- bullet items hide their `- ` and paint rendered bullet chrome instead; ordered
  ambient numbers stay visible; task checkboxes stay visible
- table grips still reveal on table hover and drag handles still reveal on block
  hover — both are reading-only removals live does not inherit

## Edge cases

- the caret inside a block reveals NOTHING — neither the focused block's markers
  (preview-block's reveal) nor the caret-touched construct's (preview-inline's)
- the marker DOM is hidden, never omitted: the hidden marker text still exists in
  the block's textContent (the coordinate-space contract)
- leaving live restores the markers to paint, and a full toggle round trip leaves
  the source byte-identical — a mode flip is a view change, never an edit

## User interactions

- typing printable characters into a paragraph: the bytes land in the source
  (live is editable, unlike reading)
- task checkbox click: the item toggles — live writes bytes, and reading's inert
  checkbox is the contrast that keeps the two rungs apart
- plain click on a link: no navigation, and the caret lands in the link's block
  instead (live edits, so a plain click places a caret)

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
