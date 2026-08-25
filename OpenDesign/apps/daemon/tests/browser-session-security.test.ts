import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer, request } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { WEB_CLONE_CDP_METHODS } from '../src/browser-cdp.js';
import { createBrowserNetworkProxy } from '../src/browser-network-proxy.js';
import { assertBrowserNetworkUrl, type BrowserDnsLookup } from '../src/browser-network-policy.js';
import { removeBrowserProfile, terminateBrowserProcess } from '../src/browser-sessions.js';

// Website Clone is a primary UI + od CLI generation path. Its agent runs in a
// sandbox, while the daemon-owned Chrome process has host privileges. These
// tests pin the broker as a strict privilege boundary: no raw/general CDP and
// no file, loopback, private-network, or metadata navigation can cross it.
describe('Website Clone browser broker security boundary', () => {
  it.each([
    'file:///etc/passwd',
    'http://127.0.0.1:3000/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:7456/api/app-config',
  ])('rejects a privileged destination: %s', async (url) => {
    await expect(assertBrowserNetworkUrl(url)).rejects.toThrow();
  });

  it('rejects a public-looking hostname when DNS resolves it into private space', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '10.20.30.40', family: 4 }]) as unknown as BrowserDnsLookup;

    await expect(assertBrowserNetworkUrl('https://attacker.example/private', { lookup }))
      .rejects.toThrow(/private address/);
  });

  it('allows public HTTP(S) destinations after DNS validation', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) as unknown as BrowserDnsLookup;

    await expect(assertBrowserNetworkUrl('https://example.com/', { lookup })).resolves.toBeUndefined();
  });

  it('forces the actual Chromium HTTP connection through the private-address guard', async () => {
    let targetHits = 0;
    const target = createServer((_request, response) => {
      targetHits += 1;
      response.end('secret');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('target did not bind');
    const proxy = await createBrowserNetworkProxy();
    try {
      const response = await requestThroughProxy(proxy.port, `http://127.0.0.1:${address.port}/secret`);
      expect(response.status).toBe(403);
      expect(response.body).toContain('blocked request');
      expect(targetHits).toBe(0);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it('exposes only the CDP methods required by the staged recon adapter', () => {
    expect(WEB_CLONE_CDP_METHODS).toEqual(new Set([
      'Emulation.setDeviceMetricsOverride',
      'Input.dispatchMouseEvent',
      'Network.enable',
      'Network.getCookies',
      'Network.getResponseBody',
      'Page.captureScreenshot',
      'Page.enable',
      'Page.getLayoutMetrics',
      'Page.navigate',
      'Runtime.enable',
      'Runtime.evaluate',
    ]));
    expect(WEB_CLONE_CDP_METHODS.has('Browser.getVersion')).toBe(false);
    expect(WEB_CLONE_CDP_METHODS.has('Fetch.disable')).toBe(false);
    expect(WEB_CLONE_CDP_METHODS.has('Target.createTarget')).toBe(false);
  });
});

async function requestThroughProxy(proxyPort: number, url: string): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const outbound = request({
      headers: { host: new URL(url).host },
      host: '127.0.0.1',
      method: 'GET',
      path: url,
      port: proxyPort,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.once('end', () => resolve({ body, status: response.statusCode ?? 0 }));
    });
    outbound.once('error', reject);
    outbound.end();
  });
}

describe('Website Clone browser process cleanup', () => {
  it('waits for a SIGTERM-resistant browser to exit after SIGKILL before deleting its profile', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: (signal?: NodeJS.Signals | number) => boolean;
      signalCode: NodeJS.Signals | null;
    };
    child.exitCode = null;
    child.signalCode = null;
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    child.kill = (signal) => {
      signals.push(signal);
      if (signal === 'SIGKILL') {
        setTimeout(() => {
          child.exitCode = 137;
          child.signalCode = 'SIGKILL';
          child.emit('exit', 137, 'SIGKILL');
        }, 5);
      }
      return true;
    };
    const removeProfile = vi.fn(async () => {
      expect(child.exitCode).toBe(137);
    });

    await terminateBrowserProcess(
      child as unknown as ChildProcess,
      'locked-profile',
      removeProfile,
      { forcedMs: 50, gracefulMs: 1 },
    );

    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(removeProfile).toHaveBeenCalledWith('locked-profile');
  });

  it('retries transient Windows-style profile deletion failures with bounded backoff', async () => {
    const locked = Object.assign(new Error('file is locked'), { code: 'EPERM' });
    const remove = vi.fn()
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(locked)
      .mockResolvedValueOnce(undefined);
    const delay = vi.fn().mockResolvedValue(undefined);

    await removeBrowserProfile('profile', remove, delay);

    expect(remove).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenNthCalledWith(1, 100);
    expect(delay).toHaveBeenNthCalledWith(2, 200);
  });
});
