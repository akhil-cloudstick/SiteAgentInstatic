import { DesktopPetClient } from './client';

// Client-only view — force a static shell (`output: 'export'` target).
export const dynamic = 'force-static';

export default function DesktopPetPage() {
  return <DesktopPetClient />;
}
