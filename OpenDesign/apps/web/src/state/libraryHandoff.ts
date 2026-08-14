// Transient, in-memory hand-offs from the Library multi-select bar to other
// surfaces. The router navigates by URL only, so anything that can't ride a URL
// (File objects, pre-built composer attachments) is parked here for exactly one
// consumer to pick up right after navigation, then cleared.
//
// Both slots are single-shot: the producer sets, the consumer takes. Nothing
// here is persisted — a refresh drops the hand-off, which is the desired
// behaviour (a stale seed should never resurface).

import type { ChatAttachment } from '@open-design/contracts';

// --- Path A: seed the "Create design system" flow ---------------------------
// Selected Library assets, fetched into File objects, to pre-fill the design
// system creation flow's source material (assetFiles / assetFileObjects).

export interface DesignSystemAssetSeed {
  files: File[];
}

let dsSeed: DesignSystemAssetSeed | null = null;

export function setDesignSystemAssetSeed(seed: DesignSystemAssetSeed | null): void {
  dsSeed = seed;
}

/** Consume the design-system seed (single-shot). */
export function takeDesignSystemAssetSeed(): DesignSystemAssetSeed | null {
  const seed = dsSeed;
  dsSeed = null;
  return seed;
}

// --- Path A2: seed the "Create design system" flow with a full setup ---------
// The approved MMSBUILD screen collects every creation input in a modal on the
// Design systems page (`CreateDesignSystemDialog`), not on the create route. The
// modal therefore stands in for the flow's `setup` + `confirm` steps and parks
// the collected state here; `DesignSystemFlow` takes it on mount and goes
// straight to generation.
//
// In memory rather than sessionStorage for the same reason as Path A: the seed
// carries `File` objects, which cannot be serialized. Both consumers live in the
// same SPA session, so the hand-off survives the route change and a refresh
// correctly drops it (the create route then renders its own full setup form).

export interface DesignSystemSetupSeed {
  company: string;
  designMd: string;
  sourceUrls: string[];
  figmaUrls: string[];
  codeFolders: string[];
  figFiles: string[];
  figFileObjects: File[];
  assetFiles: string[];
  assetFileObjects: File[];
  notes: string;
}

let dsSetupSeed: DesignSystemSetupSeed | null = null;

export function setDesignSystemSetupSeed(seed: DesignSystemSetupSeed | null): void {
  dsSetupSeed = seed;
}

/** Consume the design-system setup seed (single-shot). */
export function takeDesignSystemSetupSeed(): DesignSystemSetupSeed | null {
  const seed = dsSetupSeed;
  dsSetupSeed = null;
  return seed;
}

// --- Path B: seed an existing project's composer ----------------------------
// A query + the assets just copied into the project, to pre-fill the chat
// composer of the target design system's project so the user can review + Send.

export interface ComposerSeed {
  projectId: string;
  text: string;
  attachments: ChatAttachment[];
}

let composerSeed: ComposerSeed | null = null;

export function setComposerSeed(seed: ComposerSeed | null): void {
  composerSeed = seed;
}

/** Consume the composer seed iff it targets `projectId` (single-shot). */
export function takeComposerSeedFor(projectId: string): ComposerSeed | null {
  if (composerSeed && composerSeed.projectId === projectId) {
    const seed = composerSeed;
    composerSeed = null;
    return seed;
  }
  return null;
}

// --- Path C: seed the Home chat composer ------------------------------------
// Selected Library assets, fetched into File objects, to pre-attach to the Home
// chat composer ("Chat to design"). The user lands in the creation composer
// with the assets staged, describes what to build, and Runs to spawn a new
// project. Mirrors Path A's File hand-off, but the consumer is HomeView rather
// than the design-system flow.

export interface HomeComposerAssetSeed {
  files: File[];
}

let homeComposerSeed: HomeComposerAssetSeed | null = null;

export function setHomeComposerAssetSeed(seed: HomeComposerAssetSeed | null): void {
  homeComposerSeed = seed;
}

/** Consume the Home composer asset seed (single-shot). */
export function takeHomeComposerAssetSeed(): HomeComposerAssetSeed | null {
  const seed = homeComposerSeed;
  homeComposerSeed = null;
  return seed;
}
