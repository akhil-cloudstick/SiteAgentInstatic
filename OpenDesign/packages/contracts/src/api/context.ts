export interface RunContextSelection {
  skillIds?: string[];
  pluginIds?: string[];
  mcpServerIds?: string[];
  connectorIds?: string[];
  workspaceItems?: WorkspaceContextItem[];
  /**
   * Extra instruction text appended to the model's request but NOT shown in the
   * chat as the user's message. OD chat has no hidden/system field, so this is
   * the one channel for "tenant sees a short line; the agent gets more detail".
   * Used by the Share-to-CMS "Fix it" button: the visible bubble stays a short,
   * reassuring sentence while the agent privately receives the exact compliance
   * failures + fix directives. Keep it short and self-contained.
   */
  agentInstruction?: string;
}

export type WorkspaceContextKind =
  | 'design-files'
  | 'design-system'
  | 'file'
  | 'folder'
  | 'project'
  | 'local-code'
  | 'browser'
  | 'terminal'
  | 'side-chat'
  | 'live-artifact';

export interface WorkspaceContextItem {
  id: string;
  kind: WorkspaceContextKind;
  label: string;
  tabId?: string;
  path?: string;
  absolutePath?: string;
  url?: string;
  title?: string;
}

export interface ProjectContextPluginRef {
  id: string;
  title: string;
  description?: string;
}

export interface ProjectContextMcpServerRef {
  id: string;
  label?: string;
  transport?: string;
  url?: string;
  command?: string;
}

export interface ProjectContextConnectorRef {
  id: string;
  name: string;
  provider?: string;
  category?: string;
  description?: string;
  status?: string;
  accountLabel?: string;
}
