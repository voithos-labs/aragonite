<!-- ParrotBlock.svelte -->
<script lang="ts">
	import { createEditableLeaf, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();
	let sourceEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'render-primary',
		singleLine: true,
		isRevealed: () => revealed,
		setRevealed: (next) => (revealed = next)
	});

	// The canonical ten, via terminal-parrot (MIT).
	const FRAMES = [
		String.raw`
                         .cccc;;cc;';c.
                      .,:dkdc:;;:c:,:d:.
                     .loc'.,cc::c:::,..;:.
                   .cl;....;dkdccc::,...c;
                  .c:,';:'..ckc',;::;....;c.
                .c:'.,dkkoc:ok:;llllc,,c,';:.
               .;c,';okkkkkkkk:;lllll,:kd;.;:,.
               co..:kkkkkkkkkk:;llllc':kkc..oNc
             .cl;.,oxkkkkkkkkkc,:cll;,okkc'.cO;
             ;k:..ckkkkkkkkkkkl..,;,.;xkko:',l'
            .,...';dkkkkkkkkkkd;.....ckkkl'.cO;
         .,,:,.;oo:ckkkkkkkkkkkdoc;;cdkkkc..cd,
      .cclo;,ccdkkl;llccdkkkkkkkkkkkkkkkd,.c;
     .lol:;;okkkkkxooc::coodkkkkkkkkkkkko'.oc
   .c:'..lkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkd,.oc
  .lo;,:cdkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkd,.c;
,dx:..;lllllllllllllllllllllllllllllllllc'...
cNO;........................................
`,
		String.raw`
                .ckx;'........':c.
             .,:c:::::oxxocoo::::,',.
            .odc'..:lkkoolllllo;..;d,
            ;c..:o:..;:..',;'.......;.
           ,c..:0Xx::o:.,cllc:,'::,.,c.
           ;c;lkXKXXXXl.;lllll;lKXOo;':c.
         ,dc.oXXXXXXXXl.,lllll;lXXXXx,c0:
         ;Oc.oXXXXXXXXo.':ll:;'oXXXXO;,l'
         'l;;kXXXXXXXXd'.'::'..dXXXXO;,l'
         'l;:0XXXXXXXX0x:...,:o0XXXXx,:x,
         'l;;kXXXXXXXXXKkol;oXXXXXXXO;oNc
        ,c'..ckk0XXXXXXXXXX00XXXXXXX0:;o:.
      .':;..:do::ooookXXXXXXXXXXXXXXXo..c;
    .',',:co0XX0kkkxxOXXXXXXXXXXXXXXXOc..;l.
  .:;'..oXXXXXXXXXXXXXXXXXXXXXXXXXXXXXko;';:.
.ldc..:oOXKXXXXXXKXXKXXXXXXXXXXXXXXXXXXXo..oc
:0o...:dxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxo,.:,
cNo........................................;'
`,
		String.raw`
            .cc;.  ...  .;c.
         .,,cc:cc:lxxxl:ccc:;,.
        .lo;...lKKklllookl..cO;
      .cl;.,:'.okl;..''.;,..';:.
     .:o;;dkd,.ll..,cc::,..,'.;:,.
     co..lKKKkokl.':lloo;''ol..;dl.
   .,c;.,xKKKKKKo.':llll;.'oOxl,.cl,.
   cNo..lKKKKKKKo'';llll;;okKKKl..oNc
   cNo..lKKKKKKKko;':c:,'lKKKKKo'.oNc
   cNo..lKKKKKKKKKl.....'dKKKKKxc,l0:
   .c:'.lKKKKKKKKKk;....lKKKKKKo'.oNc
     ,:.'oxOKKKKKKKOxxxxOKKKKKKxc,;ol:.
     ;c..'':oookKKKKKKKKKKKKKKKKKk:.'clc.
   ,xl'.,oxo;'';oxOKKKKKKKKKKKKKKKOxxl:::;,.
  .dOc..lKKKkoooookKKKKKKKKKKKKKKKKKKKxl,;ol.
  cx,';okKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKl..;lc.
  co..:dddddddddddddddddddddddddddddddddl::',::.
  co...........................................
`,
		String.raw`
           .ccccccc.
      .,,,;cooolccoo;;,,.
     .dOx;..;lllll;..;xOd.
   .cdo;',loOXXXXXkll;';odc.
  ,ol:;c,':oko:cccccc,...ckl.
  ;c.;kXo..::..;c::'.......oc
,dc..oXX0kk0o.':lll;..cxxc.,ld,
kNo.'oXXXXXXo',:lll;..oXXOo;cOd.
KOc;oOXXXXXXo.':lol;..dXXXXl';xc
Ol,:k0XXXXXX0c.,clc'.:0XXXXx,.oc
KOc;dOXXXXXXXl..';'..lXXXXXo..oc
dNo..oXXXXXXXOx:..'lxOXXXXXk,.:; ..
cNo..lXXXXXXXXXOolkXXXXXXXXXkl,..;:';.
.,;'.,dkkkkk0XXXXXXXXXXXXXXXXXOxxl;,;,;l:.
  ;c.;:''''':doOXXXXXXXXXXXXXXXXXXOdo;';clc.
  ;c.lOdood:'''oXXXXXXXXXXXXXXXXXXXXXk,..;ol.
  ';.:xxxxxocccoxxxxxxxxxxxxxxxxxxxxxxl::'.';;.
  ';........................................;l'
`,
		String.raw`

        .;:;;,.,;;::,.
     .;':;........'co:.
   .clc;'':cllllc::,.':c.
  .lo;;o:coxdllllllc;''::,,.
.c:'.,cl,.'l:',,;;'......cO;
do;';oxoc;:l;;llllc'.';;'.,;.
c..ckkkkkkkd,;llllc'.:kkd;.':c.
'.,okkkkkkkkc;lllll,.:kkkdl,cO;
..;xkkkkkkkkc,ccll:,;okkkkk:,co,
..,dkkkkkkkkc..,;,'ckkkkkkkc;ll.
..'okkkkkkkko,....'okkkkkkkc,:c.
c..ckkkkkkkkkdl;,:okkkkkkkkd,.',';.
d..':lxkkkkkkkkxxkkkkkkkkkkkdoc;,;'..'.,.
o...'';llllldkkkkkkkkkkkkkkkkkkdll;..'cdo.
o..,l;'''''';dkkkkkkkkkkkkkkkkkkkkdlc,..;lc.
o..;lc;;;;;;,,;clllllllllllllllllllllc'..,:c.
o..........................................;'
`,
		String.raw`

           .,,,,,,,,,.
         .ckKxodooxOOdcc.
      .cclooc'....';;cool.
     .loc;;;;clllllc;;;;;:;,.
   .c:'.,okd;;cdo:::::cl,..oc
  .:o;';okkx;';;,';::;'....,:,.
  co..ckkkkkddkc,cclll;.,c:,:o:.
  co..ckkkkkkkk:,cllll;.:kkd,.':c.
.,:;.,okkkkkkkk:,cclll;.ckkkdl;;o:.
cNo..ckkkkkkkkko,.;loc,.ckkkkkc..oc
,dd;.:kkkkkkkkkx;..;:,.'lkkkkko,.:,
  ;:.ckkkkkkkkkkc.....;ldkkkkkk:.,'
,dc..'okkkkkkkkkxoc;;cxkkkkkkkkc..,;,.
kNo..':lllllldkkkkkkkkkkkkkkkkkdcc,.;l.
KOc,c;''''''';lldkkkkkkkkkkkkkkkkkc..;lc.
xx:':;;;;,.,,...,;;cllllllllllllllc;'.;od,
cNo.....................................oc
`,
		String.raw`


                   .ccccccc.
               .ccckNKOOOOkdcc.
            .;;cc:ccccccc:,:c::,,.
         .c;:;.,cccllxOOOxlllc,;ol.
        .lkc,coxo:;oOOxooooooo;..:,
      .cdc.,dOOOc..cOd,.',,;'....':l.
      cNx'.lOOOOxlldOc..;lll;.....cO;
     ,do;,:dOOOOOOOOOl'':lll;..:d:''c,
     co..lOOOOOOOOOOOl'':lll;.'lOd,.cd.
     co.'dOOOOOOOOOOOo,.;llc,.,dOOc..dc
     co..lOOOOOOOOOOOOc.';:,..cOOOl..oc
   .,:;.'::lxOOOOOOOOOo:'...,:oOOOc.'dc
   ;Oc..cl'':lldOOOOOOOOdcclxOOOOx,.cd.
  .:;';lxl''''':lldOOOOOOOOOOOOOOc..oc
,dl,.'cooc:::,....,::coooooooooooc'.c:
cNo.................................oc
`,
		String.raw`



                        .cccccccc.
                  .,,,;;cc:cccccc:;;,.
                .cdxo;..,::cccc::,..;l.
               ,do:,,:c:coxxdllll:;,';:,.
             .cl;.,oxxc'.,cc,.';;;'...oNc
             ;Oc..cxxxc'.,c;..;lll;...cO;
           .;;',:ldxxxdoldxc..;lll:'...'c,
           ;c..cxxxxkxxkxxxc'.;lll:'','.cdc.
         .c;.;odxxxxxxxxxxxd;.,cll;.,l:.'dNc
        .:,''ccoxkxxkxxxxxxx:..,:;'.:xc..oNc
      .lc,.'lc':dxxxkxxxxxxxol,...',lx:..dNc
     .:,',coxoc;;ccccoxxxxxxxxo:::oxxo,.cdc.
  .;':;.'oxxxxxc''''';cccoxxxxxxxxxxxc..oc
,do:'..,:llllll:;;;;;;,..,;:lllllllll;..oc
cNo.....................................oc
`,
		String.raw`


                              .ccccc.
                         .cc;'coooxkl;.
                     .:c:::c:,,,,,;c;;,.'.
                   .clc,',:,..:xxocc;'..c;
                  .c:,';:ox:..:c,,,,,,...cd,
                .c:'.,oxxxxl::l:.,loll;..;ol.
                ;Oc..:xxxxxxxxx:.,llll,....oc
             .,;,',:loxxxxxxxxx:.,llll;.,,.'ld,
            .lo;..:xxxxxxxxxxxx:.'cllc,.:l:'cO;
           .:;...'cxxxxxxxxxxxxoc;,::,..cdl;;l'
         .cl;':,'';oxxxxxxdxxxxxx:....,cooc,cO;
     .,,,::;,lxoc:,,:lxxxxxxxxxxxo:,,;lxxl;'oNc
   .cdxo;':lxxxxxxc'';cccccoxxxxxxxxxxxxo,.;lc.
  .loc'.'lxxxxxxxxocc;''''';ccoxxxxxxxxx:..oc
olc,..',:cccccccccccc:;;;;;;;;:ccccccccc,.'c,
Ol;......................................;l'
`,
		String.raw`

                              ,ddoodd,
                         .cc' ,ooccoo,'cc.
                      .ccldo;...',,...;oxdc.
                   .,,:cc;.,'..;lol;;,'..lkl.
                  .dOc';:ccl;..;dl,.''.....oc
                .,lc',cdddddlccld;.,;c::'..,cc:.
                cNo..:ddddddddddd;':clll;,c,';xc
               .lo;,clddddddddddd;':clll;:kc..;'
             .,c;..:ddddddddddddd:';clll,;ll,..
             ;Oc..';:ldddddddddddl,.,c:;';dd;..
           .''',:c:,'cdddddddddddo:,''..'cdd;..
         .cdc';lddd:';lddddddddddddd;.';lddl,..
      .,;::;,cdddddol;;lllllodddddddlcldddd:.'l;
     .dOc..,lddddddddlcc:;'';cclddddddddddd;;ll.
   .coc,;::ldddddddddddddlcccc:ldddddddddl:,cO;
,xl::,..,cccccccccccccccccccccccccccccccc:;':xx,
cNd.........................................;lOc
`
	];
	// One strip the CSS scrolls a frame at a time. The closing newline is load-bearing: a `pre`
	// drops a trailing blank line, and a strip a row short steps a fraction off every frame.
	const REEL = FRAMES.join('\n') + '\n';
	// The clip window's height, which is why every frame has to be the same number of rows.
	const FRAME_ROWS = FRAMES[0].split('\n').length;

	const caption = $derived(node.raw.slice('%%parrot'.length).trim());

	export const editable = true;
	export const focusable = true;
	export const focus = leaf.focus;
	export const getCursorOffset = leaf.getCursorOffset;
	export const parkCaret = leaf.parkCaret;
	export const focusAtColumn = leaf.focusAtColumn;
	export const getSelectedText = leaf.getSelectedText;
	export const setSelection = leaf.setSelection;
	export const measurePartialRects = leaf.measurePartialRects;
	export const runCommand = leaf.runCommand;
	export const insertMarkdown = leaf.insertMarkdown;
