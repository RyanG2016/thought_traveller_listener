import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Config, ConversationIndex, NotesIndex } from './types';

const DEFAULT_PORT = 41420;

function getConfigDir(): string {
  if (process.platform === 'win32') {
    const newDir = path.join(process.env.APPDATA || os.homedir(), 'thought-traveller');
    const oldDir = path.join(process.env.APPDATA || os.homedir(), 'claude-traveller');
    // Migrate from old location if it exists and new doesn't
    if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
      return oldDir; // Use old location for backward compatibility
    }
    return newDir;
  }
  const newDir = path.join(os.homedir(), '.thought-traveller');
  const oldDir = path.join(os.homedir(), '.claude-traveller');
  // Migrate from old location if it exists and new doesn't
  if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
    return oldDir; // Use old location for backward compatibility
  }
  return newDir;
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

function getConversationsIndexPath(): string {
  return path.join(getConfigDir(), 'conversations.json');
}

function getNotesIndexPath(): string {
  return path.join(getConfigDir(), 'notes.json');
}

function getLogsDir(): string {
  return path.join(getConfigDir(), 'logs');
}

function getCertsDir(): string {
  return path.join(getConfigDir(), 'certs');
}

function generateListenerId(): string {
  return 'ct_' + crypto.randomBytes(4).toString('hex');
}

function getBriefGeneratorPromptPath(): string {
  return path.join(getConfigDir(), 'brief-generator-prompt.md');
}

function getDefaultConfig(): Config {
  const certsDir = getCertsDir();
  return {
    listener: {
      id: generateListenerId(),
      port: DEFAULT_PORT,
      auth_token: '',
      friendly_name: os.hostname(),
    },
    projects: [],
    export: {
      format: 'markdown',
      filename_pattern: '{date}-{time}-{conversation_id_short}.md',
      create_directories: true,
    },
    network: {
      upnp_enabled: true,
      bonjour_enabled: true,
      tls: {
        enabled: false,
        cert_path: path.join(certsDir, 'server.crt'),
        key_path: path.join(certsDir, 'server.key'),
      },
    },
    briefs: {
      generator_prompt_file: getBriefGeneratorPromptPath(),
    },
    monitoring: {
      input_timeout_minutes: 30,
    },
  };
}

export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const logsDir = getLogsDir();
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function loadConfig(): Config {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error('Configuration not found. Run "claude-traveller init" first.');
  }
  const content = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(content) as Config;

  let needsSave = false;

  // Migrate old configs that don't have TLS settings
  if (!config.network.tls) {
    const certsDir = getCertsDir();
    config.network.tls = {
      enabled: false,
      cert_path: path.join(certsDir, 'server.crt'),
      key_path: path.join(certsDir, 'server.key'),
    };
    needsSave = true;
  }

  // Migrate old configs that don't have briefs settings
  if (!config.briefs) {
    config.briefs = {
      generator_prompt_file: getBriefGeneratorPromptPath(),
    };
    needsSave = true;
  }

  // Migrate old configs that don't have monitoring settings
  if (!config.monitoring) {
    config.monitoring = {
      input_timeout_minutes: 30,
    };
    needsSave = true;
  }

  if (needsSave) {
    saveConfig(config);
  }

  return config;
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function initConfig(overwrite: boolean = false): Config {
  ensureConfigDir();
  const configPath = getConfigPath();

  if (fs.existsSync(configPath) && !overwrite) {
    throw new Error('Configuration already exists. Use --force to overwrite.');
  }

  const config = getDefaultConfig();
  saveConfig(config);
  return config;
}

export function loadConversationsIndex(): ConversationIndex {
  const indexPath = getConversationsIndexPath();
  if (!fs.existsSync(indexPath)) {
    return {};
  }
  const content = fs.readFileSync(indexPath, 'utf-8');
  return JSON.parse(content) as ConversationIndex;
}

