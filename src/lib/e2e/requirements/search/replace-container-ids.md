# Feature: Replace All keeps nested containers intact

Replace All rewrites whole subtrees at once. When the needle sits inside
nested lists, the rebuilt containers must stay renderable: when the refreshed
containers cannot key their children, a list item with more than one child
crashes with "block failed to render".

## Happy paths

- Replace All on a word that appears throughout the default demo document's
  nested lists rewrites every occurrence and leaves the document healthy: no
  block fails to render, no errors fire, every nested container still tracks
  its children, and the result round-trips stably.