</script>

<div
	class="parrot-block"
	{...leaf.renderProps}
	style:--parrot-rows={FRAME_ROWS}
	style:--parrot-frames={FRAMES.length}
>
	<div class="parrot" aria-hidden="true"><pre class="parrot-reel">{REEL}</pre></div>
	{#if revealed}
		<div
			bind:this={sourceEl}
			{...leaf.surfaceProps}
			class="parrot-source"
			aria-label="Party parrot source"
		></div>
	{:else}
		<div
			class="parrot-caption"
			role="button"
			tabindex="-1"
			aria-label="Party parrot caption (click to edit)"
		>
			{caption}
		</div>
	{/if}
</div>

<style>
	.parrot {
		/* a terminal cell is about twice as tall as it is wide; prose line-height stretches the bird */
		font-size: 1.1em;
		line-height: 1.1;
		letter-spacing: 0.05em;
		/* one frame tall, in the reel's own rows so a step lands on the next frame exactly */
		height: calc(var(--parrot-rows) * 1lh);
		/* wider than a phone column, and the editor root pans if it isn't contained; the bar
		   would sit across the bird, which is decoration rather than a pane to scroll */
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		/* chrome, not content: every frame is in the DOM and none of them belong in a copy */
		user-select: none;
		animation: parrot-hue 0.49s step-end infinite;
	}
	.parrot-reel {
		/* type and rhythm come from the box above, so its `lh` is this reel's row exactly */
		margin: 0;
		animation-name: parrot-reel;
		animation-duration: calc(var(--parrot-frames) * 70ms);
		animation-timing-function: steps(var(--parrot-frames));
		animation-iteration-count: infinite;
	}
	@keyframes parrot-reel {
		to {
			transform: translateY(-100%);
		}
	}
	/* parrot.live's seven, stepped rather than blended so every run of the dance looks the same */
	@keyframes parrot-hue {
		0% {
			color: #ff5f5f;
		}
		14.286% {
			color: #ffc83d;
		}
		28.571% {
			color: #3fd97a;
		}
		42.857% {
			color: #5aa9ff;
		}
		57.143% {
			color: #ff6ad5;
		}
		71.429% {
			color: #3fd3d3;
		}
		85.714% {
			color: var(--color-text-primary, currentColor);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.parrot,
		.parrot-reel {
			animation: none;
		}
	}
	.parrot-caption {
		margin: 0.25em 0 0;
		font-weight: 700;
		cursor: text;
	}
	.parrot-source {
		/* the bytes, dimmed the way the editor dims a marker */
		opacity: 0.55;
		font-family: monospace;
		font-size: 0.9em;
		outline: none;
	}
</style>
