# Operator Guide — Path B: Import a Site Replica

This is the one-time setup an Operator does after a site replica is imported into a tenant's Instatic.  
After this setup, the tenant receives login credentials and can edit the site fully on their own.

---

## Before you start

- The site replica must be built following `docs/templateRule.md`
- You have the `dist/` folder ready (from whoever built the replica)
- The tenant's Instatic instance is running (provisioned and accessible)
- You are logged in as the Instatic Owner for this tenant

---

## Step 1 — Import the dist/ folder

1. Open the tenant's Instatic (e.g. `http://localhost:3101/admin`)
2. Press **Ctrl + K** → select **Import Site**
3. Click **Browse** and select the `dist/` folder from the replica project
4. Instatic scans the folder — you will see a summary:
   - **Pages** — all HTML files found
   - **Style rules** — CSS classes imported (should be 100+)
   - **Color tokens** — CSS variables from `:root` (brand colors)
   - **Scripts** — JS files
5. Click **Continue**

---

## Step 2 — Resolve conflicts (if any)

If this tenant already has a previous import, Instatic shows a conflicts screen.

- **Page slug conflicts** → click **Overwrite all**
- **Class name conflicts** → click **Overwrite all**
- **Design token conflicts** → click **Overwrite all**

Then click **Import**.

Wait for the import to finish. All pages will appear in the left sidebar.

---

## Step 3 — Fix page routes

The imported pages may have routes like `/dist/blog` instead of `/blog`.  
Fix each one:

1. Click a page in the sidebar (e.g. `Blog & Insights`)
2. Click the **Settings** (gear) icon for that page
3. Change the route from `/dist/blog` to `/blog`
4. Repeat for each page:
   - `/dist` → `/`  (homepage)
   - `/dist/infrastructure` → `/infrastructure`
   - `/dist/services` → `/services`
   - `/dist/sustainability` → `/sustainability`
   - `/dist/blog` → `/blog`
   - `/dist/contact` → `/contact`
   - `/dist/thank-you` → `/thank-you`

---

## Step 4 — Create the Navbar as a Visual Component

This is the key step. Do this once and the tenant can update the nav from one place forever.

1. Open the **homepage** (`/`) in the Instatic canvas
2. Click on the **navbar** element at the top of the page
3. In the right panel, look for **"Save as Component"** or **"Convert to Component"**
4. Name it: `Global Navbar`
5. Save

Now replace the navbar on every other page:
1. Open each page (blog, contact, infrastructure, etc.)
2. Click on that page's navbar → **Delete** it
3. Open the **Components** section in the left sidebar
4. Drag **Global Navbar** onto the page at the top
5. Repeat for all pages

---

## Step 5 — Create the Footer as a Visual Component

Same process as the navbar:

1. Open the **homepage** in the canvas
2. Click on the **footer** at the bottom
3. **"Save as Component"** → name it: `Global Footer`
4. Save

Replace the footer on every other page:
1. Open each page
2. Click that page's footer → **Delete** it
3. Drag **Global Footer** from Components onto the bottom of the page
4. Repeat for all pages

---

## Step 6 — Verify

1. Edit the **Global Navbar** component — change one nav link label
2. Open 2–3 different pages → confirm the change appears on all of them
3. Undo the test change
4. Edit the **Global Footer** — change the copyright year or address
5. Check multiple pages → change reflects everywhere

If it works, the global components are wired correctly.

---

## Step 7 — Test publish

1. Click **Publish** in Instatic
2. Wait for "Baking & deploying…" to complete
3. Open the live Cloudflare URL → confirm the site looks exactly as designed (dark theme, correct colors, all sections)
4. Check the navbar and footer on the live site

---

## Step 8 — Share credentials with the tenant

1. In the Operator Console → go to **Tenants**
2. Find this tenant → click **Share Link**
3. Copy the login URL, email, and password
4. Send to the tenant

The tenant logs in, sets their own 2FA, and from this point:
- Edits text and images on any page
- Edits the **Global Navbar** to add/remove/rename navigation links (reflects on all pages)
- Edits the **Global Footer** to update address, contact, copyright (reflects on all pages)
- Adds new pages
- Publishes to Cloudflare

---

## What the tenant can do (no operator needed after this)

| Task | How |
|---|---|
| Edit text or image on a page | Click → edit in canvas |
| Change brand color | Settings → Color tokens → change `color-crimson` |
| Add a nav link for a new page | Edit **Global Navbar** component |
| Update footer info | Edit **Global Footer** component |
| Add a new page | Pages → New Page |
| Publish | Click Publish → live on Cloudflare |
| Use AI for help | AI chat in Instatic |
