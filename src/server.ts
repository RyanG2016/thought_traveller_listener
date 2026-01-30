import express, { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { Server } from 'http';
import {
  Config,
  ConversationPayload,
  HealthResponse,
  ProjectsResponse,
  ProjectStatus,
  ConversationSuccessResponse,
  ErrorResponse,
  BriefResponse,
  BriefGeneratorPromptResponse,
  NotePayload,
  NoteSuccessResponse,
  MonitoringStatusResponse,
  InputRequestPayload,
  InputRequestResponse,
  InputRequestErrorResponse,
} from './types';
import { monitoringManager } from './monitoring';
import {
  loadConfig,
  loadConversationsIndex,
  saveConversationsIndex,
  loadNotesIndex,
  saveNotesIndex,
  validateProjectPath,
  resolvePath,
  projectHasBrief,
  loadProjectBrief,
  loadBriefGeneratorPrompt,
} from './config';
import { saveConversation, saveNote } from './markdown';
import { getLogger } from './logger';

const VERSION = '1.0.0';
let startTime: number;
let server: Server | null = null;
let currentConfig: Config | null = null;

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do comparison to avoid timing leak on length check
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const response: ErrorResponse = { error: 'Invalid or missing auth token' };
    res.status(401).json(response);
    return;
  }

  const token = authHeader.slice(7);
  const config = currentConfig || loadConfig();

  if (!config.listener.auth_token) {
    const response: ErrorResponse = { error: 'Auth token not configured on listener' };
    res.status(500).json(response);
    return;
  }

  if (!constantTimeCompare(token, config.listener.auth_token)) {
    getLogger().warn('Authentication failed: invalid token');
    const response: ErrorResponse = { error: 'Invalid or missing auth token' };
    res.status(401).json(response);
    return;
  }

  next();
}

function getProjectStatuses(config: Config): ProjectStatus[] {
  return config.projects.map((project) => {
    const validation = validateProjectPath(project.path);
    return {
      tag: project.tag,
      name: project.name,
      available: validation.valid,
      hasBrief: projectHasBrief(project),
      ...(validation.error && { error: validation.error }),
    };
  });
}

