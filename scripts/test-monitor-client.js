#!/usr/bin/env node
/**
 * Test client that simulates an iOS device connecting to the monitoring WebSocket.
 * Use this to test the monitoring flow before the iOS app is ready.
 * 
 * Usage:
 *   node scripts/test-monitor-client.js
 *   node scripts/test-monitor-client.js --auto-respond 2
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load config
const configPath = path.join(process.env.HOME, '.claude-traveller', 'config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (err) {
  console.error('Error: Could not load config from', configPath);
  console.error('Make sure claude-traveller is initialized: claude-traveller init');
  process.exit(1);
}

const port = config.listener.port;
const token = config.listener.auth_token;
const useTls = config.network?.tls?.enabled || false;
const deviceId = 'test-device-' + Date.now();
const deviceName = 'Test Device (CLI)';

// Parse args
const args = process.argv.slice(2);
const autoRespondIndex = args.indexOf('--auto-respond');
const autoResponse = autoRespondIndex >= 0 ? args[autoRespondIndex + 1] : null;

// Determine protocol
const protocol = useTls ? 'wss' : 'ws';

console.log('');
console.log('╔════════════════════════════════════════════╗');
console.log('║   Claude Traveller - Test Monitor Client   ║');
console.log('╚════════════════════════════════════════════╝');
console.log('');
console.log(`Connecting to ${protocol}://localhost:${port}/monitor`);
console.log(`TLS: ${useTls ? 'enabled' : 'disabled'}`);
console.log(`Device ID: ${deviceId}`);
console.log(`Device Name: ${deviceName}`);
if (autoResponse) {
  console.log(`Auto-respond mode: Will respond "${autoResponse}" to all input requests`);
}
console.log('');

// Build WebSocket URL
const wsUrl = `${protocol}://localhost:${port}/monitor?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(deviceId)}&deviceName=${encodeURIComponent(deviceName)}`;

// WebSocket options - reject unauthorized false for self-signed certs
const wsOptions = useTls ? { rejectUnauthorized: false } : {};

const ws = new WebSocket(wsUrl, wsOptions);

let heartbeatInterval;
let rl;

ws.on('open', () => {
  console.log('✓ Connected to listener');
  console.log('');
  console.log('Waiting for messages... (Ctrl+C to exit)');
  console.log('─'.repeat(50));
  console.log('');

  // Start heartbeat
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString()
      }));
    }
  }, 25000);

  // Set up readline for manual responses if not auto-responding
  if (!autoResponse) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'handshake_ack':
        console.log('← Handshake acknowledged');
        console.log(`  Listener: ${message.payload.listenerName} (${message.payload.listenerId})`);
        console.log(`  Version: ${message.payload.version}`);
        console.log(`  Active sessions: ${message.payload.activeSessions}`);
        console.log('');
        break;

      case 'heartbeat_ack':
        // Silent - just confirms connection is alive
        break;

      case 'input_required':
        console.log('');
        console.log('╔════════════════════════════════════════════╗');
        console.log('║          INPUT REQUIRED                     ║');
        console.log('╚════════════════════════════════════════════╝');
        console.log('');
        console.log(`  Session: ${message.payload.sessionId}`);
        console.log(`  Project: ${message.payload.projectTag}`);
        console.log(`  Type: ${message.payload.inputType}`);
        console.log('');
        console.log(`  Prompt: "${message.payload.prompt}"`);
        console.log('');
        if (message.payload.options && message.payload.options.length > 0) {
          console.log(`  Options: [${message.payload.options.join(', ')}]`);
          console.log('');
        }

        if (autoResponse) {
          // Auto-respond
          console.log(`  Auto-responding with: "${autoResponse}"`);
          sendResponse(message.payload.sessionId, autoResponse);
        } else {
          // Prompt for manual response
          rl.question('  Enter your response: ', (answer) => {
            sendResponse(message.payload.sessionId, answer.trim());
          });
        }
        break;

      case 'task_complete':
        console.log('');
        console.log('← Task complete notification');
        console.log(`  Session: ${message.payload.sessionId}`);
        console.log(`  Project: ${message.payload.projectTag}`);
        if (message.payload.summary) {
          console.log(`  Summary: ${message.payload.summary}`);
        }
        console.log('');
        break;

      default:
        console.log('← Unknown message type:', message.type);
        console.log('  Payload:', JSON.stringify(message.payload, null, 2));
    }
  } catch (err) {
    console.error('Error parsing message:', err.message);
  }
});

ws.on('close', (code, reason) => {
  console.log('');
  console.log(`Connection closed (code: ${code})`);
  if (reason) console.log(`Reason: ${reason}`);
  cleanup();
  process.exit(0);
});

ws.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    console.error('✗ Connection refused - is the listener running?');
    console.error('  Start it with: claude-traveller start');
  } else {
    console.error('WebSocket error:', err.message);
  }
  cleanup();
  process.exit(1);
});

function sendResponse(sessionId, response) {
  const message = {
    type: 'input_response',
    timestamp: new Date().toISOString(),
    payload: {
      sessionId: sessionId,
      response: response
    }
  };
  
  ws.send(JSON.stringify(message));
  console.log(`  → Sent response: "${response}"`);
  console.log('');
  console.log('─'.repeat(50));
  console.log('');
  console.log('Waiting for more messages...');
}

function cleanup() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  if (rl) {
    rl.close();
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('');
  console.log('Disconnecting...');
  ws.close();
});
