# Connect an AI agent to a client site

How to give an AI assistant access to a client's website, so it can write pages, draft blog posts
and upload images — with you deciding exactly what it may and may not do.

Everything is done from one web page:

**https://siteagent.tailbbb0d2.ts.net/operator/mcp**

No prior knowledge needed.

> **Reading this in a browser:** the same guide is served at
> **https://siteagent.tailbbb0d2.ts.net/operator/mcp/documentation**, linked from the top of the
> MCP Agents page. The page comes from `docHTML/connect-an-ai-agent.html` — edit that file and a
> refresh picks it up, no restart or rebuild.

---

## What this actually is

You are giving an AI a **keycard** to one client's website.

Like a real keycard, it opens some doors and not others — and you choose which when you make it.
If the AI turns out to be doing something you don't like, you cancel the card and it stops
working immediately.

Two things go to whoever runs the AI:

| Thing | What it is | Example |
|---|---|---|
| **Address** | A web link, one per client site | `https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental` |
| **Key** | A long password that decides what the AI may do | `mmsmcp_8Kd93jRmQp2xVn...` |

That's the whole connection.

---

## Step 1 · Turn the site on for AI access

Open **https://siteagent.tailbbb0d2.ts.net/operator/mcp** and scroll to **Endpoint directory** at
the bottom. Every client site is listed:

| Site | Endpoint | Bridge | Keys | |
|---|---|---|---|---|
| `acme-dental` | `https://.../mcp/acme-dental` | not installed | 0 | **Install bridge** |
| `bright-cafe` | `https://.../mcp/bright-cafe` | installed | 2 | Reinstall |

Press **Install bridge** on the site you want. Wait a few seconds — the Bridge column changes to
**installed**.

You only do this once per site, ever.

**What it does:** it switches on the part that lets an AI build page layouts properly. Without it
the AI can still manage images and site-wide styling, but not pages or posts.

> **"site not running"** in the Bridge column means that client's site is currently stopped.
> Start it from the Tenants page, then come back.

---

## Step 2 · Create a key

Scroll to **Create a key** at the top of the same page.

**Site** — pick the client, e.g. `acme-dental`. The key works on this site and no other.

**Label** — a name so you recognise it later, e.g. `blog-writer`. This is just for you.

**Tables** — leave blank to allow everything. Or type `posts` to restrict the AI to blog posts
only, so it can never touch the homepage.

**Expires in** — blank means never. `90` means the key stops working after 90 days.

**Permissions** — the important part. Tick what the AI is allowed to do:

| Tick | The AI can |
|---|---|
| `read` | Look at pages, posts and content. Change nothing |
| `create` | Make new pages and blog posts — **as drafts** |
| `edit` | Change existing content and page layouts |
| `delete` | Move things to Trash (a person can restore them) |
| `publish` | **Push work live to the real website** |
| `tables.manage` | Create new content collections |
| `media.read` | Browse the image library |
| `media.write` | Upload and edit images |
| `media.delete` | Move images to Trash |
| `design.edit` | Change site-wide colours, fonts and styles |

Press **Create key**.

### Copy it now

A green box appears with your key. **This is the only time it is ever shown.** Only a fingerprint
is stored, so nobody can read it back later — not even you.

Four copy buttons:

- **Copy key** — just the password
- **Copy endpoint** — just the address
- **Copy command** — the whole ready-to-paste setup line for Claude Code
- **Copy both** — address and key together, for other AI tools

Lost it? Revoke the key and make a new one. It takes ten seconds.

---

## Step 3 · Connect it to an AI

Every AI tool needs the same two things. Only the place you type them changes:

```
Endpoint:  https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental
Header:    Authorization: Bearer mmsmcp_8Kd93jRmQp2xVn...
```

Find your tool below. If it isn't listed, check whether it accepts a URL with custom headers
(Group A) or only a command (Group B), and copy the closest example.

---

### Group A · Tools that connect to a URL directly

These take the endpoint and the header as-is.

#### Claude Code

Press **Copy command** on the console and paste it into a terminal:

```sh
claude mcp add mms-cms --transport http \
  https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental \
  --header "Authorization: Bearer mmsmcp_8Kd93jRmQp2xVn..."
```

Confirm with `claude mcp list`. Remove it later with `claude mcp remove mms-cms`.

#### Cursor

