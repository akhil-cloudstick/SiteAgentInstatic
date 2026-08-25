---
title: Open Design 0.20.0 — Steady by Design
description: Start in Prototype, navigate every slide with previews and notes in sync, and export editable PowerPoint files with fonts and line breaks intact. We’ve also fixed an issue that could cause generated artifacts to open to a blank screen.
---

### 🌟 Codename: *Steady by Design*

🧭 **53 PRs · 13 contributors · 5 days** — **Start in Prototype, navigate every
slide with previews and notes in sync, and export editable PowerPoint files with
fonts and line breaks intact. We’ve also fixed an issue that could cause
generated artifacts to open to a blank screen.** 0.19 filled the menu of things
you can make; 0.20.0 is the release that makes each of them hold — from the first
click on Home to the file you hand off.

## 🔥 Highlights

- 🧪 **Home starts where most people actually start: a prototype.** A fresh
  composer opens on Prototype, and the creation list is now a stable,
  product-owned set — Prototype, Slide deck, Image, Document, HyperFrames,
  Website clone, Video, Audio, Live artifact, WebGL — instead of a list that
  shifted with whichever plugins happened to be installed. Landing / marketing,
  Dashboards, Mobile app, Wireframe, Apps, Developer tools, Brand / design and
  Docs / reports are always there under Prototype, in every language, and
  Community filters lead with prototypes too. (#6914, #6975, #6906, #6980)

- 🎞️ **Editable PowerPoint keeps the design you approved.** Imported Google
  Fonts now travel into the file, authored line breaks stay where you put them
  instead of reflowing in PowerPoint or WPS, and layered slide backgrounds
  survive the trip. Source-mode export works again across development runtimes,
  and titles containing `$`-style replacement sequences export verbatim rather
  than losing characters. (#6840, #6845, #6921, #6947)

- 🖼️ **A deck thumbnail takes you to the slide it shows.** Thumbnails, the main
  stage, the page counter, speaker notes and the previous/next controls now move
  as one — across both legacy and current decks — instead of the sidebar
  advancing while the stage stayed on slide one. Thumbnail layout keeps the real
  slide proportions, and remixing a deck from Community gives you a working
  preview immediately. (#6950, #7095, #6996)

- 🩹 **Generated artifacts stop opening to a blank screen.** Switching files,
  toggling Code/Preview, or moving between projects could leave a permanently
  white canvas when Chromium aborted a retained preview navigation. Previews now
  stay mounted and reusable across those switches, recover on their own when a
  navigation is dropped, and load their fonts instead of falling back to a bare
  page. (#7128, #7055, #7007)

- 🎬 **HyperFrames renders video from the app, not from your npm cache.** Video
  compositions now scaffold through Open Design and render with the HyperFrames
  runtime pinned and packaged alongside the daemon, so a stale native artifact in
  a user's npm cache can no longer break generation — and Windows packaged builds
  ship it correctly. (#7030, #7132)

- 🌐 **Website Clone uses the browser you already have.** Cloning a site used to
  spend minutes installing Playwright into every generated project, often failing
  outright. It now drives an installed Chrome, Edge, or Chromium through an
  isolated temporary profile, leaves your project untouched, and works the same
  from the UI or from `od` with no client window open. (#7000, #7066)

- 🧑‍🤝‍🧑 **A Workspace hiccup no longer takes your project with it.** Files already
  on your machine stay editable, runnable and shareable when the cloud directory
  is briefly unreachable, a newly invited teammate can open a shared project
  before every byte has transferred, public file shares survive a daemon restart,
  and the workspace you were last in is the one you come back to. (#7027, #6989,
  #7002, #7067)

- ⚡ **Refresh a long run without paying for the whole history again.** Multi-minute
  sessions still stream thinking and text live, but the transcript is now written
  in durable append-only batches: reloads stay responsive, active runs rebuild
  cleanly, and finished conversations stop accumulating an ever-growing rewrite
  cost. (#6952)

- 🧹 **Run Open Design's anti-slop check anywhere.** The artifact linter that
  guards work inside the app is now `od lint`. Point it at a file or pipe stdin,
  pick a failure threshold, and get readable or JSON findings without starting a
  model — so headless agents and CI can catch weak defaults before anything is
  exported. (#6959)

- 🛑 **A failed run stops looking like a finished one.** Repeated OpenCode shell
  errors — including the PowerShell failures that used to slip through as
  completed tools — now reach the loop guard, so Open Design can warn, stop, and
  keep the real failure instead of ending on a green-looking result. Claude runs
  that exceed the context window are named as such rather than reported as a
  generic execution failure. (#6933, #7044)

- 🖼️ **A refused image says it was refused.** When a content-safety policy turns
  down an image request, the reply now says so and points at the prompt or
  reference image you can actually change — instead of sending you off to wait
  for an outage that will never recover. (#6993)

- 🌍 **Switching AMR environments moves the whole app.** Balance, Workspace
  context, upgrade links and settings destinations now follow the profile you
  picked — prod, test, or feature-test — without a restart, and an unmapped
  destination fails closed rather than quietly opening the wrong environment.
  (#6991)

- 👤 **Recent projects look like your workspace, not an anonymous list.** Your own
  projects carry your signed-in name and avatar instead of a generic "Me", and a
  row's overflow menu flips upward near the bottom of the screen so every action —
  Delete included — stays reachable. (#6857, #6971)

- 🛡️ **BYOK media downloads draw a firmer line around your machine.** Image and
  video URLs returned by an external provider can no longer steer the daemon back
  into localhost, including through DNS tricks. Deliberately configured local
  provider gateways keep working; untrusted asset responses no longer get the same
  privilege. (#6072)

## ✨ Added

### 🧠 Agents, runtimes and automation

- `od lint <file.html|->` brings artifact quality checks to headless agents,
  scripts and CI, with configurable failure thresholds, stdin input and
  machine-readable JSON output. (#6959)
- A short experience survey can appear after Open Design delivers an artifact,
  with an "other" answer for anything the preset options miss. (#6999, #7117)

### 🏠 Home, Community and the site

- The DeepSeek Harness design collection gains six more curated plugins,
  illustrated covers and a fuller setup-to-design tutorial. (#6903, #6943, #6945)
- The site publishes the 0.19.1 release, offers direct installer downloads, adds
  the Hong Kong event recap and features Shanghai on Events. (#6901, #6982)
- READMEs carry a refreshed product tour across locales and a Feishu community
  link. (#6922, #6946)

## 🔁 Changed

- Prototype is the default creation type for a fresh Home composer; a saved
  choice or an explicit handoff still wins. Prototype scenes no longer depend on
  the installed plugin catalog. (#6975, #6914)
- Completion sound and desktop notifications are on by default for new clients.
  (#7038)
- The result summary lists only the files actually delivered. (#7006)
- Media-only models no longer appear in the chat model picker. (#7123)
- The structured design-system runtime introduced in 0.19.2 has been rolled back,
  together with its CLI and API surfaces. Design systems return to the previous
  manifest and prompt behavior while that workflow is reworked. (#7110)

## 🐛 Fixed

### 🎨 Decks, export and previews

- Editable PPTX export embeds compatible imported fonts, preserves authored line
  breaks and layered slide backgrounds; source-mode export no longer fails when
  the runtime exposes the exporter through a different module shape. (#6840,
  #6845, #6921)
- Export titles containing replacement-pattern sequences stay verbatim in PDF,
  image and example exports. (#6947)
- Deck thumbnails, stage, page counter, speaker notes and previous/next controls
  stay synchronized across older and current slide markup, and thumbnails keep
  the slide's real proportions. (#6950, #7095)
- HTML and slide previews survive file-tab, Code/Preview and project switches,
  recover from aborted navigations, and load their fonts. (#7128, #7055)
- Community deck remixes preview reliably, HTML card thumbnails are no longer
  double-scaled, and the Home examples rail stops shifting after a restart.
  (#6996, #7007, #7037)

### 🧠 Agents, workspaces and reliability

- Long streamed conversations persist incrementally, reload from durable batches
  and compact cleanly when the run ends. (#6952)
- OpenCode preserves failed tool results and non-zero exits so repeated failures
  reach the loop guard instead of masquerading as successful work. (#6933)
- Claude prompt-too-long failures are classified as such. (#7044)
- Vela image safety refusals reach the client as a refusal rather than a generic
  outage. (#6993)
- Workspace-bound projects stay usable during a directory outage and on a new
  member's first open; workspace authority derives from project bindings; public
  file shares and the last selected workspace survive a daemon restart. (#7027,
  #6989, #7002, #7067)
- AMR balance, Workspace context, upgrade links and settings links follow the
  selected environment and stop safely when that environment has no trusted
  destination. (#6991)
- Execution diagnostics keep runtime usage attribution. (#7076)
- Trace object authority is routed through Vela. (#6986)
- External BYOK asset URLs cannot resolve to loopback addresses, while explicitly
  configured local provider endpoints keep working. (#6072)
- HyperFrames scaffolding and rendering no longer depend on an ambient `npx`
  install, and Windows packaging declares its native dependencies per platform.
  (#7030, #7132)
- Website Clone starts a system browser instead of installing Playwright into
  each generated project, from the UI and from `od` alike. (#7000, #7066)

### 🖥️ Home, plugins and interface polish

- Recent-project cards show the signed-in account identity, and list-row menus
  choose the direction that keeps every action on screen. (#6857, #6971)
- The community plugin detail page scrolls, and its modal dims the full app
  chrome — account and GitHub controls included — instead of letting those float
  above it. (#7070, #6912)
- The Message Center close button is back. (#6992)
- The project update-ready indicator behaves again. (#7004)
- The landing page no longer repeats a pricing capability block. (#6913)

## 🙏 Thanks to everyone who shipped 0.20.0

@alchemistklk · @AmyShang-alt · @cactusrabbit · @CVE-Hunter-Leo · @dcrtorres ·
@DojoGenesis · @joeylee12629-star · @kokisanai · @lefarcen · @mrcfps ·
@Siri-Ray · @xne998808-ai · @YUHAO-corn
