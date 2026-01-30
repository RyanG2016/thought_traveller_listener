import { Menu, MenuItem } from 'systray2';
import { Config } from './types';
import { loadConfig, getConfigDir } from './config';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

// Icon (base64 encoded 22x22 PNG)
// Green (#4CAF50) filled circle - matches iOS app color
const ICON_MACOS = 'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWBAMAAAA2mnEIAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAeUExURQAAAEyvUEyvUEyvUEyvUEyvUEyvUEyvUEyvUP///3GaMI8AAAAIdFJOUwAGQ5vjUgPk3JVo8gAAAAFiS0dECfHZpewAAAAHdElNRQfqARcPJS/D235RAAAAX0lEQVQY02NgwA0YlT2cFaHsiA4gCAAzk0HMjuYEENsCzO4wADJZIcyOViBbAsruEGBg0ICxFeDKwRo8YGwHBgYYs6MBSbwAVT2yOcjmI9uL7B4UdyK7H+ivCri/YAAAyxVJKY1ctEMAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDEtMjNUMTU6Mzc6NDcrMDA6MDDuiId2AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTAxLTIzVDE1OjM3OjQ3KzAwOjAwn9U/ygAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wMS0yM1QxNTozNzo0NyswMDowMMjAHhUAAAAASUVORK5CYII=';

const ICON_WINDOWS = ICON_MACOS; // Use same icon for now

export function getIcon(): string {
  return process.platform === 'win32' ? ICON_WINDOWS : ICON_MACOS;
}

// Menu item seq_ids (assigned sequentially by systray2)
export enum MenuId {
  INFO = 0,
  SEP1 = 1,
  START = 2,
  STOP = 3,
  SEP2 = 4,
  SHOW_CONFIG = 5,
  VIEW_LOGS = 6,
  SEP3 = 7,
  EXIT = 8,
}

export function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  let localIP = '127.0.0.1';
  let fallbackIP: string | null = null;

  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (nets) {
      for (const net of nets) {
        if (net.family === 'IPv4' && !net.internal) {
          if (net.address.startsWith('169.254.')) {
            fallbackIP = fallbackIP || net.address;
            continue;
          }
          if (net.address.startsWith('192.168.') ||
              net.address.startsWith('10.') ||
              net.address.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
            return net.address;
          }
          localIP = net.address;
        }
      }
    }
  }

  return localIP !== '127.0.0.1' ? localIP : (fallbackIP || '127.0.0.1');
}

export function buildMenu(isRunning: boolean, config: Config, protocol: 'http' | 'https' | null): Menu {
  const ip = getLocalIP();
  const port = config.listener.port;
  const infoText = isRunning
    ? `${protocol?.toUpperCase() || 'HTTP'}://${ip}:${port}`
    : 'Listener Stopped';

  const menu: Menu = {
    icon: getIcon(),
    title: '',
    tooltip: 'Thought Traveller Listener',
    items: [
      {
        title: infoText,
        tooltip: isRunning ? 'Listener address' : 'Listener is not running',
        enabled: false,
      },
      { title: '-', tooltip: '', enabled: false },
      {
        title: 'Start Listener',
        tooltip: 'Start the listener service',
        enabled: !isRunning,
      },
      {
        title: 'Stop Listener',
        tooltip: 'Stop the listener service',
        enabled: isRunning,
      },
      { title: '-', tooltip: '', enabled: false },
      {
        title: 'Show Config',
        tooltip: 'Open configuration file',
        enabled: true,
      },
      {
        title: 'View Logs',
        tooltip: 'Open log file',
        enabled: true,
      },
      { title: '-', tooltip: '', enabled: false },
      {
        title: 'Exit',
        tooltip: 'Exit Thought Traveller',
        enabled: true,
      },
    ],
  };

  return menu;
}

export function openPath(filePath: string): void {
  let command: string;
  switch (process.platform) {
    case 'darwin':
      command = `open "${filePath}"`;
      break;
    case 'win32':
      command = `start "" "${filePath}"`;
      break;
    default:
      command = `xdg-open "${filePath}"`;
  }

  exec(command, (error: Error | null) => {
    if (error) {
      console.error(`Failed to open path: ${error.message}`);
    }
  });
}

export function openConfigFile(): void {
  const configPath = path.join(getConfigDir(), 'config.json');
  openPath(configPath);
}

export function openLogFile(): void {
  const logPath = path.join(getConfigDir(), 'logs', 'combined.log');
  openPath(logPath);
}
