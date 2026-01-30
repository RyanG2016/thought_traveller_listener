import * as fs from 'fs';
import * as path from 'path';
import { ConversationPayload, Message, ProjectConfig, NotePayload } from './types';
import { resolvePath } from './config';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateTime(isoString: string): string {
  return `${formatDate(isoString)} at ${formatTime(isoString)}`;
}

function formatMessageTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function generateFilename(payload: ConversationPayload): string {
  const date = new Date(payload.timestamp);
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = date.toISOString().slice(11, 19).replace(/:/g, ''); // HHmmss
  const idShort = payload.conversation_id.slice(0, 8);
  return `${dateStr}-${timeStr}-${idShort}.md`;
}

function formatMessage(message: Message): string {
  const role = message.role === 'user' ? 'User' : 'Claude';
  const time = formatMessageTime(message.timestamp);
  return `**${role}** (${time}):\n${message.content}`;
}

export function generateMarkdown(payload: ConversationPayload, projectName: string): string {
  const lines: string[] = [];

  lines.push(`# Mobile Notes - ${projectName}`);
  lines.push('');
  lines.push(`**Conversation ID:** ${payload.conversation_id}`);
  lines.push(`**Started:** ${formatDateTime(payload.timestamp)}`);
  lines.push(`**Device:** ${payload.metadata.device} (iOS ${payload.metadata.ios_version})`);
  lines.push(`**App Version:** ${payload.metadata.app_version}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Conversation');
  lines.push('');

  for (const message of payload.conversation.messages) {
    lines.push(formatMessage(message));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('*Exported via Claude Traveller*');
  lines.push(`*Last updated: ${formatDateTime(payload.timestamp)}*`);

  return lines.join('\n');
}

export function generateContinuationMarkdown(payload: ConversationPayload, startIndex: number): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push('');
  lines.push(`## Continuation (${formatDateTime(payload.timestamp)})`);
  lines.push('');

  const newMessages = payload.conversation.messages.slice(startIndex);
  for (const message of newMessages) {
    lines.push(formatMessage(message));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push(`*Last updated: ${formatDateTime(payload.timestamp)}*`);

  return lines.join('\n');
}

export function updateLastUpdated(content: string, timestamp: string): string {
  const lastUpdatedPattern = /\*Last updated:.*\*$/m;
  const newLastUpdated = `*Last updated: ${formatDateTime(timestamp)}*`;

  if (lastUpdatedPattern.test(content)) {
    return content.replace(lastUpdatedPattern, newLastUpdated);
  }
  return content;
}

export interface SaveResult {
  action: 'created' | 'appended';
  file: string;
  path: string;
  messages_added?: number;
}

export function saveConversation(
  payload: ConversationPayload,
  project: ProjectConfig,
  existingFilePath: string | null,
  createDirectories: boolean
): SaveResult {
  const projectPath = resolvePath(project.path);

  // Ensure project directory exists if configured
  if (createDirectories && !fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  // Use provided filename or auto-generate one
  let filename = payload.filename || generateFilename(payload);

  // Ensure .md extension
  if (!filename.endsWith('.md')) {
    filename += '.md';
  }

  // If continuation and existing file found, append to it
  if (payload.is_continuation && existingFilePath && fs.existsSync(existingFilePath)) {
    const existingContent = fs.readFileSync(existingFilePath, 'utf-8');

    // Remove the last "Last updated" line before appending
    const contentWithoutLastUpdated = existingContent.replace(/\n\*Last updated:.*\*\s*$/, '');

    const continuationContent = generateContinuationMarkdown(payload, payload.previous_message_count);
    const newContent = contentWithoutLastUpdated + '\n' + continuationContent;

    fs.writeFileSync(existingFilePath, newContent, 'utf-8');

    const messagesAdded = payload.conversation.messages.length - payload.previous_message_count;

    return {
      action: 'appended',
      file: path.basename(existingFilePath),
      path: existingFilePath,
      messages_added: messagesAdded,
    };
  }

  // Create new file
  const filePath = path.join(projectPath, filename);
  const content = generateMarkdown(payload, project.name);
  fs.writeFileSync(filePath, content, 'utf-8');

  return {
    action: 'created',
    file: filename,
    path: filePath,
  };
}

export function generateNoteFilename(payload: NotePayload): string {
  const date = new Date(payload.timestamp);
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = date.toISOString().slice(11, 19).replace(/:/g, ''); // HHmmss
  const idShort = payload.note_id.slice(0, 8);
  return `note-${dateStr}-${timeStr}-${idShort}.md`;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function generateNoteMarkdown(payload: NotePayload, projectName: string): string {
  const lines: string[] = [];

  if (payload.type === 'todo') {
    // Todo format
    const checkbox = payload.completed ? '[x]' : '[ ]';
    const title = payload.title || 'Untitled Todo';
    lines.push(`# ${checkbox} ${title}`);
    lines.push('');
    lines.push(`**Project:** ${projectName}`);
    if (payload.priority) {
      lines.push(`**Priority:** ${capitalizeFirst(payload.priority)}`);
    }
    lines.push(`**Created:** ${formatDateTime(payload.timestamp)}`);
    lines.push(`**Device:** ${payload.metadata.device} (iOS ${payload.metadata.ios_version})`);
  } else {
    // Note format
    const title = payload.title || 'Quick Note';
    lines.push(`# ${title}`);
    lines.push('');
    lines.push(`**Project:** ${projectName}`);
    lines.push(`**Created:** ${formatDateTime(payload.timestamp)}`);
    lines.push(`**Device:** ${payload.metadata.device} (iOS ${payload.metadata.ios_version})`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(payload.content);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Exported via Claude Traveller*');

  return lines.join('\n');
}

export interface NoteSaveResult {
  action: 'created';
  file: string;
  path: string;
  type: NotePayload['type'];
}

export function saveNote(
  payload: NotePayload,
  project: ProjectConfig,
  createDirectories: boolean
): NoteSaveResult {
  const projectPath = resolvePath(project.path);

  // Ensure project directory exists if configured
  if (createDirectories && !fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  const filename = generateNoteFilename(payload);
  const filePath = path.join(projectPath, filename);
  const content = generateNoteMarkdown(payload, project.name);
  fs.writeFileSync(filePath, content, 'utf-8');

  return {
    action: 'created',
    file: filename,
    path: filePath,
    type: payload.type,
  };
}

export { generateFilename };
