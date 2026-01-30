import Bonjour, { Service } from 'bonjour-service';
import { execSync } from 'child_process';
import * as os from 'os';
import { Config } from './types';
import { getLogger } from './logger';

let bonjour: Bonjour | null = null;
let publishedService: Service | null = null;

const SERVICE_TYPE = 'thoughttraveller';
const VERSION = '1.0.0';

/**
 * Get the local hostname suitable for mDNS/Bonjour.
 * On macOS, uses scutil to get LocalHostName (e.g., "Ryans-MacBook-Pro").
 * Falls back to os.hostname() on other platforms.
 */
function getLocalHostname(): string {
  if (process.platform === 'darwin') {
    try {
      const localHostName = execSync('scutil --get LocalHostName', { encoding: 'utf-8' }).trim();
      if (localHostName) {
        return localHostName;
      }
    } catch {
      // Fall through to default
    }
  }
  // Use os.hostname(), stripping any domain suffix
  return os.hostname().split('.')[0];
}

/**
 * Get the local IPv4 address for the primary network interface.
 * Returns the first non-internal IPv4 address found.
 */
function getLocalIPv4Address(): string | null {
  const interfaces = os.networkInterfaces();

  // Prefer en0 (primary interface on macOS) or eth0 (Linux)
  const preferredInterfaces = ['en0', 'eth0', 'wlan0'];

  for (const name of preferredInterfaces) {
    const iface = interfaces[name];
    if (iface) {
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
  }

  // Fallback: find any non-internal IPv4 address
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (iface) {
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
  }

  return null;
}

export function startBonjourAdvertising(config: Config, protocol: 'http' | 'https'): void {
  if (!config.network.bonjour_enabled) {
    getLogger().info('Bonjour advertising disabled in config');
    return;
  }

  try {
    bonjour = new Bonjour();
    const ipAddress = getLocalIPv4Address();
    const hostname = getLocalHostname();
    // Use LocalHostName with .local suffix for proper mDNS resolution
    const host = `${hostname}.local`;

    const txtRecord: Record<string, string> = {
      id: config.listener.id,
      version: VERSION,
      protocol: protocol,
    };

    // Include IP address - iOS should use this directly to avoid hostname resolution issues
    if (ipAddress) {
      txtRecord.ip = ipAddress;
    }

    publishedService = bonjour.publish({
      name: config.listener.friendly_name,
      type: SERVICE_TYPE,
      port: config.listener.port,
      host: host,
      txt: txtRecord,
    });

    publishedService.on('up', () => {
      const ipInfo = ipAddress ? `, ip: ${ipAddress}` : '';
      getLogger().info(`Bonjour: Advertising as "${config.listener.friendly_name}" on _${SERVICE_TYPE}._tcp (host: ${host}${ipInfo})`);
    });

    publishedService.on('error', (err: Error) => {
      getLogger().warn(`Bonjour advertising error: ${err.message}`);
    });

  } catch (err) {
    getLogger().warn(`Failed to start Bonjour advertising: ${(err as Error).message}`);
  }
}

export function stopBonjourAdvertising(): void {
  try {
    if (publishedService && typeof publishedService.stop === 'function') {
      publishedService.stop();
    }
  } catch (err) {
    // Ignore errors during shutdown
  }
  publishedService = null;

  try {
    if (bonjour && typeof bonjour.destroy === 'function') {
      bonjour.destroy();
    }
  } catch (err) {
    // Ignore errors during shutdown
  }
  bonjour = null;
}

export function isBonjourRunning(): boolean {
  return publishedService !== null;
}
