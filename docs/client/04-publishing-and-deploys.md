# Where publishing actually serves

**A CMS publish reaches the public internet.** This is the most important thing in this pack, so it leads.

The assumption that a publish stays on the CMS host — reasonable, given the targets are `127.0.0.1` addresses — does not hold.

## The chain

Every tenant runs with a deploy webhook pointed at the control plane. On a successful full-site publish, the CMS fires that webhook. The control plane then runs `wrangler pages deploy` against Cloudflare Pages, and can attach a custom domain.

```
publish  →  webhook  →  control plane  →  wrangler pages deploy  →  public URL
```

The webhook call is fire-and-forget and unawaited, so **the publish response says nothing about whether the deploy succeeded**. CMS publish success and deploy success are two separate outcomes, and only the first is visible to the caller.

## It already happened

The deploy registry records it:

```
tenant   client-b
status   live
url      https://siteagent-client-b.pages.dev
started  2026-08-26T06:45:11Z
```

That is sixteen seconds after the publish at `06:44:55Z`. The 31 pages published that day went to a public URL, not just to the CMS host.

No custom domain was attached on that record, so it did not land on the production domain — but the mechanism that would do so is wired and working.

## What follows from this

**Redirects must be in place before any cutover.** A publish is a public act. If a domain is attached and a site is published without its redirect map, every old URL breaks the moment the deploy completes, and nothing in the publish response indicates it.

**Publish is the committing step.** There is no version rollback: unpublishing retracts a route but does not restore earlier content. Treat it accordingly.

**Deploy state is recorded separately.** The deploys registry holds status, URL and timing per attempt. A CMS publish that appears clean can still have a failed deploy behind it — check both.

## Suppressing deploys during bulk work

A bulk operation that publishes many rows fires the webhook repeatedly. During a migration that means many deploys of intermediate states, each taking a minute or more, and each visible publicly.

For bulk work, suppress the webhook for the duration, then deploy once, explicitly, after the CMS state and the public routes have both been verified.
