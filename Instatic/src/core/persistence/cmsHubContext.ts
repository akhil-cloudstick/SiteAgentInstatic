/**
 * Product Hub context — client adapter.
 *
 * Reads the authorized scope the current session was opened with from
 * `GET /cms/api/cms/hub-context`. `null` means this install is not running
 * behind a Product Hub (or the session was opened by a local login), which is
 * the normal case for a self-hosted deployment.
 */
import { apiRequest } from '@core/http'
import { HubContextEnvelopeSchema, type HubContext } from '@core/hubContext'

export async function fetchCmsHubContext(
  basePath = '/cms/api/cms',
): Promise<HubContext | null> {
  const body = await apiRequest(`${basePath}/hub-context`, {
    schema: HubContextEnvelopeSchema,
  })
  return body.hubContext
}