export function saveConversationsIndex(index: ConversationIndex): void {
  ensureConfigDir();
  const indexPath = getConversationsIndexPath();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

export function loadNotesIndex(): NotesIndex {
  const indexPath = getNotesIndexPath();
  if (!fs.existsSync(indexPath)) {
    return {};
  }
  const content = fs.readFileSync(indexPath, 'utf-8');
  return JSON.parse(content) as NotesIndex;
}

export function saveNotesIndex(index: NotesIndex): void {
  ensureConfigDir();
  const indexPath = getNotesIndexPath();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

export function validateProjectPath(projectPath: string): { valid: boolean; error?: string } {
  try {
    const resolvedPath = path.resolve(projectPath.replace(/^~/, os.homedir()));

    if (!fs.existsSync(resolvedPath)) {
      return { valid: false, error: 'Path not found' };
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' };
    }

    // Check write permission by attempting to write a temp file
    const testFile = path.join(resolvedPath, '.claude-traveller-write-test');
    try {
      fs.writeFileSync(testFile, '');
      fs.unlinkSync(testFile);
    } catch {
      return { valid: false, error: 'No write permission' };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

export function resolvePath(inputPath: string): string {
  return path.resolve(inputPath.replace(/^~/, os.homedir()));
}

export function ensureCertsDir(): void {
  const certsDir = getCertsDir();
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }
}

export function tlsCertsExist(): boolean {
  const config = loadConfig();
  return (
    fs.existsSync(config.network.tls.cert_path) &&
    fs.existsSync(config.network.tls.key_path)
  );
}

export function projectHasBrief(project: { briefFile?: string }): boolean {
  if (!project.briefFile) {
    return false;
  }
  const resolvedPath = resolvePath(project.briefFile);
  return fs.existsSync(resolvedPath);
}

export function loadProjectBrief(project: { briefFile?: string }): { content: string; lastModified: Date } | null {
  if (!project.briefFile) {
    return null;
  }
  const resolvedPath = resolvePath(project.briefFile);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const stats = fs.statSync(resolvedPath);
  return {
    content,
    lastModified: stats.mtime,
  };
}

export function loadBriefGeneratorPrompt(): string | null {
  const config = loadConfig();
  const promptPath = resolvePath(config.briefs.generator_prompt_file);
  if (!fs.existsSync(promptPath)) {
    return null;
  }
  return fs.readFileSync(promptPath, 'utf-8');
}

export function createDefaultBriefGeneratorPrompt(): void {
  const promptPath = getBriefGeneratorPromptPath();
  if (fs.existsSync(promptPath)) {
    return; // Don't overwrite existing
  }

  const defaultPrompt = `# Project Brief Generator

**YOUR TASK**: Generate a PROJECT_BRIEF.md file for this project NOW. Analyze the current project context and create the brief immediately. Do not ask questions - just generate it.

This brief will be used with Claude Traveller to provide context when discussing this project on mobile devices.

## Instructions

Based on what you know about this project, generate a complete PROJECT_BRIEF.md with the following sections:

### Required Sections

1. **Project Name & One-Liner**
   - Clear name and single sentence describing what it does

2. **Overview** (2-3 paragraphs max)
   - What problem does it solve?
   - Who is it for?
   - What makes it unique?

3. **Tech Stack** (bullet list)
   - Languages, frameworks, databases
   - Key third-party services/APIs
   - Infrastructure/hosting

4. **Current Status**
   - Development phase (MVP, beta, production, maintenance)
   - Recent major changes or releases
   - Immediate next steps

5. **Architecture Overview** (brief)
   - High-level structure
   - Key modules/services and their responsibilities
   - How data flows through the system

6. **Key Decisions & Constraints**
   - Important architectural choices and WHY they were made
   - Technical constraints or limitations
   - Dependencies or integrations that affect development

7. **Active Work & Challenges**
   - What's currently being developed
   - Known issues or technical debt
   - Blockers or open questions

8. **Terminology** (if applicable)
   - Domain-specific terms
   - Project-specific naming conventions
   - Acronyms used in the codebase

### Guidelines

- Keep the total brief under 1500 words — it needs to fit in context windows
- Be specific — "Laravel backend" is better than "PHP framework"
- Include version numbers where relevant
- Focus on information that helps continue conversations, not exhaustive documentation

### Version & Date Tracking

**IMPORTANT**: Every PROJECT_BRIEF.md must include a footer with:
- **Brief Version**: Start at 1.0, increment for significant updates (1.1, 1.2, etc.)
- **Last Updated**: Date in YYYY-MM-DD format

Example footer format:
\`\`\`
---
Brief Version: 1.0
Last Updated: 2025-01-15
\`\`\`

### Claude Traveller Setup Reminder

**IMPORTANT**: At the very end of the generated brief, include this setup reminder block:

\`\`\`
---
<!-- Claude Traveller Setup -->
<!-- After saving this file, link it to your project by running: -->
<!-- claude-traveller project set-brief <project-tag> --file /path/to/this/PROJECT_BRIEF.md -->
\`\`\`

### Output Format

Output ONLY the markdown content for PROJECT_BRIEF.md, ready to save directly to the file. Do not include any preamble or explanation outside the document.
`;

  ensureConfigDir();
  fs.writeFileSync(promptPath, defaultPrompt, 'utf-8');
}

export { getConfigDir, getLogsDir, getCertsDir, getBriefGeneratorPromptPath };