export function createApp(config: Config): express.Application {
  currentConfig = config;
  const app = express();
  const logger = getLogger();

  app.use(express.json({ limit: '10mb' }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip health checks to reduce noise
    if (req.path !== '/health') {
      logger.info(`← ${req.method} ${req.path}`);
    }
    next();
  });

  // Health endpoint - no auth required
  app.get('/health', (_req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const response: HealthResponse = {
      status: 'healthy',
      version: VERSION,
      listener_id: config.listener.id,
      uptime,
    };
    res.json(response);
  });

  // Projects endpoint - auth required
  app.get('/projects', authMiddleware, (_req: Request, res: Response) => {
    logger.info(`→ Projects list (${config.projects.length} projects)`);

    const response: ProjectsResponse = {
      projects: getProjectStatuses(config),
    };
    res.json(response);
  });

  // Project brief endpoint - auth required
  app.get('/projects/:tag/brief', authMiddleware, (req: Request, res: Response) => {
    const { tag } = req.params;

    const project = config.projects.find((p) => p.tag === tag);
    if (!project) {
      logger.warn(`→ Brief not found: unknown project "${tag}"`);
      const response: ErrorResponse = { error: `Unknown project tag: ${tag}` };
      res.status(404).json(response);
      return;
    }

    if (!project.briefFile) {
      logger.warn(`→ Brief not configured for "${tag}"`);
      const response: ErrorResponse = { error: `Brief not configured for project: ${tag}` };
      res.status(404).json(response);
      return;
    }

    const briefData = loadProjectBrief(project);
    if (!briefData) {
      logger.warn(`→ Brief file missing for "${tag}"`);
      const response: ErrorResponse = {
        error: `Brief file not found for project: ${tag}`,
        details: `Configured path: ${project.briefFile}`,
      };
      res.status(404).json(response);
      return;
    }

    const sizeKb = (briefData.content.length / 1024).toFixed(1);
    logger.info(`→ Brief sent: ${tag} (${sizeKb} KB)`);

    const response: BriefResponse = {
      tag: project.tag,
      name: project.name,
      brief: briefData.content,
      lastModified: briefData.lastModified.toISOString(),
    };
    res.json(response);
  });

  // Brief generator prompt endpoint - auth required
  app.get('/brief-generator-prompt', authMiddleware, (_req: Request, res: Response) => {
    const prompt = loadBriefGeneratorPrompt();
    if (!prompt) {
      logger.warn('→ Brief generator prompt not found');
      const response: ErrorResponse = { error: 'Brief generator prompt not found' };
      res.status(404).json(response);
      return;
    }

    logger.info('→ Brief generator prompt sent');

    const response: BriefGeneratorPromptResponse = {
      prompt,
    };
    res.json(response);
  });

  // Conversation endpoint - auth required
  app.post('/conversation', authMiddleware, (req: Request, res: Response) => {
    try {
      const payload = req.body as ConversationPayload;

      // Validate required fields
      if (!payload.conversation_id || !payload.project_tag || !payload.conversation?.messages) {
        const response: ErrorResponse = { error: 'Missing required fields' };
        res.status(400).json(response);
        return;
      }

      // Find project
      const project = config.projects.find((p) => p.tag === payload.project_tag);
      if (!project) {
        const response: ErrorResponse = { error: `Unknown project tag: ${payload.project_tag}` };
        res.status(400).json(response);
        return;
      }

      // Validate project path
      const validation = validateProjectPath(project.path);
      if (!validation.valid) {
        const response: ErrorResponse = {
          error: 'Project path unavailable',
          project: project.tag,
          details: `${validation.error}: ${resolvePath(project.path)}`,
        };
        res.status(400).json(response);
        return;
      }

      // Load conversation index
      const index = loadConversationsIndex();
      const existingEntry = index[payload.conversation_id];
      const existingFilePath = existingEntry?.file_path || null;

      // Save conversation
      const result = saveConversation(
        payload,
        project,
        existingFilePath,
        config.export.create_directories
      );

      // Update conversation index
      index[payload.conversation_id] = {
        project_tag: payload.project_tag,
        file_path: result.path,
        created_at: existingEntry?.created_at || payload.timestamp,
        last_updated: payload.timestamp,
        message_count: payload.conversation.messages.length,
      };
      saveConversationsIndex(index);

      // Log success
      const msgCount = payload.conversation.messages.length;
      if (result.action === 'created') {
        logger.info(`→ Conversation saved: ${project.tag}/${result.file} (${msgCount} messages)`);
      } else {
        logger.info(`→ Conversation updated: ${project.tag} (+${result.messages_added} messages, ${msgCount} total)`);
      }

      const response: ConversationSuccessResponse = {
        success: true,
        action: result.action,
        file: result.file,
        path: result.path,
        ...(result.messages_added !== undefined && { messages_added: result.messages_added }),
      };

      res.status(result.action === 'created' ? 201 : 200).json(response);
    } catch (err) {
      logger.error('Error processing conversation', { error: (err as Error).message });
      const response: ErrorResponse = { error: 'Internal server error' };
      res.status(500).json(response);
    }
  });

  // Note endpoint - auth required
  app.post('/note', authMiddleware, (req: Request, res: Response) => {
    try {
      const payload = req.body as NotePayload;

      // Validate required fields
      if (!payload.note_id) {
        const response: ErrorResponse = { error: 'Missing required field: note_id' };
        res.status(400).json(response);
        return;
      }
      if (!payload.project_tag) {
        const response: ErrorResponse = { error: 'Missing required field: project_tag' };
        res.status(400).json(response);
        return;
      }
      if (!payload.content) {
        const response: ErrorResponse = { error: 'Missing required field: content' };
        res.status(400).json(response);
        return;
      }

      // Default type to 'note' if not specified
      if (!payload.type) {
        payload.type = 'note';
      }

      // Validate type
      if (payload.type !== 'note' && payload.type !== 'todo') {
        const response: ErrorResponse = { error: 'Invalid type: must be "note" or "todo"' };
        res.status(400).json(response);
        return;
      }

      // Find project
      const project = config.projects.find((p) => p.tag === payload.project_tag);
      if (!project) {
        const response: ErrorResponse = { error: `Unknown project tag: ${payload.project_tag}` };
        res.status(400).json(response);
        return;
      }

      // Validate project path
      const validation = validateProjectPath(project.path);
      if (!validation.valid) {
        const response: ErrorResponse = {
          error: 'Project path unavailable',
          project: project.tag,
          details: `${validation.error}: ${resolvePath(project.path)}`,
        };
        res.status(400).json(response);
        return;
      }

      // Save note
      const result = saveNote(payload, project, config.export.create_directories);

      // Update notes index
      const index = loadNotesIndex();
      index[payload.note_id] = {
        project_tag: payload.project_tag,
        file_path: result.path,
        type: payload.type,
        title: payload.title,
        created_at: payload.timestamp,
        completed: payload.completed,
      };
      saveNotesIndex(index);

      // Log success
      const typeLabel = payload.type === 'todo' ? 'Todo' : 'Note';
      logger.info(`→ ${typeLabel} saved: ${project.tag}/${result.file}`);

      const response: NoteSuccessResponse = {
        success: true,
        action: 'created',
        file: result.file,
        path: result.path,
        type: payload.type,
      };

      res.status(201).json(response);
    } catch (err) {
      logger.error('Error processing note', { error: (err as Error).message });
      const response: ErrorResponse = { error: 'Internal server error' };
      res.status(500).json(response);
    }
  });

  // Monitoring status endpoint - auth required
  app.get('/monitor/status', authMiddleware, (_req: Request, res: Response) => {
    const sessions = monitoringManager.getAllSessions();
    const connectedDevices = monitoringManager.getConnectedDeviceCount();
    const apnsEnabled = monitoringManager.isApnsEnabled();
    const inputTimeoutMinutes = monitoringManager.getInputTimeoutMinutes();
    const pendingRequests = monitoringManager.getPendingRequestCount();

    logger.info(`→ Monitor status (${connectedDevices} connected, APNs: ${apnsEnabled ? 'yes' : 'no'})`);

    const response = {
      monitoring: {
        enabled: true,
        activeSessions: sessions,
        connectedDevices,
        apnsEnabled,
        inputTimeoutMinutes,
        pendingRequests,
      },
    };
    res.json(response);
  });

  // Input request endpoint - for Claude Code to request mobile input
  // This endpoint blocks until a response is received or timeout
  app.post('/input-request', authMiddleware, async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const payload = req.body as InputRequestPayload;

      // Validate required fields
      if (!payload.prompt) {
        const response: InputRequestErrorResponse = {
          success: false,
          error: 'Missing required field: prompt',
          connected_devices: monitoringManager.getConnectedDeviceCount(),
        };
        res.status(400).json(response);
        return;
      }

      const connectedDevices = monitoringManager.getConnectedDeviceCount();
      const apnsEnabled = monitoringManager.isApnsEnabled();

      // Note: With APNs enabled, we can still send push notifications even with no connected devices
      // The requestMobileInput method handles this case

      // Set defaults
      const projectTag = payload.project_tag || 'unknown';
      const options = payload.options || [];
      const inputType = payload.input_type || (options.length > 0 ? 'numeric' : 'text');
      const timeoutMs = payload.timeout_seconds ? payload.timeout_seconds * 1000 : undefined; // Use configured default

      logger.info(`← Input request: "${payload.prompt}" (${connectedDevices} connected, APNs: ${apnsEnabled ? 'yes' : 'no'})`);

      // Request input from mobile and wait for response
      const userResponse = await monitoringManager.requestMobileInput(
        projectTag,
        payload.prompt,
        options,
        inputType,
        timeoutMs
      );

      const responseTimeMs = Date.now() - startTime;
      logger.info(`→ Input response received: "${userResponse}" (${responseTimeMs}ms)`);

      const response: InputRequestResponse = {
        success: true,
        response: userResponse,
        responded_by: 'mobile',
        response_time_ms: responseTimeMs,
      };

      res.json(response);
    } catch (err) {
      const error = err as Error;
      logger.error('Input request failed', { error: error.message });

      const response: InputRequestErrorResponse = {
        success: false,
        error: error.message,
        connected_devices: monitoringManager.getConnectedDeviceCount(),
      };

      // Use 504 for timeout, 503 for no devices
      const statusCode = error.message.includes('timed out') ? 504 : 503;
      res.status(statusCode).json(response);
    }
  });

  return app;
}

