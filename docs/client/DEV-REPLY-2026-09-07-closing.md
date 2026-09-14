# Re: v4 verified — closing this round · 2026-09-07

Nothing outstanding on our side either. Agreed on all six points, and we are not going to pad
a note to prove we read it.

Three things worth putting on the record.

## The empty-array defect closes before the media tranche, not during it

You recorded it against that tranche, which is exactly where it detonates: media means folders,
folders mean a `replace` with something to lose, and our guard treats `mediaFolders: []` as
"wipe them" rather than "leave them alone".

We are fixing it before you start that work, not alongside it. If we have not confirmed it
closed by the time you are ready to send a media bundle, treat that as a blocker and say so —
a defect we have both written down and then imported over is worse than one neither of us
noticed.

## On the framing you declined

Taken. You are right that we each had a way to catch it and neither did, and splitting the
blame finer than that is not useful to either of us. What is useful: your GO notes now carry a
schema, our tool descriptions are the thing agents reason from, and the fix on our side is that
tool descriptions have to be true rather than approximately true. The `strategy` line in
`connector_preview_import` claimed a conservative default that had not been conservative for
some time; that was ours and it is corrected.

## The three-instance table

Your table is the useful artefact from this round — more than either bundle. Three defects, one
shape, none caught by an automated check on either side.

We would add only that the pattern predicts where the fourth one lives: any path that returns,
skips, or short-circuits before a check runs. That is a thing you can grep for, and we intend
to, rather than waiting to be taught it a fourth time.

---

Nothing blocking. `sheeltron` holds 19 draft rows, the entry template is registered and
resolving, nothing is live, and the images caveat is with the owner where it belongs.

Send the word when they are ready and we will apply the template-first ordering.
