/**
 * Account commands — §4.13 of the Command Spotlight master plan.
 *
 * Sign out (destructive), navigate to account settings sections.
 */

import { signOutEverywhere } from '@core/persistence'
import { readHubContext } from '@admin/state/hubContext'
import type { Command } from '../types'

export function getAccountCommands(): Command[] {
  return [
    {
      id: 'account.profile',
      title: 'Edit profile',
      subtitle: 'Update your name, email, and avatar',
      group: 'account',
      iconName: 'cursor-minimal-solid',
      keywords: ['account', 'profile', 'edit', 'name', 'email', 'avatar'],
      workspaces: ['any'],
      run: (ctx) => {
        ctx.closeSpotlight()
        ctx.navigate('/cms/account')
      },
    },

    {
      id: 'account.signOut',
      title: 'Sign out',
      subtitle: 'End your current session',
      group: 'account',
      iconName: 'power-off',
      keywords: ['sign out', 'logout', 'log out', 'session', 'exit'],
      workspaces: ['any'],
      destructive: true,
      run: async (ctx) => {
        ctx.closeSpotlight()
        try {
          // Hub-wide, exactly as the account menu's Sign out — a CMS-only
          // logout is silently undone by the hub's re-SSO.
          await signOutEverywhere(readHubContext()?.hubBaseUrl ?? null)
        } catch (err) {
          console.error('[spotlight] sign out failed:', err)
        }
      },
    },
  ]
}
