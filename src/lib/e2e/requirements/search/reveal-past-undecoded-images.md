# Feature: Search reveal stays on target past undecoded images

Navigating search to an off-window match that sits below a band of unsized,
still-decoding images must bring the match into view and keep it there. The
images reserve no height until they decode, so the document shrinks under the
scroll; unless the target block is held in place, the browser clamps the
viewport up onto a higher block and strands the match off-screen.

## Happy paths

- On the harness's showcase document, with its photos held undecoded, a query
  with many matches (`list`, 11 of them) opens on the first; clicking the
  Previous-match button wraps to the last, far below the tables and the undecoded
  images, and its active highlight paints and stays in view while the photos the
  scroll passed are still undecoded.
