import type { EditorStoreSliceCreator } from '@site/store/types'
import type { AiToolOutput, AiUserContentBlock } from '@core/ai'
import type { ConversationView } from '@admin/ai/api'
import type { AgentMessage, AgentToolScope } from './types'

export interface AgentSliceConfig {
  /**
   * Conversation scope. Used in URL paths (`/cms/api/ai/chat/${scope}`,
   * `?scope=${scope}`), conversation-create body, and the per-scope default
   * lookup. Keep it aligned with `server/ai/runtime/types.ts → ToolScope`.
   */
  readonly scope: AgentToolScope
  /**
   * Build the per-request snapshot. The slice has no knowledge of the host
   * store's shape; the config closure pulls from whatever store the host
   * mounted the agent in.
   */
  buildSnapshot(): unknown
  /**
   * Dispatch a write-tool request. The slice forwards the server's
   * `toolRequest` event to this function and POSTs the result back.
   */
  dispatchTool(toolName: string, input: unknown): Promise<AiToolOutput>
  /**
   * Optional copy override for the "no AI provider configured" error so
   * each scope can point the user at the right /admin/ai page.
   */
  readonly noProviderMessage?: string
}

/**
 * Usage attached to the active conversation.
 *
 * `contextTokens` is the latest provider round's input size, while the other
 * fields are cumulative billing totals across every round in the conversation.
 * Keeping both in one snapshot makes that distinction explicit at call sites.
 */
export interface AgentConversationUsage {
  contextTokens: number | null
  /** Selection that produced `contextTokens`; null until the first measured round. */
  contextCredentialId: string | null
  contextModelId: string | null
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
}

export interface AgentSlice {
  isAgentOpen: boolean
  isAgentStreaming: boolean
  agentMessages: AgentMessage[]
  agentError: string | null
  agentConversationId: string | null
  agentActiveCredentialId: string | null
  agentActiveModelId: string | null
  agentConversations: ConversationView[]
  agentUsage: AgentConversationUsage
  /** True while a history load/delete can replace the active conversation. */
  isAgentConversationPending: boolean
  /** True while an existing conversation's provider/model update is pending. */
  isAgentProviderPending: boolean
  /** Remounts local composer drafts on explicit conversation replacement. */
  agentComposerEpoch: number
  /**
   * Text queued for the composer from outside it — currently the canvas /
   * Layers "Edit with AI" action, which names the block the author picked.
   *
   * Naming the target matters: without it the model has to infer which section
   * a prompt refers to, and a wrong guess edits the wrong part of the page.
   * The composer drains this and clears it, so it is a one-shot handoff rather
   * than a second source of truth for the draft.
   */
  agentComposerSeed: string | null

  openAgent(): void
  closeAgent(): void
  /** Queue a mention (and open the assistant) — see `agentComposerSeed`. */
  seedAgentComposer(text: string): void
  /** Called by the composer once it has taken the seed. */
  consumeAgentComposerSeed(): void
  toggleAgent(): void
  sendAgentMessage(content: AiUserContentBlock[]): Promise<{ accepted: boolean }>
  abortAgent(): void
  clearAgentMessages(): void
  loadAgentConversations(): Promise<void>
  loadAgentConversation(id: string): Promise<void>
  startNewAgentConversation(): void
  deleteAgentConversation(id: string): Promise<void>
  setAgentProvider(credentialId: string, modelId: string): Promise<void>
  loadScopeDefault(): Promise<void>
}

export type EditorStoreSet = Parameters<EditorStoreSliceCreator<AgentSlice>>[0]
export type AgentSliceGet = Parameters<EditorStoreSliceCreator<AgentSlice>>[1]