export interface ServerInfo {
  server: Server | https.Server;
  protocol: 'http' | 'https';
}

export function startServer(config: Config): Promise<ServerInfo> {
  return new Promise((resolve, reject) => {
    startTime = Date.now();
    const app = createApp(config);
    const logger = getLogger();

    const tlsConfig = config.network.tls;
    const useHttps = tlsConfig.enabled &&
      fs.existsSync(tlsConfig.cert_path) &&
      fs.existsSync(tlsConfig.key_path);

    if (useHttps) {
      const httpsOptions: https.ServerOptions = {
        key: fs.readFileSync(tlsConfig.key_path),
        cert: fs.readFileSync(tlsConfig.cert_path),
      };

      server = https.createServer(httpsOptions, app);
      server.listen(config.listener.port, () => {
        logger.info(`Listener started on port ${config.listener.port} (HTTPS)`);
        // Initialize monitoring WebSocket server
        monitoringManager.initialize(server!, config);
        resolve({ server: server!, protocol: 'https' });
      });
    } else {
      server = http.createServer(app);
      server.listen(config.listener.port, () => {
        logger.info(`Listener started on port ${config.listener.port} (HTTP)`);
        // Initialize monitoring WebSocket server
        monitoringManager.initialize(server!, config);
        resolve({ server: server!, protocol: 'http' });
      });
    }

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${config.listener.port} is already in use`));
      } else {
        reject(err);
      }
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    // Shutdown monitoring first
    monitoringManager.shutdown();

    if (server) {
      const logger = getLogger();
      logger.info('Listener stopped gracefully');
      server.close(() => {
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export function getServer(): Server | null {
  return server;
}

export { VERSION };
