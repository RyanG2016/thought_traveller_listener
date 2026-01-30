export interface ListenerConfig {
  id: string;
  port: number;
  auth_token: string;
  friendly_name: string;
}

export interface ProjectConfig {
  tag: string;
  name: string;
  path: string;
  briefFile?: string; // Optional path to PROJECT_BRIEF.md
}

export interface ExportConfig {
  format: 'markdown' | 'json';
  filename_pattern: string;
  create_directories: boolean;
}

export interface TlsConfig {
  enabled: boolean;
  cert_path: string;
  key_path: string;
}

export interface NetworkConfig {
  upnp_enabled: boolean;
  bonjour_enabled: boolean;
  tls: TlsConfig;
}

export interface BriefsConfig {
  generator_prompt_file: string;
}

export interface ApnsConfig {
  enabled: boolean;
  key_path?: string;      // Path to .p8 file
  key_id?: string;        // From Apple Developer portal
  team_id?: string;       // Apple Developer Team ID
  bundle_id?: string;     // App bundle identifier
  production?: boolean;   // true for App Store, false for development
}

export interface MonitoringConfig {
  input_timeout_minutes: number;  // Default 30 minutes
  apns?: ApnsConfig;
}

export interface Config {
  listener: ListenerConfig;
  projects: ProjectConfig[];
  export: ExportConfig;
  network: NetworkConfig;
  briefs: BriefsConfig;
  monitoring?: MonitoringConfig;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ConversationPayload {
  version: string;
  conversation_id: string;
  is_continuation: boolean;
  previous_message_count: number;
  timestamp: string;
  project_tag: string;
  filename?: string; // Optional: if provided, use this filename instead of auto-generating
  conversation: {
    messages: Message[];
  };
  metadata: {
    device: string;
    app_version: string;
    ios_version: string;
  };
}

export interface ConversationIndex {
  [conversationId: string]: {
    project_tag: string;
    file_path: string;
    created_at: string;
    last_updated: string;
    message_count: number;
  };
}

export interface ProjectStatus {
  tag: string;
  name: string;
  available: boolean;
  hasBrief: boolean;
  error?: string;
}

export interface HealthResponse {
  status: 'healthy';
  version: string;
  listener_id: string;
  uptime: number;
}

export interface ProjectsResponse {
  projects: ProjectStatus[];
}

export interface ConversationSuccessResponse {
  success: true;
  action: 'created' | 'appended';
  file: string;
  path: string;
  messages_added?: number;
}

export interface ErrorResponse {
  error: string;
  project?: string;
  details?: string;
}

export interface BriefResponse {
  tag: string;
  name: string;
  brief: string;
  lastModified: string;
}

export interface BriefGeneratorPromptResponse {
  prompt: string;
}

// Note/Todo types
export type NoteType = 'note' | 'todo';

export interface NotePayload {
  version: string;
  note_id: string;
  type: NoteType;
  project_tag: string;
  title?: string;
  content: string;
  timestamp: string;
  priority?: 'low' | 'medium' | 'high'; // for todos
  completed?: boolean; // for todos
  metadata: {
    device: string;
    app_version: string;
    ios_version: string;
  };
}

export interface NoteIndexEntry {
  project_tag: string;
  file_path: string;
  type: NoteType;
  title?: string;
  created_at: string;
  completed?: boolean;
}

export interface NotesIndex {
  [noteId: string]: NoteIndexEntry;
}

export interface NoteSuccessResponse {
  success: true;
  action: 'created';
  file: string;
  path: string;
  type: NoteType;
}

// Monitoring types for bidirectional communication

export enum MonitoringState {
  OFF = 'off',
  DISCOVERING = 'discovering',
  CONNECTING = 'connecting',
  ACTIVE = 'active',
  RECONNECTING = 'reconnecting',
  UNAVAILABLE = 'unavailable',
}

export interface MonitoringSession {
  deviceId: string;
  deviceName: string;
  apnsToken?: string;  // APNs device token for push notifications
  startTime: Date;
  lastSeen: Date;
  status: 'active' | 'disconnected';
  reconnectAttempts: number;
}

export interface AwaitingInput {
  prompt: string;
  options: string[];
  timestamp: Date;
  sessionId: string;
}

export interface ActiveSession {
  sessionId: string;
  projectTag: string;
  deviceId: string;
  status: 'active' | 'awaiting_input' | 'completed';
  lastActivity: Date;
  awaitingInput?: AwaitingInput;
}

// WebSocket message types
export type MonitoringMessageType =
  | 'handshake'
  | 'handshake_ack'
  | 'heartbeat'
  | 'heartbeat_ack'
  | 'input_required'
  | 'input_response'
  | 'task_complete'
  | 'session_update'
  | 'error';

export interface MonitoringMessage {
  type: MonitoringMessageType;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface HandshakePayload {
  deviceId: string;
  deviceName: string;
  appVersion: string;
}

export interface HandshakeAckPayload {
  listenerId: string;
  listenerName: string;
  version: string;
  activeSessions: number;
}

export interface InputRequiredPayload {
  sessionId: string;
  projectTag: string;
  prompt: string;
  options: string[];
  inputType: 'numeric' | 'yesno' | 'text';
}

export interface InputResponsePayload {
  sessionId: string;
  response: string;
}

export interface TaskCompletePayload {
  sessionId: string;
  projectTag: string;
  summary?: string;
}

export interface MonitoringStatusResponse {
  monitoring: {
    enabled: boolean;
    activeSessions: MonitoringSession[];
    connectedDevices: number;
  };
}

// Input request types for Claude Code integration
export interface InputRequestPayload {
  project_tag?: string;
  prompt: string;
  options?: string[];
  input_type?: 'numeric' | 'yesno' | 'text';
  timeout_seconds?: number;
}

export interface InputRequestResponse {
  success: true;
  response: string;
  responded_by: string;
  response_time_ms: number;
}

export interface InputRequestErrorResponse {
  success: false;
  error: string;
  connected_devices: number;
}
