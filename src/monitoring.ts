import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import { Server as HttpsServer } from 'https';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import * as apn from '@parse/node-apn';
import {
  MonitoringSession,
  MonitoringMessage,
  HandshakePayload,
  HandshakeAckPayload,
  InputRequiredPayload,
  InputResponsePayload,
  Config,
  ApnsConfig,
} from './types';
import { getLogger } from './logger';

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const SESSION_TIMEOUT = 300000; // 5 minutes - keep session for reconnection
const DEFAULT_INPUT_TIMEOUT_MINUTES = 30; // 30 minutes default

// Input detection patterns for common Claude prompts
const INPUT_PATTERNS = [
  { pattern: /choose\s+(\d+)[,\s]+(\d+)[,\s]+or\s+(\d+)/i, type: 'numeric' as const },
  { pattern: /select.*?(\d+)[^\d]+(\d+)[^\d]+(\d+)/i, type: 'numeric' as const },
  { pattern: /option\s*(\d+)[,\s]*(\d+)[,\s]*or\s*(\d+)/i, type: 'numeric' as const },
  { pattern: /\[(\d+)\].*\[(\d+)\].*\[(\d+)\]/i, type: 'numeric' as const },
  { pattern: /continue\?.*?\(y\/n\)/i, type: 'yesno' as const },
  { pattern: /proceed\?.*?\(y\/n\)/i, type: 'yesno' as const },
  { pattern: /\(yes\/no\)/i, type: 'yesno' as const },
  { pattern: /which.*?option/i, type: 'numeric' as const },
];

interface ConnectedClient {
  ws: WebSocket;
  session: MonitoringSession;
  isAlive: boolean;
}

interface PendingInputRequest {
  requestId: string;
  sessionId: string;
  projectTag: string;
  prompt: string;
  options: string[];
  inputType: 'numeric' | 'yesno' | 'text';
  createdAt: Date;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  notifiedDevices: Set<string>; // Track which devices have been notified
  pushedViaApns: Set<string>; // Track which devices received APNs push
}

class MonitoringManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private pendingRequests: Map<string, PendingInputRequest> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private config: Config | null = null;
  private apnsProvider: apn.Provider | null = null;
  private inputTimeoutMs: number = DEFAULT_INPUT_TIMEOUT_MINUTES * 60 * 1000;

  // Store APNs tokens for disconnected devices (persist across reconnects)
  private deviceApnsTokens: Map<string, string> = new Map();

  initialize(server: Server | HttpsServer, config: Config): void {
    this.config = config;
    const logger = getLogger();

    // Configure input timeout from config
    if (config.monitoring?.input_timeout_minutes) {
      this.inputTimeoutMs = config.monitoring.input_timeout_minutes * 60 * 1000;
    }
    logger.info(`Mobile input timeout: ${this.inputTimeoutMs / 60000} minutes`);

    // Initialize APNs provider if configured
    this.initializeApns(config.monitoring?.apns);

    this.wss = new WebSocketServer({ noServer: true });

    // Handle upgrade requests
    server.on('upgrade', (request: IncomingMessage, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      
      if (url.pathname === '/monitor') {
        // Verify auth token from query string
        const token = url.searchParams.get('token');
        if (!token || token !== config.listener.auth_token) {
          logger.warn('Monitoring connection rejected: invalid token');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      this.handleConnection(ws, request);
    });

    // Start heartbeat interval
    this.heartbeatInterval = setInterval(() => {
      this.checkHeartbeats();
    }, HEARTBEAT_INTERVAL);

    logger.info('Monitoring WebSocket server initialized');
  }

  private initializeApns(apnsConfig?: ApnsConfig): void {
    const logger = getLogger();

    if (!apnsConfig?.enabled) {
      logger.info('APNs not enabled - using WebSocket-only notifications');
      return;
    }

    if (!apnsConfig.key_path || !apnsConfig.key_id || !apnsConfig.team_id || !apnsConfig.bundle_id) {
      logger.warn('APNs enabled but missing required configuration (key_path, key_id, team_id, bundle_id)');
      return;
    }

    try {
      this.apnsProvider = new apn.Provider({
        token: {
          key: apnsConfig.key_path,
          keyId: apnsConfig.key_id,
          teamId: apnsConfig.team_id,
        },
        production: apnsConfig.production ?? false,
      });
      logger.info(`APNs provider initialized (${apnsConfig.production ? 'production' : 'sandbox'})`);
    } catch (err) {
      logger.error('Failed to initialize APNs provider', { error: (err as Error).message });
    }
  }

  private async sendApnsPush(deviceToken: string, payload: InputRequiredPayload): Promise<boolean> {
    const logger = getLogger();

    if (!this.apnsProvider || !this.config?.monitoring?.apns?.bundle_id) {
      return false;
    }

    const notification = new apn.Notification();
    notification.expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    notification.badge = 1;
    notification.sound = 'default';
    notification.alert = {
      title: 'Claude Needs Input',
      body: payload.prompt,
    };
    notification.topic = this.config.monitoring.apns.bundle_id;
    notification.payload = {
      sessionId: payload.sessionId,
      projectTag: payload.projectTag,
      options: payload.options,
      inputType: payload.inputType,
    };
    notification.pushType = 'alert';

    try {
      const result = await this.apnsProvider.send(notification, deviceToken);
      if (result.failed.length > 0) {
        logger.warn('APNs push failed', {
          deviceToken: deviceToken.substring(0, 8) + '...',
          reason: result.failed[0]?.response?.reason
        });
        return false;
      }
      logger.info(`APNs push sent to device ${deviceToken.substring(0, 8)}...`);
      return true;
    } catch (err) {
      logger.error('APNs send error', { error: (err as Error).message });
      return false;
    }
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const logger = getLogger();
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const deviceId = url.searchParams.get('deviceId') || 'unknown';
    const deviceName = url.searchParams.get('deviceName') || 'Unknown Device';
    const apnsToken = url.searchParams.get('apnsToken') || undefined;

    logger.info(`Monitoring connection from: ${deviceName} (${deviceId})${apnsToken ? ' with APNs token' : ''}`);

    // Store APNs token for this device (persists across reconnects)
    if (apnsToken) {
      this.deviceApnsTokens.set(deviceId, apnsToken);
    }

    const session: MonitoringSession = {
      deviceId,
      deviceName,
      apnsToken,
      startTime: new Date(),
      lastSeen: new Date(),
      status: 'active',
      reconnectAttempts: 0,
    };

    const client: ConnectedClient = {
      ws,
      session,
      isAlive: true,
    };

    // Check for existing session (reconnection)
    const existingClient = this.clients.get(deviceId);
    if (existingClient) {
      logger.info(`Device reconnected: ${deviceName}`);
      session.startTime = existingClient.session.startTime;
      session.reconnectAttempts = existingClient.session.reconnectAttempts + 1;
      // Preserve APNs token if not provided in new connection
      if (!apnsToken && existingClient.session.apnsToken) {
        session.apnsToken = existingClient.session.apnsToken;
      }
      // Close old connection if still open
      if (existingClient.ws.readyState === WebSocket.OPEN) {
        existingClient.ws.close();
      }
    }

    this.clients.set(deviceId, client);

    // Re-send any pending input requests to the reconnected device
    this.resendPendingRequestsToDevice(deviceId, ws);

    // Send handshake acknowledgment
    const ackPayload: HandshakeAckPayload = {
      listenerId: this.config!.listener.id,
      listenerName: this.config!.listener.friendly_name,
      version: '1.0.0',
      activeSessions: this.clients.size,
    };

    this.sendMessage(ws, {
      type: 'handshake_ack',
      timestamp: new Date().toISOString(),
      payload: ackPayload as unknown as Record<string, unknown>,
    });

    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as MonitoringMessage;
        this.handleMessage(deviceId, message);
      } catch (err) {
        logger.error('Failed to parse monitoring message', { error: (err as Error).message });
      }
    });

    // Handle pong for heartbeat
    ws.on('pong', () => {
      const client = this.clients.get(deviceId);
      if (client) {
        client.isAlive = true;
        client.session.lastSeen = new Date();
        client.session.status = 'active';
      }
    });

    // Handle close
    ws.on('close', () => {
      logger.info(`Monitoring connection closed: ${deviceName}`);
      const client = this.clients.get(deviceId);
      if (client) {
        client.session.status = 'disconnected';
        // Don't remove immediately - allow for reconnection
        setTimeout(() => {
          const currentClient = this.clients.get(deviceId);
          if (currentClient && currentClient.session.status === 'disconnected') {
            this.clients.delete(deviceId);
            logger.info(`Session expired for: ${deviceName}`);
          }
        }, SESSION_TIMEOUT);
      }
    });

    // Handle errors
    ws.on('error', (err) => {
      logger.error(`Monitoring WebSocket error for ${deviceName}`, { error: err.message });
    });
  }

  private handleMessage(deviceId: string, message: MonitoringMessage): void {
    const logger = getLogger();
    const client = this.clients.get(deviceId);

    if (!client) {
      logger.warn(`Message from unknown device: ${deviceId}`);
      return;
    }

    client.session.lastSeen = new Date();

    // Log all non-heartbeat messages for debugging
    if (message.type !== 'heartbeat') {
      logger.info(`← Monitor message from ${client.session.deviceName}: ${message.type}`);
    }

    switch (message.type) {
      case 'handshake':
        // Update device info from handshake
        const handshake = message.payload as unknown as HandshakePayload;
        if (handshake) {
          client.session.deviceName = handshake.deviceName || client.session.deviceName;
        }
        break;

      case 'heartbeat':
        this.sendMessage(client.ws, {
          type: 'heartbeat_ack',
          timestamp: new Date().toISOString(),
        });
        break;

      case 'input_response':
        const inputResponse = message.payload as unknown as InputResponsePayload;
        if (inputResponse?.sessionId) {
          this.handleInputResponse(inputResponse.sessionId, inputResponse.response, client.session.deviceName);
        } else {
          logger.warn('Input response missing sessionId');
        }
        break;

      default:
        logger.debug(`Unknown message type: ${message.type}`);
    }
  }

  private sendMessage(ws: WebSocket, message: MonitoringMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private handleInputResponse(sessionId: string, response: string, deviceName: string): void {
    const logger = getLogger();
    const pendingRequest = this.pendingRequests.get(sessionId);

    if (!pendingRequest) {
      logger.warn(`Input response for unknown session: ${sessionId}`);
      return;
    }

    logger.info(`Input response received from ${deviceName} for session ${sessionId}: "${response}"`);

    // Clear timeout and resolve the promise
    clearTimeout(pendingRequest.timeoutId);
    this.pendingRequests.delete(sessionId);
    pendingRequest.resolve(response);
  }

  private resendPendingRequestsToDevice(deviceId: string, ws: WebSocket): void {
    const logger = getLogger();

    // Find pending requests that haven't been sent to this device yet
    this.pendingRequests.forEach((request) => {
      if (!request.notifiedDevices.has(deviceId)) {
        const payload: InputRequiredPayload = {
          sessionId: request.sessionId,
          projectTag: request.projectTag,
          prompt: request.prompt,
          options: request.options,
          inputType: request.inputType,
        };

        this.sendMessage(ws, {
          type: 'input_required',
          timestamp: new Date().toISOString(),
          payload: payload as unknown as Record<string, unknown>,
        });

        request.notifiedDevices.add(deviceId);
        logger.info(`Re-sent pending input request ${request.sessionId} to reconnected device ${deviceId}`);
      }
    });
  }

  private checkHeartbeats(): void {
    const logger = getLogger();

    this.clients.forEach((client, deviceId) => {
      if (!client.isAlive && client.ws.readyState === WebSocket.OPEN) {
        logger.debug(`Heartbeat timeout for: ${client.session.deviceName}`);
        client.ws.terminate();
        return;
      }

      client.isAlive = false;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    });
  }

  // Public methods for external use

  getActiveSessions(): MonitoringSession[] {
    return Array.from(this.clients.values())
      .filter(c => c.session.status === 'active')
      .map(c => ({ ...c.session }));
  }

  getConnectedDeviceCount(): number {
    return Array.from(this.clients.values())
      .filter(c => c.ws.readyState === WebSocket.OPEN)
      .length;
  }

  getAllSessions(): MonitoringSession[] {
    return Array.from(this.clients.values()).map(c => ({ ...c.session }));
  }

  // Request input from mobile device and wait for response
  // Returns a promise that resolves with the user's response or rejects on timeout/no devices
  async requestMobileInput(
    projectTag: string,
    prompt: string,
    options: string[],
    inputType: 'numeric' | 'yesno' | 'text' = 'numeric',
    timeoutMs?: number
  ): Promise<string> {
    const logger = getLogger();
    const effectiveTimeout = timeoutMs ?? this.inputTimeoutMs;
    const connectedCount = this.getConnectedDeviceCount();
    const hasApnsTokens = this.deviceApnsTokens.size > 0;

    // Allow request if we have connected devices OR APNs tokens for disconnected devices
    if (connectedCount === 0 && !hasApnsTokens) {
      throw new Error('No mobile devices connected for monitoring and no APNs tokens available');
    }

    // Generate unique session ID for this request
    const sessionId = `input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(sessionId);
        reject(new Error(`Mobile input request timed out after ${effectiveTimeout / 1000} seconds`));
      }, effectiveTimeout);

      // Store pending request with tracking sets
      const pendingRequest: PendingInputRequest = {
        requestId: sessionId,
        sessionId,
        projectTag,
        prompt,
        options,
        inputType,
        createdAt: new Date(),
        resolve,
        reject,
        timeoutId,
        notifiedDevices: new Set(),
        pushedViaApns: new Set(),
      };

      this.pendingRequests.set(sessionId, pendingRequest);

      // Notify all connected devices
      const payload: InputRequiredPayload = {
        sessionId,
        projectTag,
        prompt,
        options,
        inputType,
      };

      // Send to connected devices via WebSocket
      this.notifyInputRequired(payload, pendingRequest);

      // Send APNs push to disconnected devices with tokens
      this.sendApnsPushToDisconnectedDevices(payload, pendingRequest);

      logger.info(`Mobile input requested: "${prompt}" (session: ${sessionId}, timeout: ${effectiveTimeout / 1000}s, connected: ${connectedCount}, apns tokens: ${this.deviceApnsTokens.size})`);
    });
  }

  private async sendApnsPushToDisconnectedDevices(
    payload: InputRequiredPayload,
    pendingRequest: PendingInputRequest
  ): Promise<void> {
    const logger = getLogger();

    if (!this.apnsProvider) {
      return;
    }

    // Find devices with APNs tokens that are NOT currently connected
    for (const [deviceId, apnsToken] of this.deviceApnsTokens.entries()) {
      const client = this.clients.get(deviceId);
      const isConnected = client && client.ws.readyState === WebSocket.OPEN;

      if (!isConnected && !pendingRequest.pushedViaApns.has(deviceId)) {
        const success = await this.sendApnsPush(apnsToken, payload);
        if (success) {
          pendingRequest.pushedViaApns.add(deviceId);
          logger.info(`APNs push sent to disconnected device ${deviceId}`);
        }
      }
    }
  }

  // Get pending input request count
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  // Cancel a pending input request
  cancelInputRequest(sessionId: string): boolean {
    const pendingRequest = this.pendingRequests.get(sessionId);
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeoutId);
      this.pendingRequests.delete(sessionId);
      pendingRequest.reject(new Error('Input request cancelled'));
      return true;
    }
    return false;
  }

  // Notify connected devices of input required
  notifyInputRequired(payload: InputRequiredPayload, pendingRequest?: PendingInputRequest): void {
    const logger = getLogger();
    const message: MonitoringMessage = {
      type: 'input_required',
      timestamp: new Date().toISOString(),
      payload: payload as unknown as Record<string, unknown>,
    };

    let notified = 0;
    this.clients.forEach((client, deviceId) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(client.ws, message);
        notified++;
        // Track that we notified this device
        if (pendingRequest) {
          pendingRequest.notifiedDevices.add(deviceId);
        }
      }
    });

    logger.info(`Input required notification sent to ${notified} device(s)`);
  }

  // Notify connected devices of task completion
  notifyTaskComplete(sessionId: string, projectTag: string, summary?: string): void {
    const logger = getLogger();
    const message: MonitoringMessage = {
      type: 'task_complete',
      timestamp: new Date().toISOString(),
      payload: { sessionId, projectTag, summary },
    };

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(client.ws, message);
      }
    });

    logger.info(`Task complete notification sent for session: ${sessionId}`);
  }

  // Detect if text contains input request pattern
  detectInputPattern(text: string): { detected: boolean; type?: 'numeric' | 'yesno' | 'text'; options?: string[] } {
    for (const { pattern, type } of INPUT_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        // Extract options from numeric patterns
        const options = type === 'numeric' 
          ? match.slice(1).filter(Boolean)
          : type === 'yesno' 
            ? ['Yes', 'No']
            : [];
        
        return { detected: true, type, options };
      }
    }
    return { detected: false };
  }

  shutdown(): void {
    const logger = getLogger();

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1001, 'Server shutting down');
      }
    });
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Shutdown APNs provider
    if (this.apnsProvider) {
      this.apnsProvider.shutdown();
      this.apnsProvider = null;
    }

    // Clear pending requests
    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeoutId);
    });
    this.pendingRequests.clear();

    logger.info('Monitoring WebSocket server shutdown');
  }

  // Check if APNs is enabled and configured
  isApnsEnabled(): boolean {
    return this.apnsProvider !== null;
  }

  // Get the configured input timeout in minutes
  getInputTimeoutMinutes(): number {
    return this.inputTimeoutMs / 60000;
  }
}

// Singleton instance
export const monitoringManager = new MonitoringManager();