**Settings → MCP → Add new MCP server**, then:

```json
{
  "mcpServers": {
    "mms-cms": {
      "url": "https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental",
      "headers": { "Authorization": "Bearer mmsmcp_8Kd93jRmQp2xVn..." }
    }
  }
}
```

#### VS Code (GitHub Copilot)

Create `.vscode/mcp.json` in the project, or use **MCP: Add Server** from the command palette:

```json
{
  "servers": {
    "mms-cms": {
      "type": "http",
      "url": "https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental",
      "headers": { "Authorization": "Bearer mmsmcp_8Kd93jRmQp2xVn..." }
    }
  }
}
```

Then switch Copilot Chat to **Agent** mode — MCP tools are not available in Ask mode.

#### Windsurf

**Settings → Cascade → MCP Servers → Add server**, or edit `mcp_config.json`:

```json
{
  "mcpServers": {
    "mms-cms": {
      "serverUrl": "https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental",
      "headers": { "Authorization": "Bearer mmsmcp_8Kd93jRmQp2xVn..." }
    }
  }
}
```

#### Cline (VS Code extension)

**MCP Servers → Configure → Edit Configuration**:

```json
{
  "mcpServers": {
    "mms-cms": {
      "type": "streamableHttp",
      "url": "https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental",
      "headers": { "Authorization": "Bearer mmsmcp_8Kd93jRmQp2xVn..." }
    }
  }
}
```

#### n8n

Add an **MCP Client** node:

- **Endpoint** — `https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental`
- **Server Transport** — HTTP Streamable
- **Authentication** — Header Auth
- **Name** — `Authorization`
- **Value** — `Bearer mmsmcp_8Kd93jRmQp2xVn...`

Connect it to an **AI Agent** node and the tools appear automatically.

---

### Group B · Tools that only run a command

These can't call a URL themselves. `mcp-remote` bridges the gap — it runs locally and forwards to
the endpoint. It comes from npm, so Node must be installed.

#### Claude Desktop

**Settings → Developer → Edit Config**, then:

```json
{
  "mcpServers": {
    "mms-cms": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental",
        "--header", "Authorization:${AUTH}"
      ],
      "env": { "AUTH": "Bearer mmsmcp_8Kd93jRmQp2xVn..." }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the tools icon in the message box.

> **Why the key is in `env`, not `args`:** the header value contains a space, which breaks
> argument parsing. Putting it in `env` and referencing it as `${AUTH}` is the standard
> workaround, and it applies to every example in this group.

#### Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.mms-cms]
command = "npx"
args = ["-y", "mcp-remote", "https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental", "--header", "Authorization:${AUTH}"]
env = { AUTH = "Bearer mmsmcp_8Kd93jRmQp2xVn..." }
```

#### Any other stdio-only tool

Same shape everywhere — a command, its arguments, and an environment variable:

```
command:  npx
args:     -y  mcp-remote  https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental  --header  Authorization:${AUTH}
env:      AUTH = Bearer mmsmcp_8Kd93jRmQp2xVn...
```

---

### Group C · Web assistants — not supported

**claude.ai** and **ChatGPT** custom connectors run on the provider's servers and sign in with
OAuth. They have no field for a custom header, so they cannot send the key.

Use one of the desktop or CLI tools above instead. Anyone can connect their own copy of Claude
Desktop or Claude Code with the key you give them.

---

### Check the connection

Any tool, any language — this asks the endpoint what it can do:

