# v7 measured — and the Markdown question has a definite answer · 2026-09-08

`82979a4f…` discarded, not kept as a fallback. v7 verified: `6b3ff140…`, 1,445,069 bytes.

You asked for one thing. It is §1. §2 is the answer to the question you could not resolve from
outside, and it changes what you should do about Global Nettech.

## 1. Tree-shaker against v7

```
v4    8 of 617 survive
v5  564 of 617 survive
v7  600 of 666 survive     (307 class + 293 ambient)
```

The classes that were bare in v5 now carry real rules:

```
.article-body   12 surviving rules      .page-hero     11
.article-hero    5                      .stats-bar      2
.article-page    1
```

The linked-stylesheet ingestion did what it was meant to.

We also ran v7 through the new `unresolvedClasses` check. It reports ten classes, `.reveal`
among them at 6 nodes, and **does not block** — the behaviour you asked for, confirmed against
your artefact rather than promised:

```
.bf-card 8 · .pillar 7 · .vertical-section 7 · .ai-card 6 · .reveal 6
.tl-item 5 · .ai-spot-card 4 · .news-panel 2 · .ehf-head 1 · .trust-partner--more 1
```

Those are the js-gated drops plus the two dead source-site classes. Reported, not fatal.

## 2. Your question: yes, and it is our defect

**The entry `body` cell is unconditionally rendered as Markdown, and the field's declared
`format` is never consulted.**

Traced end to end:

```
news table declares   body: { type: 'richText', format: 'html' }

OUTLET_BODY_BINDING = { source: 'currentEntry', field: 'body', format: 'html' }

resolveBindingValue():
  if (binding.format === 'html' && binding.field === 'body')
      return renderMarkdownToHtml(value)
```

The `format: 'html'` in that condition is the **binding's** format, not the field's. It means
"the destination wants HTML", and the code satisfies that by assuming the source is Markdown.
Nothing anywhere reads `field.format`. Your table says `html`; the renderer never asks.

So your indentation was the trigger, not the cause. Any sender whose HTML is pretty-printed
gets Markdown's indented-code-block rule applied to it, and your line-13-versus-line-14 evidence
is the rule firing exactly as written.

**This is the fifth instance of the pattern**, and the same one as `templateTarget`: a declared
field property that no code path honours. We should have found it when we found the first.

### What we are not doing yet, and why

The honest fix is that the outlet consults the entry's declared format. The renderer cannot do
that today — the entry frame is `{ id, fields }` and carries no reference to its table, so the
format is not merely unread, it is **not reachable** at the point of decision. Fixing it means
threading the field definition into the render context and touching every producer of an entry
frame.

We are not starting that on an estimate, and we are not shipping a heuristic that sniffs whether
a string "looks like HTML" — that would fail quietly on the cases that matter. It is scoped and
next; we will tell you what it is before we build it.

### For Global Nettech — do not emit the 189 yet

Your instinct to ask first was right, and the answer makes it more urgent than your note assumed.
It is not "if the answer is yes, our fix is ours forever" — it is that **every collection entry
body on this platform is Markdown-rendered today**, so all 189 posts hit it, and the 38
triggering lines in your sample batch is a floor rather than an estimate.

Two options, and we would take the second:

- Dedent the Global Nettech bodies the way v7 dedents Sheeltron's. Works now, and bakes a
  workaround for our defect into a second migration.
- Wait for the format fix. We will give you a date once it is scoped rather than now.

If the 189 are on a schedule that cannot wait, take the first and we will treat removing the
workaround as part of closing the defect.

## 3. Your §1(a) — we published a site with eight invisible sections

Recorded plainly: your v5 publish put eight blank bands on the live homepage, we deployed it,
and neither of us saw it until you read a screenshot. The rules came from `index.html`'s inline
`<style>`, so they were live from the first publish — your correction that the trap was already
sprung rather than ahead of us is right, and worth more than the original warning.

## 4. Your §4

We will not argue with it. Two fixes that each manufactured the next defect, and what caught
both was a person looking at a rendered page. Our contribution to that ledger is the two above:
a binding that ignores the format it is told, and a tree-shaker whose join nothing validated.

The `unresolvedClasses` check is the first thing either side has added that would have caught one
of them automatically. One of five.

## 5. Sequence

Nothing has been previewed, imported or published. This note is our answer to §5 and nothing
more — send authorisation per step, as before.

When the v7 import does come, expect `publishedPages` to go to 0 on the replace, exactly as last
time. That is now stated in the preview output and the tool description, so it should not
surprise anyone again.
