/**
 * The connector execution allowlist does not grow itself by default (E2).
 *
 * `ConnectorCatalog` used to union the static `allowedToolNames` with every live
 * tool whose `refreshEligible` was true — and that is decided by regex-matching
 * the tool's NAME, SCOPES and DESCRIPTION, every one of them a string the remote
 * provider supplies, for a tool the static catalog never listed. So the set of
 * executable tools was partly the provider's to choose.
 *
 * Two existing behaviours keep that from being a hole and neither is changed
 * here: the classifier defaults to `write`/`confirm` when safety "could not be
 * proven read-only", and `ConnectorService.execute` re-derives safety at call
 * time. But both read the SAME provider strings, so they are defence in depth
 * against the classifier rather than independent of it — a write-capable tool
 * named and described like a read passes both.
 *
 * Hence: opt-in, off by default, with the static catalog as the baseline.
 */
import { describe, expect, it } from 'vitest';
import { connectorAutoAllowEnabled, CONNECTOR_AUTO_ALLOW_ENV } from '../src/connectors/composio.js';

describe('connectorAutoAllowEnabled', () => {
  it('is OFF when unset — the default must not widen anything', () => {
    expect(connectorAutoAllowEnabled({})).toBe(false);
  });

  it('is OFF for empty, false and 0', () => {
    for (const value of ['', 'false', '0', 'off', 'no']) {
      expect(connectorAutoAllowEnabled({ [CONNECTOR_AUTO_ALLOW_ENV]: value })).toBe(false);
    }
  });

  it('is OFF for anything unrecognised, rather than truthy-on', () => {
    // A flag that WIDENS permissions must only do so when switched on
    // unambiguously. `Boolean('maybe')` would have been true.
    for (const value of ['maybe', 'enabled-ish', ' ', 'TRUEISH']) {
      expect(connectorAutoAllowEnabled({ [CONNECTOR_AUTO_ALLOW_ENV]: value })).toBe(false);
    }
  });

  it('is ON only for an explicit affirmative', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
      expect(connectorAutoAllowEnabled({ [CONNECTOR_AUTO_ALLOW_ENV]: value })).toBe(true);
    }
  });
});
