#!/usr/bin/env node

import SysTray from 'systray2';
import { loadConfig, configExists } from './config';
import { startServer, stopServer, ServerInfo } from './server';
import { initLogger, getLogger } from './logger';
import { startBonjourAdvertising, stopBonjourAdvertising } from './bonjour';
import { buildMenu, openConfigFile, openLogFile, MenuId, getLocalIP } from './tray-menu';
import { Config } from './types';

let systray: SysTray | null = null;
let serverInfo: ServerInfo | null = null;
let currentConfig: Config | null = null;

function isListenerRunning(): boolean {
  return serverInfo !== null;
}

async function startListener(): Promise<void> {
  if (serverInfo) {
    getLogger().info('Listener already running');
    return;
  }

  try {
    currentConfig = loadConfig();
    serverInfo = await startServer(currentConfig);
    startBonjourAdvertising(currentConfig, serverInfo.protocol);
    getLogger().info(`Listener started on port ${currentConfig.listener.port} (${serverInfo.protocol.toUpperCase()})`);
    updateMenuStatus();
  } catch (err) {
    getLogger().error(`Failed to start listener: ${(err as Error).message}`);
    serverInfo = null;
  }
}

async function stopListener(): Promise<void> {
  if (!serverInfo) {
    getLogger().info('Listener not running');
    return;
  }

  try {
    stopBonjourAdvertising();
    await stopServer();
    getLogger().info('Listener stopped');
    serverInfo = null;
    updateMenuStatus();
  } catch (err) {
    getLogger().error(`Failed to stop listener: ${(err as Error).message}`);
  }
}

function quit(): void {
  getLogger().info('Exiting Claude Traveller');

  if (serverInfo) {
    stopBonjourAdvertising();
    stopServer().then(() => {
      if (systray) {
        systray.kill(false);
      }
      process.exit(0);
    });
  } else {
    if (systray) {
      systray.kill(false);
    }
    process.exit(0);
  }
}

function updateMenuStatus(): void {
  if (!systray || !currentConfig) return;

  const running = isListenerRunning();
  const ip = getLocalIP();
  const port = currentConfig.listener.port;
  const protocol = serverInfo?.protocol || 'http';

  const infoText = running
    ? `${protocol.toUpperCase()}://${ip}:${port}`
    : 'Listener Stopped';

  // Update info item
  systray.sendAction({
    type: 'update-item',
    item: {
      title: infoText,
      tooltip: running ? 'Listener address' : 'Listener is not running',
      enabled: false,
    },
    seq_id: MenuId.INFO,
  });

  // Update start button
  systray.sendAction({
    type: 'update-item',
    item: {
      title: 'Start Listener',
      tooltip: 'Start the listener service',
      enabled: !running,
    },
    seq_id: MenuId.START,
  });

  // Update stop button
  systray.sendAction({
    type: 'update-item',
    item: {
      title: 'Stop Listener',
      tooltip: 'Stop the listener service',
      enabled: running,
    },
    seq_id: MenuId.STOP,
  });
}

function handleMenuClick(seqId: number): void {
  switch (seqId) {
    case MenuId.START:
      startListener();
      break;
    case MenuId.STOP:
      stopListener();
      break;
    case MenuId.SHOW_CONFIG:
      openConfigFile();
      break;
    case MenuId.VIEW_LOGS:
      openLogFile();
      break;
    case MenuId.EXIT:
      quit();
      break;
  }
}

async function main(): Promise<void> {
  if (!configExists()) {
    console.error('Configuration not found. Run "claude-traveller init" first.');
    process.exit(1);
  }

  initLogger(true);

  currentConfig = loadConfig();
  const menu = buildMenu(false, currentConfig, null);

  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);

  systray = new SysTray({
    menu,
    debug: false,
    copyDir: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  systray.onReady(() => {
    getLogger().info('System tray ready');
  });

  systray.onError((err: Error) => {
    getLogger().error(`Systray error: ${err.message}`);
  });

  systray.onClick((action) => {
    handleMenuClick(action.seq_id);
  });

  getLogger().info('System tray app started');

  await startListener();
}

main().catch((err) => {
  console.error('Failed to start tray app:', err);
  process.exit(1);
});
