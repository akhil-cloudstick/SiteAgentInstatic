/**
 * Help commands — §4.15 of the Command Spotlight master plan.
 *
 * - Show keyboard shortcuts
 * - Open documentation
 * - Report an issue
 * - About <product>
 * - Copy environment info (for bug reports)
 */

import type { Command } from '../types'
import { BRAND_NAME } from '@core/brand'

export function getHelpCommands(): Command[] {
  return [
    {
      id: 'help.shortcuts',
      title: 'Show keyboard shortcuts',
      subtitle: 'Browse all keyboard shortcuts',
      group: 'help',
      iconName: 'command',
      keywords: ['shortcuts', 'keyboard', 'hotkeys', 'keybindings', 'help', 'cheatsheet'],
      workspaces: ['site'],
      run: async (ctx) => {
        ctx.closeSpotlight()
        const { useEditorStore } = await import('@site/store/store')
        useEditorStore.getState().openSettings('shortcuts')
      },
    },

    {
      id: 'help.copyEnvInfo',
      title: 'Copy environment info',
      subtitle: 'Copy browser, OS, and version info for bug reports',
      group: 'help',
      iconName: 'copy-solid',
      keywords: ['copy', 'environment', 'info', 'debug', 'browser', 'version', 'bug report'],
      workspaces: ['any'],
      run: (ctx) => {
        ctx.closeSpotlight()
        const info = [
          BRAND_NAME,
          `Browser: ${navigator.userAgent}`,
          `Platform: ${navigator.platform}`,
          `URL: ${window.location.href}`,
          `Date: ${new Date().toISOString()}`,
        ].join('\n')
        navigator.clipboard?.writeText(info).catch((_err) => {
          // Clipboard API may be unavailable in non-secure contexts; silently ignore.
        })
      },
    },
  ]
}
