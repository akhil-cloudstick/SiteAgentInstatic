# MMSBUILD User Cycle Flow Chart

This chart explains MMSBUILD from the client/user cycle: how a local business owner moves from first website problem to launch, reporting, monthly improvements, and possible MMS upsell.

```mermaid
flowchart TD
  A["1. Discover Problem<br/>Old site, no updates, weak enquiries"] --> B["2. Client Lite Onboarding<br/>Business basics, old URL, goals, services"]
  B --> C["3. Website Diagnosis<br/>Crawl, page inventory, content gaps, trust gaps"]
  C --> D["4. Revival Plan<br/>Business profile, service map, template choice, media needs"]
  D --> E["5. Build Draft<br/>Instatic CMS, Site Agent Library, page blueprints, reusable sections"]
  E --> F["6. Generate Assets<br/>AI copy, images, short video/animation through Resource Control Plane"]
  F --> G["7. Review And Approve<br/>Client preview, change requests, media approval, operator QA"]
  G --> H["8. Publish Website<br/>Clean static pages, WhatsApp CTA, service pages, local trust signals"]
  H --> I["9. Launch Report<br/>What changed, what was generated, usage, next actions"]
  I --> J["10. Monthly Freshness Cycle<br/>New content, service refreshes, reports, pending client tasks"]
  J --> K{"Needs deeper business tools?"}
  K -->|No| C
  K -->|Yes| L["MMS Upsell Bridge<br/>CRM, operations, billing, deeper business suite"]

  subgraph Features["MMSBUILD Features Across The Cycle"]
    F1["Client Lite Hub"]
    F2["Operator Hub"]
    F3["Firecrawl Import"]
    F4["Visual Reconstruction"]
    F5["Template Library Engine"]
    F6["Site Agent Library"]
    F7["Resource Control Plane"]
    F8["fal.ai Media Adapter"]
    F9["Instatic CMS Adapter"]
    F10["Report Engine"]
    F11["MMS Bridge"]
  end

  B -.-> F1
  C -.-> F3
  C -.-> F4
  D -.-> F5
  E -.-> F6
  E -.-> F9
  F -.-> F7
  F -.-> F8
  G -.-> F2
  I -.-> F10
  L -.-> F11
```

## User Cycle Feature Explanation

| Cycle Stage | What The Client Experiences | MMSBUILD Features Working Behind The Scenes |
| --- | --- | --- |
| 1. Discover Problem | "My website is old, weak, or abandoned." | Offer positioning, website health framing |
| 2. Client Lite Onboarding | Simple guided questions, old URL, services, goals | Client Lite Hub, onboarding wizard, business profile engine |
| 3. Website Diagnosis | Clear diagnosis of what is broken or missing | Firecrawl adapter, visual reconstruction, page inventory, content gap detection |
| 4. Revival Plan | A practical rebuild plan, not a confusing CMS | Template Library Engine, brand profile, service map, media needs |
| 5. Build Draft | A previewable site draft appears | Instatic adapter, Site Agent Library, page blueprints, Visual Components |
| 6. Generate Assets | Better photos, copy, and optional animation are proposed | Resource Control Plane, AI agents, fal.ai adapter, Asset Vault |
| 7. Review And Approve | Approve, reject, or request edits | Approval Engine, Operator Hub, QA checklist |
| 8. Publish Website | Refreshed site goes live | Instatic publisher, WhatsApp CTA, local trust sections, clean static output |
| 9. Launch Report | Client sees what changed and what was used | Report Engine, usage ledger, generated asset summary |
| 10. Monthly Freshness | Site keeps improving without client overwhelm | freshness engine, service refreshes, reports, reminders |
| 11. MMS Upsell Bridge | Client moves to deeper business tooling when ready | MMS Bridge, upsell signals, handoff events |