```sh
curl -X POST https://siteagent.tailbbb0d2.ts.net/mcp/acme-dental \
  -H "Authorization: Bearer mmsmcp_8Kd93jRmQp2xVn..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A working key returns a long list of tools. A bad or revoked key returns
`"Invalid, revoked, or expired agent key"`.

---

## Using it

Once connected, people just talk to the AI normally. Here's a key with `read`, `create`, `edit` —
but **not** `publish`:

> **Staff:** Write a blog post about our new teeth whitening service.
>
> **Claude:** I've looked at your existing posts to match the style. I've created
> "Professional Teeth Whitening — What to Expect", about 600 words, saved as a **draft**.
> It's not live yet.
>
> **Staff:** Add a photo to it.
>
> **Claude:** Uploaded `whitening-chair.jpg` and set it as the header image. I've added alt text
> for accessibility: "Dental hygienist preparing a whitening treatment".
>
> **Staff:** Great, publish it.
>
> **Claude:** I don't have permission to publish. The post is ready in your CMS as a draft —
> someone with publishing access can review and publish it.

The AI did the work. A person still decides what goes live. **That's what leaving `publish`
unticked buys you.**

### The same job with `publish` ticked

> **Staff:** Write a post about teeth whitening and put it live.
>
> **Claude:** Published "Professional Teeth Whitening — What to Expect". It's live at
> `/blog/professional-teeth-whitening`.

No human check. Use this only for content you're happy going out unreviewed.

### More things people ask it

> *"Update the opening hours on the contact page to 9–6 weekdays."*
>
> *"Find every post that mentions the old clinic address and list them."*
>
> *"Add a testimonials section to the homepage with these three quotes."*
>
> *"Write alt text for every image in the library that's missing it."*
>
> *"Make the headings on mobile smaller — they're wrapping badly."*

---

## Recipes

Copy these rather than deciding from scratch:

**Content writer** — drafts everything, publishes nothing. *The safest place to start.*
`read`, `create`, `edit`, `media.read`, `media.write`

**Autonomous publisher** — writes and publishes with no human step.
`read`, `create`, `edit`, `publish`, `media.read`, `media.write`

**Blog-only writer** — same as content writer, but locked to blog posts. Set **Tables** to `posts`.
`read`, `create`, `edit`, `media.read`, `media.write`

**Auditor** — reads the site and reports. Cannot change anything.
`read`, `media.read`

**Designer** — adjusts site-wide look and feel.
`read`, `edit`, `design.edit`, `media.read`, `media.write`

---

## What the AI can do

**Looking** — list the site's content types; read any page, post or layout; search; see what's
currently live versus what's still a draft.

**Writing** — create pages and posts; edit text and fields; build page layouts by adding, moving,
duplicating and removing sections; set styling per section, including how it looks on mobile;
move content between collections; delete to Trash.

**Images** — browse the library; upload; set alt text, captions and tags; organise into folders;
replace an image everywhere it's used; delete to Trash and restore.

**Site-wide design** — read and change colours, fonts, spacing rules and breakpoints.

**Going live** — publish one item, schedule it for later, or refresh every published page after a
site-wide change.

### What it can never do

- **Touch users, roles or logins.** No such action exists. Even a key with every box ticked
  cannot create an account, change permissions or lock anyone out.
- **Reach another client's site.** A key is bound to one site. Pointed anywhere else, it's rejected.
- **Delete anything permanently.** Deletes go to Trash and a person can restore them.

---

## Managing keys

The **Keys** section lists every key: label, site, permissions, tables, last used, status.

**Revoke** stops a key working on its very next request. Use it when:

- The work is finished
- Someone left the project
- A key may have leaked
- The AI did something unexpected

There's no undo, and that's deliberate — make a new key instead.

**Last used** tells you whether a key is still in service. Anything idle for months should
probably be revoked.

---

## When something doesn't work

| What you see | What to do |
|---|---|
| "Invalid, revoked, or expired agent key" | Wrong key, revoked, or past its expiry. Also check it's for *this* site — a key for `acme-dental` won't work on `bright-cafe`. |
| "This agent key is not valid for that site" | Right key, wrong address. Match the site name at the end of the URL. |
| The AI says a tool isn't available | That permission isn't ticked. Make a new key with the right boxes ticked — keys can't be edited after creation, so a key's power can never quietly grow. |
| "Table not found" when creating content | The bridge isn't switched on for that site. Endpoint directory → **Install bridge**. |
| Images work but pages don't | Same cause — the bridge isn't switched on. |
| Connection refused / nothing responds | That client's site is stopped, or the key's site name is misspelled in the address. |

---

## Good habits

**Start without `publish`.** Let the AI draft for a week. Read what it produces. Add publishing
only once you trust it.

**One key per job, not one key for everything.** Separate keys mean you can revoke one without
disrupting the rest, and the activity log shows which key did what.

**Use table limits.** A blog-writing AI has no business touching the homepage. Set **Tables** to
`posts`.

**Set an expiry for anything temporary.** A key for a one-month campaign should expire in 30 days.

**Treat a key like a password.** Anyone holding it has the access it carries. Don't email it or
paste it into a group chat — and keep the console link itself to people who should be handing out
access.
