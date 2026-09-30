# Feature: live mode (the fifth presentation mode)

`presentationMode="live"` on `<Editor>` renders the document fully, with every
Markdown marker hidden by CSS scoped to an attribute on the root, the same
families reading uses, while the document stays editable. Its defining property is
that nothing is ever shown again: unlike `preview-block` and `preview-inline`, no
marker un-hides when the caret arrives, so the markers a user never sees are also
the markers a focused block never shows. The DOM keeps every marker node (offsets
survive) and reading's read-only restrictions are not inherited: task checkboxes
toggle, block drag handles stay, and links place a caret on a plain click instead
of navigating. Driven on `/test/editor` via `?presentationMode=live` and the header
"Live mode" toggle (a real click), and on `/test/plugins`, the only harness that
renders directive containers, through the `window.__test` bridge; source is
asserted through the same bridge.

## Happy paths

- entering live sets `data-presentation="live"` on the editor root; the header
  toggle enters and leaves it the same way the query param does
- inline markers (`**`), block-own prefixes (`# `), code-fence lines, and
  reference labels (`[ref]`) hide from paint (computed `display: none`)
- a directive container's own fences (`:::foo`) hide too, and stay hidden with the
  caret in the container's body. Driven on `/test/plugins`, the harness that
  renders plugin containers, entered through the `window.__test` bridge
- an angle autolink (`<https://…>`) hides its `<`/`>` and renders the bare url:
  the brackets are construct syntax, so they are marker spans like any other
- bullet items hide their `- ` and paint a rendered bullet instead; an ordered
  list's numbers stay visible; task checkboxes stay visible
- a block drag handle (the table's, the only affordance a table has left now that
  the row and column handles are gone) still appears on block hover, a removal
  reading makes and live does not inherit

## Edge cases

- the caret inside a block shows nothing: neither the focused block's markers
  (what preview-block shows) nor those of the construct the caret touches (what
  preview-inline shows)
- the marker DOM is hidden, never omitted: the hidden marker text still exists in
  the block's textContent (the coordinate-space contract)
- leaving live restores the markers to paint, and a full toggle round trip leaves
  the source byte-identical: a mode switch is a view change, never an edit

## User interactions

- typing printable characters into a paragraph: the bytes land in the source
  (live is editable, unlike reading)
- task checkbox click: the item toggles, because live writes bytes, and reading's
  inert checkbox is the contrast that keeps the two modes apart
- plain click on a link: no navigation, and the caret lands in the link's block
  instead (live edits, so a plain click places a caret)

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
