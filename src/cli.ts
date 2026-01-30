#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  initConfig,
  loadConfig,
  saveConfig,
  configExists,
  validateProjectPath,
  resolvePath,
  getConfigDir,
  getLogsDir,
  getCertsDir,
  tlsCertsExist,
  projectHasBrief,
  loadProjectBrief,
  loadBriefGeneratorPrompt,
  createDefaultBriefGeneratorPrompt,
  getBriefGeneratorPromptPath,
} from './config';
import { startServer, stopServer, VERSION, ServerInfo } from './server';
import { initLogger, getLogger } from './logger';
import { generateCertificates, getCertificateFingerprint, enableTls, disableTls } from './tls';
import { startBonjourAdvertising, stopBonjourAdvertising, isBonjourRunning } from './bonjour';
import { Config } from './types';

const program = new Command();

function printBanner(): void {
  console.log('');
  console.log(chalk.cyan('  Thought Traveller Listener') + chalk.gray(` v${VERSION}`));
  console.log(chalk.gray('  ' + '─'.repeat(32)));
}

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  let localIP = '127.0.0.1';
  let fallbackIP: string | null = null;

  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (nets) {
      for (const net of nets) {
        if (net.family === 'IPv4' && !net.internal) {
          // Skip link-local addresses (169.254.x.x)
          if (net.address.startsWith('169.254.')) {
            fallbackIP = fallbackIP || net.address;
            continue;
          }
          // Prefer private network addresses
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

function printNetworkInfo(config: Config, protocol: 'http' | 'https'): void {
  const localIP = getLocalIP();

  console.log('');
  console.log(chalk.white('  Listener ID:  ') + chalk.yellow(config.listener.id));
  console.log(chalk.white('  Name:         ') + config.listener.friendly_name);
  console.log('');
  console.log(chalk.white('  Network:'));
  console.log(chalk.white('    Local:      ') + `${protocol}://${localIP}:${config.listener.port}`);

  if (protocol === 'https') {
    console.log(chalk.white('    TLS:        ') + chalk.green('✓ Enabled'));
    const fingerprint = getCertificateFingerprint();
    if (fingerprint) {
      console.log(chalk.white('    Fingerprint:') + chalk.gray(` ${fingerprint.slice(0, 23)}...`));
    }
  } else {
    if (config.network.tls.enabled) {
      console.log(chalk.white('    TLS:        ') + chalk.yellow('⚠ Enabled but certs missing'));
    } else {
      console.log(chalk.white('    TLS:        ') + chalk.gray('Disabled (run: thought-traveller tls setup)'));
    }
  }

  if (isBonjourRunning()) {
    console.log(chalk.white('    Bonjour:    ') + chalk.green('✓ Advertising on local network'));
  } else if (config.network.bonjour_enabled) {
    console.log(chalk.white('    Bonjour:    ') + chalk.yellow('⚠ Enabled but not running'));
  } else {
    console.log(chalk.white('    Bonjour:    ') + chalk.gray('Disabled'));
  }
  console.log(chalk.white('    UPnP:       ') + chalk.gray('(Phase 3)'));
}

function printProjectsStatus(config: Config): void {
  console.log('');
  console.log(chalk.white('  Projects:'));

  if (config.projects.length === 0) {
    console.log(chalk.gray('    No projects configured'));
    console.log(chalk.gray('    Run: thought-traveller project add --tag <tag> --name <name> --path <path>'));
  } else {
    for (const project of config.projects) {
      const validation = validateProjectPath(project.path);
      const shortPath = project.path.replace(os.homedir(), '~');

      if (validation.valid) {
        console.log(chalk.green('    ✓ ') + chalk.white(project.tag.padEnd(16)) + chalk.gray(' → ') + shortPath);
      } else {
        console.log(chalk.red('    ✗ ') + chalk.white(project.tag.padEnd(16)) + chalk.gray(' → ') + shortPath + chalk.red(` (${validation.error})`));
      }
    }
  }
}

function printStartupComplete(config: Config): void {
  const hasProjects = config.projects.length > 0;
  const hasAuthToken = !!config.listener.auth_token;

  console.log('');

  if (!hasAuthToken) {
    console.log(chalk.yellow('  ⚠ Warning: No auth token configured'));
    console.log(chalk.gray('    Run: thought-traveller config set auth_token "your_secret"'));
    console.log('');
  }

  if (hasProjects && hasAuthToken) {
    console.log(chalk.green('  Status: Ready to receive conversations'));
  } else if (!hasProjects) {
    console.log(chalk.yellow('  Status: Waiting for project configuration'));
  } else {
    console.log(chalk.yellow('  Status: Waiting for auth token configuration'));
  }

  console.log('');
  console.log(chalk.gray('  ' + '─'.repeat(32)));
  console.log(chalk.gray('  Press Ctrl+C to stop'));
  console.log('');
}

// Init command
program
  .command('init')
  .description('Initialize configuration')
  .option('-f, --force', 'Overwrite existing configuration')
  .action((options) => {
    try {
      if (configExists() && !options.force) {
        console.log(chalk.yellow('Configuration already exists.'));
        console.log(chalk.gray('Use --force to overwrite.'));
        console.log(chalk.gray(`Config location: ${path.join(getConfigDir(), 'config.json')}`));
        return;
      }

      const config = initConfig(options.force);

      // Create default brief generator prompt
      createDefaultBriefGeneratorPrompt();

      console.log(chalk.green('✓ Configuration initialized'));
      console.log('');
      console.log(chalk.white('  Listener ID: ') + chalk.yellow(config.listener.id));
      console.log(chalk.white('  Port:        ') + config.listener.port);
      console.log(chalk.white('  Config:      ') + path.join(getConfigDir(), 'config.json'));
      console.log('');
      console.log(chalk.gray('Next steps:'));
      console.log(chalk.gray('  1. Set auth token: thought-traveller config set auth_token "your_secret"'));
      console.log(chalk.gray('  2. Add a project:  thought-traveller project add'));
      console.log(chalk.gray('  3. Start listener: thought-traveller start'));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// Start command
program
  .command('start')
  .description('Start the listener')
  .option('-d, --daemon', 'Run in background (not implemented in MVP)')
  .action(async (options) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      if (options.daemon) {
        console.log(chalk.yellow('Daemon mode will be available in Phase 5'));
        process.exit(1);
      }

      const config = loadConfig();
      initLogger(false);

      printBanner();

      const serverInfo = await startServer(config);

      // Start Bonjour advertising for local network discovery
      startBonjourAdvertising(config, serverInfo.protocol);

      printNetworkInfo(config, serverInfo.protocol);
      printProjectsStatus(config);
      printStartupComplete(config);

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('');
        console.log(chalk.gray('Shutting down...'));
        stopBonjourAdvertising();
        await stopServer();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        stopBonjourAdvertising();
        await stopServer();
        process.exit(0);
      });
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// Stop command (placeholder for daemon mode)
program
  .command('stop')
  .description('Stop the listener (daemon mode)')
  .action(() => {
    console.log(chalk.yellow('Daemon mode will be available in Phase 5'));
    console.log(chalk.gray('For now, use Ctrl+C to stop the foreground listener.'));
  });

// Status command
program
  .command('status')
  .description('Check listener status')
  .action(async () => {
    try {
      if (!configExists()) {
        console.log(chalk.yellow('Not configured'));
        console.log(chalk.gray('Run "thought-traveller init" to initialize.'));
        return;
      }

      const config = loadConfig();

      // Try to connect to the health endpoint
      try {
        const response = await fetch(`http://127.0.0.1:${config.listener.port}/health`);
        if (response.ok) {
          const data = await response.json() as { status: string; uptime: number };
          const uptimeMin = Math.floor(data.uptime / 60);
          console.log(chalk.green('● Running'));
          console.log(chalk.white('  Port:    ') + config.listener.port);
          console.log(chalk.white('  Uptime:  ') + `${uptimeMin} minutes`);
        } else {
          console.log(chalk.red('● Not running'));
        }
      } catch {
        console.log(chalk.red('● Not running'));
      }

      printProjectsStatus(config);
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// Config commands
const configCmd = program
  .command('config')
  .description('Manage configuration');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    try {
      if (!configExists()) {
        console.log(chalk.yellow('Not configured'));
        console.log(chalk.gray('Run "thought-traveller init" to initialize.'));
        return;
      }

      const config = loadConfig();
      console.log(chalk.white('Listener Configuration:'));
      console.log(chalk.white('  ID:           ') + config.listener.id);
      console.log(chalk.white('  Port:         ') + config.listener.port);
      console.log(chalk.white('  Name:         ') + config.listener.friendly_name);
      console.log(chalk.white('  Auth Token:   ') + (config.listener.auth_token ? chalk.green('configured') : chalk.red('not set')));
      console.log('');
      console.log(chalk.white('Export Settings:'));
      console.log(chalk.white('  Format:       ') + config.export.format);
      console.log(chalk.white('  Pattern:      ') + config.export.filename_pattern);
      console.log('');
      console.log(chalk.white('Monitoring Settings:'));
      console.log(chalk.white('  Timeout:      ') + (config.monitoring?.input_timeout_minutes || 30) + ' minutes');
      if (config.monitoring?.apns?.enabled) {
        console.log(chalk.white('  APNs:         ') + chalk.green('enabled'));
        console.log(chalk.white('  APNs Mode:    ') + (config.monitoring.apns.production ? 'production' : 'sandbox'));
      } else {
        console.log(chalk.white('  APNs:         ') + chalk.gray('disabled'));
      }
      console.log('');
      console.log(chalk.white('Config Location:'));
      console.log(chalk.gray('  ' + path.join(getConfigDir(), 'config.json')));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key, value) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      const config = loadConfig();

      switch (key) {
        case 'auth_token':
          config.listener.auth_token = value;
          break;
        case 'friendly_name':
          config.listener.friendly_name = value;
          break;
        case 'port':
          const port = parseInt(value, 10);
          if (isNaN(port) || port < 1 || port > 65535) {
            console.error(chalk.red('Error:'), 'Invalid port number');
            process.exit(1);
          }
          config.listener.port = port;
          break;
        case 'input_timeout':
          const timeout = parseInt(value, 10);
          if (isNaN(timeout) || timeout < 1 || timeout > 120) {
            console.error(chalk.red('Error:'), 'Invalid timeout (must be 1-120 minutes)');
            process.exit(1);
          }
          if (!config.monitoring) {
            config.monitoring = { input_timeout_minutes: timeout };
          } else {
            config.monitoring.input_timeout_minutes = timeout;
          }
          break;
        default:
          console.error(chalk.red('Error:'), `Unknown configuration key: ${key}`);
          console.log(chalk.gray('Valid keys: auth_token, friendly_name, port, input_timeout'));
          process.exit(1);
      }

      saveConfig(config);
      console.log(chalk.green('✓') + ` Set ${key}`);
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// Project commands
const projectCmd = program
  .command('project')
  .description('Manage projects');

projectCmd
  .command('list')
  .description('List configured projects')
  .action(() => {
    try {
      if (!configExists()) {
        console.log(chalk.yellow('Not configured'));
        console.log(chalk.gray('Run "thought-traveller init" to initialize.'));
        return;
      }

      const config = loadConfig();

      if (config.projects.length === 0) {
        console.log(chalk.gray('No projects configured'));
        console.log(chalk.gray('Run: thought-traveller project add --tag <tag> --name <name> --path <path>'));
        return;
      }

      console.log(chalk.white('Configured Projects:'));
      console.log('');

      for (const project of config.projects) {
        const validation = validateProjectPath(project.path);
        const shortPath = project.path.replace(os.homedir(), '~');
        const status = validation.valid ? chalk.green('✓') : chalk.red('✗');
        const hasBrief = projectHasBrief(project);

        console.log(`  ${status} ${chalk.white(project.tag)}`);
        console.log(chalk.gray(`    Name: ${project.name}`));
        console.log(chalk.gray(`    Path: ${shortPath}`));
        if (hasBrief) {
          const briefPath = project.briefFile?.replace(os.homedir(), '~') || '';
          console.log(chalk.cyan(`    Brief: ${briefPath}`));
        } else if (project.briefFile) {
          console.log(chalk.yellow(`    Brief: configured but file missing`));
        }
        if (!validation.valid) {
          console.log(chalk.red(`    Error: ${validation.error}`));
        }
        console.log('');
      }
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

async function promptUser(question: string): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptGitignoreUpdate(projectRoot: string, travellerPath: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const relativePath = path.relative(projectRoot, travellerPath);
  const gitignoreEntry = `\n# Thought Traveller conversations\n${relativePath}/\n`;

  console.log('');
  const updateGitignore = await promptUser(chalk.yellow('    Add traveller directory to .gitignore? (y/n): '));

  if (updateGitignore.toLowerCase() !== 'y' && updateGitignore.toLowerCase() !== 'yes') {
    return;
  }

  try {
    if (fs.existsSync(gitignorePath)) {
      // Check if entry already exists
      const existingContent = fs.readFileSync(gitignorePath, 'utf-8');
      if (existingContent.includes(relativePath)) {
        console.log(chalk.gray('    .gitignore already contains this entry'));
        return;
      }

      // Create backup with unique name
      let backupName = '.gitignore.backup';
      let backupPath = path.join(projectRoot, backupName);

      // If backup already exists, use timestamped name
      if (fs.existsSync(backupPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        backupName = `.gitignore.backup.${timestamp}`;
        backupPath = path.join(projectRoot, backupName);
      }

      fs.copyFileSync(gitignorePath, backupPath);

      // Verify backup was created and matches original
      if (!fs.existsSync(backupPath)) {
        console.log(chalk.yellow('    Could not verify backup was created.'));
        console.log(chalk.yellow('    Please manually add the following to your .gitignore:'));
        console.log(chalk.gray(`    ${relativePath}/`));
        return;
      }

      const backupContent = fs.readFileSync(backupPath, 'utf-8');
      if (backupContent !== existingContent) {
        console.log(chalk.yellow('    Backup verification failed - contents do not match.'));
        console.log(chalk.yellow('    Please manually add the following to your .gitignore:'));
        console.log(chalk.gray(`    ${relativePath}/`));
        return;
      }

      console.log(chalk.gray(`    Created backup: ${backupName}`));

      // Append entry
      fs.appendFileSync(gitignorePath, gitignoreEntry);
      console.log(chalk.green('    ✓ Updated .gitignore'));
    } else {
      // Create new .gitignore
      fs.writeFileSync(gitignorePath, `# Thought Traveller conversations\n${relativePath}/\n`);
      console.log(chalk.green('    ✓ Created .gitignore'));
    }
  } catch (err) {
    console.log(chalk.yellow(`    Could not update .gitignore: ${(err as Error).message}`));
    console.log(chalk.yellow('    Please manually add the following to your .gitignore:'));
    console.log(chalk.gray(`    ${relativePath}/`));
  }
}

async function addProjectInteractive(): Promise<void> {
  console.log('');
  console.log(chalk.cyan('Add a New Project'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log('');

  // Project Tag
  console.log(chalk.white('1. Project Tag'));
  console.log(chalk.gray('   A unique identifier used by the iOS app to route conversations.'));
  console.log(chalk.gray('   Use lowercase letters, numbers, and hyphens (e.g., "myapp-ios").'));
  console.log('');
  const tag = await promptUser(chalk.yellow('   Enter tag: '));

  if (!tag) {
    console.error(chalk.red('Error:'), 'Project tag is required');
    process.exit(1);
  }

  console.log('');

  // Project Name
  console.log(chalk.white('2. Project Name'));
  console.log(chalk.gray('   A human-readable display name shown in the iOS app.'));
  console.log(chalk.gray('   Example: "My Awesome App" or "Wedding Planner iOS"'));
  console.log('');
  const name = await promptUser(chalk.yellow('   Enter name: '));

  if (!name) {
    console.error(chalk.red('Error:'), 'Project name is required');
    process.exit(1);
  }

  console.log('');

  // Project Path
  console.log(chalk.white('3. Project Path'));
  console.log(chalk.gray('   The local directory where conversations will be saved.'));
  console.log(chalk.gray('   Use an absolute path or ~ for home directory.'));
  console.log(chalk.gray('   Example: ~/Projects/MyApp/traveller'));
  console.log('');
  const pathInput = await promptUser(chalk.yellow('   Enter path: '));

  if (!pathInput) {
    console.error(chalk.red('Error:'), 'Project path is required');
    process.exit(1);
  }

  console.log('');

  // Process and save
  const config = loadConfig();

  // Check for duplicate tag
  if (config.projects.some((p) => p.tag === tag)) {
    console.error(chalk.red('Error:'), `Project with tag "${tag}" already exists`);
    process.exit(1);
  }

  const resolvedPath = resolvePath(pathInput);
  const validation = validateProjectPath(resolvedPath);

  if (!validation.valid) {
    console.log(chalk.yellow('Warning:'), `Path issue: ${validation.error}`);
    console.log(chalk.gray('The project will be added, but path needs to be fixed before exports work.'));
  }

  // Check for duplicate paths
  const duplicatePath = config.projects.find((p) => resolvePath(p.path) === resolvedPath);
  if (duplicatePath) {
    console.log(chalk.yellow('Warning:'), `Path already used by project "${duplicatePath.tag}"`);
  }

  config.projects.push({
    tag,
    name,
    path: resolvedPath,
  });

  saveConfig(config);

  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.green('✓') + ` Added project "${tag}"`);
  console.log('');
  console.log(chalk.white('  Tag:  ') + tag);
  console.log(chalk.white('  Name: ') + name);
  console.log(chalk.white('  Path: ') + resolvedPath);
  console.log('');
}

projectCmd
  .command('add')
  .description('Add a project (interactive or with flags)')
  .option('-t, --tag <tag>', 'Project tag (unique identifier)')
  .option('-n, --name <name>', 'Project display name')
  .option('-p, --path <path>', 'Path to save conversations')
  .action(async (options) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      // If no options provided, run interactive mode
      if (!options.tag && !options.name && !options.path) {
        await addProjectInteractive();
        return;
      }

      // If some but not all options provided, error
      if (!options.tag || !options.name || !options.path) {
        console.error(chalk.red('Error:'), 'Please provide all options (--tag, --name, --path) or run without options for interactive mode.');
        process.exit(1);
      }

      const config = loadConfig();

      // Check for duplicate tag
      if (config.projects.some((p) => p.tag === options.tag)) {
        console.error(chalk.red('Error:'), `Project with tag "${options.tag}" already exists`);
        process.exit(1);
      }

      const resolvedPath = resolvePath(options.path);
      const validation = validateProjectPath(resolvedPath);

      if (!validation.valid) {
        console.log(chalk.yellow('Warning:'), `Path issue: ${validation.error}`);
        console.log(chalk.gray('The project will be added, but path needs to be fixed before exports work.'));
      }

      // Check for duplicate paths
      const duplicatePath = config.projects.find((p) => resolvePath(p.path) === resolvedPath);
      if (duplicatePath) {
        console.log(chalk.yellow('Warning:'), `Path already used by project "${duplicatePath.tag}"`);
      }

      config.projects.push({
        tag: options.tag,
        name: options.name,
        path: resolvedPath,
      });

      saveConfig(config);
      console.log(chalk.green('✓') + ` Added project "${options.tag}"`);
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

projectCmd
  .command('remove <tag>')
  .description('Remove a project')
  .action((tag) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      const config = loadConfig();
      const index = config.projects.findIndex((p) => p.tag === tag);

      if (index === -1) {
        console.error(chalk.red('Error:'), `Project "${tag}" not found`);
        process.exit(1);
      }

      config.projects.splice(index, 1);
      saveConfig(config);
      console.log(chalk.green('✓') + ` Removed project "${tag}"`);
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

projectCmd
  .command('set-brief <tag>')
  .description('Set the brief file path for a project')
  .requiredOption('-f, --file <path>', 'Path to the PROJECT_BRIEF.md file')
  .action((tag, options) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      const config = loadConfig();
      const project = config.projects.find((p) => p.tag === tag);

      if (!project) {
        console.error(chalk.red('Error:'), `Project "${tag}" not found`);
        process.exit(1);
      }

      const resolvedPath = resolvePath(options.file);

      if (!fs.existsSync(resolvedPath)) {
        console.log(chalk.yellow('Warning:'), `File not found: ${resolvedPath}`);
        console.log(chalk.gray('The path will be saved, but the brief will not be available until the file exists.'));
      }

      project.briefFile = resolvedPath;
      saveConfig(config);

      console.log(chalk.green('✓') + ` Set brief file for "${tag}"`);
      console.log(chalk.gray(`  Path: ${resolvedPath}`));

      if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath);
        const sizeKb = (stats.size / 1024).toFixed(1);
        console.log(chalk.gray(`  Size: ${sizeKb} KB`));
        console.log(chalk.gray(`  Modified: ${stats.mtime.toLocaleString()}`));
      }
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

projectCmd
  .command('scan')
  .description('Scan a directory for projects and add them interactively')
  .action(async () => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      const currentDir = process.cwd();

      console.log('');
      console.log(chalk.cyan('Scan Directory for Projects'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log('');
      console.log(chalk.gray('This will scan a directory for subdirectories and prompt you to add each one as a project.'));
      console.log('');
      console.log(chalk.white('Current directory:'));
      console.log(chalk.gray(`  ${currentDir}`));
      console.log('');

      const useCurrent = await promptUser(chalk.yellow('Scan current directory? (y/n): '));

      let resolvedScanPath: string;

      if (useCurrent.toLowerCase() === 'y' || useCurrent.toLowerCase() === 'yes') {
        resolvedScanPath = currentDir;
      } else {
        console.log('');
        const scanPath = await promptUser(chalk.yellow('Enter directory to scan: '));

        if (!scanPath) {
          console.error(chalk.red('Error:'), 'Directory path is required');
          process.exit(1);
        }

        resolvedScanPath = resolvePath(scanPath);
      }

      if (!fs.existsSync(resolvedScanPath)) {
        console.error(chalk.red('Error:'), `Directory not found: ${resolvedScanPath}`);
        process.exit(1);
      }

      const stats = fs.statSync(resolvedScanPath);
      if (!stats.isDirectory()) {
        console.error(chalk.red('Error:'), `Not a directory: ${resolvedScanPath}`);
        process.exit(1);
      }

      // Get all subdirectories
      const entries = fs.readdirSync(resolvedScanPath, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          path: path.join(resolvedScanPath, entry.name),
        }));

      if (directories.length === 0) {
        console.log(chalk.yellow('No subdirectories found in:'), resolvedScanPath);
        process.exit(0);
      }

      console.log('');
      console.log(chalk.white(`Found ${directories.length} directories:`));
      console.log('');

      let config = loadConfig();
      const existingPaths = new Set(config.projects.map((p) => resolvePath(p.path)));
      let addedCount = 0;
      let skippedCount = 0;

      for (const dir of directories) {
        // Check if this path is already configured
        if (existingPaths.has(dir.path)) {
          console.log(chalk.gray(`  ○ ${dir.name}`) + chalk.gray(' (already configured, skipping)'));
          skippedCount++;
          continue;
        }

        // Check if any project already uses a path within this directory
        const isSubpathConfigured = config.projects.some((p) => {
          const projPath = resolvePath(p.path);
          return projPath.startsWith(dir.path + path.sep) || dir.path.startsWith(projPath + path.sep);
        });

        if (isSubpathConfigured) {
          console.log(chalk.gray(`  ○ ${dir.name}`) + chalk.gray(' (related path configured, skipping)'));
          skippedCount++;
          continue;
        }

        console.log('');
        console.log(chalk.white(`  → ${dir.name}`));
        console.log(chalk.gray(`    ${dir.path}`));
        console.log('');

        const addThis = await promptUser(chalk.yellow('    Add this project? (y/n): '));

        if (addThis.toLowerCase() !== 'y' && addThis.toLowerCase() !== 'yes') {
          console.log(chalk.gray('    Skipped'));
          continue;
        }

        console.log('');

        // Suggest a tag based on directory name
        const suggestedTag = dir.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
        console.log(chalk.gray(`    Suggested tag: ${suggestedTag}`));
        const tagInput = await promptUser(chalk.yellow('    Enter tag (or press Enter for suggested): '));
        const tag = tagInput || suggestedTag;

        // Check for duplicate tag
        if (config.projects.some((p) => p.tag === tag)) {
          console.log(chalk.red('    Error:'), `Tag "${tag}" already exists, skipping this project`);
          continue;
        }

        // Suggest a name based on directory name
        const suggestedName = dir.name
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        console.log(chalk.gray(`    Suggested name: ${suggestedName}`));
        const nameInput = await promptUser(chalk.yellow('    Enter name (or press Enter for suggested): '));
        const name = nameInput || suggestedName;

        // Ask for notes subdirectory or use root
        console.log(chalk.gray('    Where should conversations be saved?'));
        console.log(chalk.gray(`    1. ${dir.path}`));
        console.log(chalk.gray(`    2. ${dir.path}/traveller (will be created)`));
        console.log(chalk.gray('    3. Custom subdirectory'));
        const pathChoice = await promptUser(chalk.yellow('    Choose (1/2/3): '));

        let projectPath: string;
        if (pathChoice === '2') {
          projectPath = path.join(dir.path, 'traveller');
        } else if (pathChoice === '3') {
          const customSub = await promptUser(chalk.yellow('    Enter subdirectory name: '));
          projectPath = path.join(dir.path, customSub || 'notes');
        } else {
          projectPath = dir.path;
        }

        // Create the directory if it doesn't exist (for options 2 and 3)
        if (pathChoice === '2' || pathChoice === '3') {
          if (!fs.existsSync(projectPath)) {
            try {
              fs.mkdirSync(projectPath, { recursive: true });
              console.log(chalk.gray(`    Created directory: ${path.basename(projectPath)}/`));
            } catch (err) {
              console.log(chalk.yellow(`    Warning: Could not create directory: ${(err as Error).message}`));
            }
          }
        }

        // Reload config in case it changed
        config = loadConfig();

        config.projects.push({
          tag,
          name,
          path: projectPath,
        });

        saveConfig(config);
        existingPaths.add(projectPath);
        addedCount++;

        console.log(chalk.green('    ✓ Added'));

        // Ask about .gitignore if using a subdirectory
        if (pathChoice === '2' || pathChoice === '3') {
          await promptGitignoreUpdate(dir.path, projectPath);
        }

        console.log('');
      }

      console.log(chalk.gray('─'.repeat(40)));
      console.log('');
      console.log(chalk.white('Scan complete:'));
      console.log(chalk.green(`  ✓ ${addedCount} projects added`));
      if (skippedCount > 0) {
        console.log(chalk.gray(`  ○ ${skippedCount} directories skipped (already configured)`));
      }
      console.log('');

    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// Brief commands
const briefCmd = program
  .command('brief')
  .description('Manage project briefs');

briefCmd
  .command('show-prompt')
  .description('Show the brief generator prompt template')
  .action(() => {
    try {
      const prompt = loadBriefGeneratorPrompt();

      if (!prompt) {
        console.log(chalk.yellow('Brief generator prompt not found.'));
        console.log(chalk.gray('Run "thought-traveller init" to create it, or create manually at:'));
        console.log(chalk.gray(`  ${getBriefGeneratorPromptPath()}`));
        return;
      }

      console.log('');
      console.log(chalk.cyan('Brief Generator Prompt'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log('');
      console.log(prompt);
      console.log('');
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.gray(`Location: ${getBriefGeneratorPromptPath()}`));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

briefCmd
  .command('generate <tag>')
  .description('Generate a brief for a project (shows instructions)')
  .action((tag) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      const config = loadConfig();
      const project = config.projects.find((p) => p.tag === tag);

      if (!project) {
        console.error(chalk.red('Error:'), `Project "${tag}" not found`);
        console.log(chalk.gray('Available projects:'));
        for (const p of config.projects) {
          console.log(chalk.gray(`  - ${p.tag}`));
        }
        process.exit(1);
      }

      const prompt = loadBriefGeneratorPrompt();

      if (!prompt) {
        console.log(chalk.yellow('Brief generator prompt not found.'));
        console.log(chalk.gray('Run "thought-traveller init" to create it.'));
        process.exit(1);
      }

      console.log('');
      console.log(chalk.cyan('Generate Brief for: ') + chalk.white(project.name));
      console.log(chalk.gray('─'.repeat(60)));
      console.log('');
      console.log(chalk.white('Instructions:'));
      console.log('');
      console.log(chalk.gray('1. Open Claude (desktop or web) in a conversation with your project context'));
      console.log(chalk.gray('2. Copy the prompt below and paste it'));
      console.log(chalk.gray('3. Claude will generate a PROJECT_BRIEF.md for you'));
      console.log(chalk.gray('4. Save the output to a file (e.g., PROJECT_BRIEF.md in your project root)'));
      console.log(chalk.gray('5. Link it to this project with:'));
      console.log(chalk.yellow(`   thought-traveller project set-brief ${tag} --file /path/to/PROJECT_BRIEF.md`));
      console.log('');
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.cyan('PROMPT TO COPY:'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log('');
      console.log(prompt);
      console.log('');
      console.log(chalk.gray('─'.repeat(60)));

      // Show current brief status
      if (project.briefFile) {
        console.log('');
        if (projectHasBrief(project)) {
          const briefData = loadProjectBrief(project);
          if (briefData) {
            console.log(chalk.white('Current brief:'));
            console.log(chalk.gray(`  Path: ${project.briefFile}`));
            console.log(chalk.gray(`  Last modified: ${briefData.lastModified.toLocaleString()}`));
            console.log(chalk.gray(`  Size: ${(briefData.content.length / 1024).toFixed(1)} KB`));
          }
        } else {
          console.log(chalk.yellow('Note: Brief file is configured but not found'));
          console.log(chalk.gray(`  Expected at: ${project.briefFile}`));
        }
      } else {
        console.log('');
        console.log(chalk.gray('Tip: After creating the brief, link it with:'));
        console.log(chalk.yellow(`  thought-traveller project set-brief ${tag} --file /path/to/PROJECT_BRIEF.md`));
      }
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

briefCmd
  .command('view <tag>')
  .description('View the brief content for a project')
  .action((tag) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      const config = loadConfig();
      const project = config.projects.find((p) => p.tag === tag);

      if (!project) {
        console.error(chalk.red('Error:'), `Project "${tag}" not found`);
        process.exit(1);
      }

      if (!project.briefFile) {
        console.log(chalk.yellow('No brief configured for this project.'));
        console.log(chalk.gray(`Run: thought-traveller project set-brief ${tag} --file /path/to/brief.md`));
        return;
      }

      const briefData = loadProjectBrief(project);

      if (!briefData) {
        console.log(chalk.yellow('Brief file not found.'));
        console.log(chalk.gray(`Expected at: ${project.briefFile}`));
        return;
      }

      console.log('');
      console.log(chalk.cyan(`Brief for: ${project.name}`));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.gray(`Path: ${project.briefFile}`));
      console.log(chalk.gray(`Last modified: ${briefData.lastModified.toLocaleString()}`));
      console.log(chalk.gray('─'.repeat(60)));
      console.log('');
      console.log(briefData.content);
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// TLS commands
const tlsCmd = program
  .command('tls')
  .description('Manage TLS/HTTPS configuration');

tlsCmd
  .command('setup')
  .description('Generate self-signed certificates and enable HTTPS')
  .option('-f, --force', 'Regenerate certificates even if they exist')
  .action(async (options) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      if (tlsCertsExist() && !options.force) {
        console.log(chalk.yellow('Certificates already exist.'));
        console.log(chalk.gray('Use --force to regenerate.'));
        const fingerprint = getCertificateFingerprint();
        if (fingerprint) {
          console.log('');
          console.log(chalk.white('Current certificate fingerprint:'));
          console.log(chalk.cyan(`  ${fingerprint}`));
        }
        return;
      }

      console.log(chalk.gray('Generating self-signed certificate...'));
      const certInfo = await generateCertificates();

      enableTls();

      console.log(chalk.green('✓ TLS certificates generated and enabled'));
      console.log('');
      console.log(chalk.white('Certificate fingerprint (SHA-256):'));
      console.log(chalk.cyan(`  ${certInfo.fingerprint}`));
      console.log('');
      console.log(chalk.yellow('Important:'));
      console.log(chalk.gray('  Save this fingerprint! You will need to verify it when connecting'));
      console.log(chalk.gray('  from the iOS app to ensure you are connecting to the right server.'));
      console.log('');
      console.log(chalk.white('Certificate location:'));
      console.log(chalk.gray(`  ${certInfo.certPath}`));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

tlsCmd
  .command('status')
  .description('Show TLS configuration status')
  .action(() => {
    try {
      if (!configExists()) {
        console.log(chalk.yellow('Not configured'));
        return;
      }

      const config = loadConfig();
      const certsExist = tlsCertsExist();
      const fingerprint = getCertificateFingerprint();

      console.log(chalk.white('TLS Configuration:'));
      console.log('');

      if (config.network.tls.enabled && certsExist) {
        console.log(chalk.green('  ● HTTPS Enabled'));
      } else if (config.network.tls.enabled && !certsExist) {
        console.log(chalk.yellow('  ⚠ HTTPS Enabled but certificates missing'));
        console.log(chalk.gray('    Run: thought-traveller tls setup'));
      } else {
        console.log(chalk.gray('  ○ HTTPS Disabled'));
        console.log(chalk.gray('    Run: thought-traveller tls setup'));
      }

      console.log('');

      if (certsExist && fingerprint) {
        console.log(chalk.white('  Certificate fingerprint (SHA-256):'));
        console.log(chalk.cyan(`    ${fingerprint}`));
        console.log('');
        console.log(chalk.white('  Certificate path:'));
        console.log(chalk.gray(`    ${config.network.tls.cert_path}`));
      }
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

tlsCmd
  .command('enable')
  .description('Enable HTTPS (requires certificates)')
  .action(() => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      if (!tlsCertsExist()) {
        console.error(chalk.red('Error:'), 'Certificates not found. Run "thought-traveller tls setup" first.');
        process.exit(1);
      }

      enableTls();
      console.log(chalk.green('✓ HTTPS enabled'));
      console.log(chalk.gray('  Restart the listener for changes to take effect.'));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

tlsCmd
  .command('disable')
  .description('Disable HTTPS (fall back to HTTP)')
  .action(() => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      disableTls();
      console.log(chalk.green('✓ HTTPS disabled'));
      console.log(chalk.gray('  Restart the listener for changes to take effect.'));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// Monitor commands
const monitorCmd = program
  .command('monitor')
  .description('Manage monitoring sessions');

monitorCmd
  .command('status')
  .description('Show active monitoring sessions')
  .action(async () => {
    try {
      if (!configExists()) {
        console.log(chalk.yellow('Not configured'));
        return;
      }

      const config = loadConfig();

      // Try to connect to the monitor status endpoint
      try {
        // Use https module for self-signed cert support
        const https = await import('https');
        const http = await import('http');
        const protocol = config.network.tls.enabled ? 'https' : 'http';
        const client = protocol === 'https' ? https : http;

        const response = await new Promise<{
          ok: boolean;
          status: number;
          json: () => Promise<unknown>;
        }>((resolve, reject) => {
          const options = {
            hostname: '127.0.0.1',
            port: config.listener.port,
            path: '/monitor/status',
            method: 'GET',
            headers: {
              Authorization: `Bearer ${config.listener.auth_token}`,
            },
            ...(protocol === 'https' && { rejectUnauthorized: false }),
          };

          const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              resolve({
                ok: res.statusCode === 200,
                status: res.statusCode || 0,
                json: async () => JSON.parse(data),
              });
            });
          });

          req.on('error', reject);
          req.end();
        });

        if (response.ok) {
          const data = (await response.json()) as {
            monitoring: {
              enabled: boolean;
              connectedDevices: number;
              apnsEnabled?: boolean;
              inputTimeoutMinutes?: number;
              pendingRequests?: number;
              activeSessions: Array<{
                deviceId: string;
                deviceName: string;
                apnsToken?: string;
                startTime: string;
                lastSeen: string;
                status: string;
              }>;
            };
          };

          console.log('');
          console.log(chalk.cyan('Monitoring Status'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log('');
          console.log(
            chalk.white('  WebSocket:    ') +
              (data.monitoring.enabled ? chalk.green('✓ Enabled') : chalk.gray('Disabled'))
          );
          console.log(chalk.white('  Connections:  ') + data.monitoring.connectedDevices);
          console.log(
            chalk.white('  APNs:         ') +
              (data.monitoring.apnsEnabled ? chalk.green('✓ Enabled') : chalk.gray('Disabled'))
          );
          console.log(chalk.white('  Timeout:      ') + (data.monitoring.inputTimeoutMinutes || 30) + ' minutes');
          if (data.monitoring.pendingRequests && data.monitoring.pendingRequests > 0) {
            console.log(chalk.white('  Pending:      ') + chalk.yellow(data.monitoring.pendingRequests + ' request(s)'));
          }
          console.log('');

          if (data.monitoring.activeSessions.length === 0) {
            console.log(chalk.gray('  No active monitoring sessions'));
          } else {
            console.log(chalk.white('  Active Sessions:'));
            for (const session of data.monitoring.activeSessions) {
              const statusIcon = session.status === 'active' ? chalk.green('●') : chalk.yellow('○');
              const lastSeen = new Date(session.lastSeen);
              const ago = Math.floor((Date.now() - lastSeen.getTime()) / 1000);
              const agoStr = ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`;
              const apnsIndicator = session.apnsToken ? chalk.cyan(' [APNs]') : '';

              console.log(`    ${statusIcon} ${session.deviceName}${apnsIndicator}`);
              console.log(chalk.gray(`      ID: ${session.deviceId}`));
              console.log(chalk.gray(`      Last seen: ${agoStr}`));
            }
          }
          console.log('');
        } else if (response.status === 401) {
          console.log(chalk.red('Authentication failed'));
          console.log(chalk.gray('Check your auth_token configuration'));
        } else {
          console.log(chalk.red('● Listener not responding'));
        }
      } catch {
        // Check if listener is running at all via health endpoint
        try {
          const http = await import('http');
          const https = await import('https');
          const protocol = config.network.tls.enabled ? 'https' : 'http';
          const client = protocol === 'https' ? https : http;

          await new Promise<void>((resolve, reject) => {
            const options = {
              hostname: '127.0.0.1',
              port: config.listener.port,
              path: '/health',
              method: 'GET',
              ...(protocol === 'https' && { rejectUnauthorized: false }),
            };

            const req = client.request(options, (res) => {
              if (res.statusCode === 200) {
                console.log(chalk.yellow('Listener running but monitoring endpoint unavailable'));
                console.log(chalk.gray('This may indicate the listener needs to be restarted.'));
              } else {
                console.log(chalk.red('● Listener not running'));
              }
              resolve();
            });

            req.on('error', () => {
              console.log(chalk.red('● Listener not running'));
              resolve();
            });
            req.end();
          });
        } catch {
          console.log(chalk.red('● Listener not running'));
        }
      }
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

monitorCmd
  .command('test')
  .description('Send a test input request to connected mobile devices')
  .option('-p, --prompt <text>', 'Custom prompt message', 'Test notification from Thought Traveller')
  .option('-o, --options <list>', 'Comma-separated options', '1,2,3')
  .option('-t, --timeout <seconds>', 'Timeout in seconds', '60')
  .action(async (options) => {
    try {
      if (!configExists()) {
        console.log(chalk.yellow('Not configured'));
        return;
      }

      const config = loadConfig();
      const https = await import('https');
      const http = await import('http');
      const protocol = config.network.tls.enabled ? 'https' : 'http';
      const client = protocol === 'https' ? https : http;

      console.log('');
      console.log(chalk.cyan('Mobile Input Test'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log('');
      console.log(chalk.white('  Prompt:   ') + options.prompt);
      console.log(chalk.white('  Options:  ') + options.options);
      console.log(chalk.white('  Timeout:  ') + options.timeout + 's');
      console.log('');

      // First check if any devices are connected
      console.log(chalk.gray('  Checking for connected devices...'));

      const statusResponse = await new Promise<{ ok: boolean; data?: { monitoring: { connectedDevices: number } } }>((resolve) => {
        const statusOptions = {
          hostname: '127.0.0.1',
          port: config.listener.port,
          path: '/monitor/status',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.listener.auth_token}`,
          },
          ...(protocol === 'https' && { rejectUnauthorized: false }),
        };

        const req = client.request(statusOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ ok: true, data: JSON.parse(data) });
            } else {
              resolve({ ok: false });
            }
          });
        });

        req.on('error', () => resolve({ ok: false }));
        req.end();
      });

      if (!statusResponse.ok) {
        console.log(chalk.red('  ✗ Listener not running or not responding'));
        console.log(chalk.gray('    Start the listener with: thought-traveller start'));
        return;
      }

      const connectedDevices = statusResponse.data?.monitoring.connectedDevices || 0;

      if (connectedDevices === 0) {
        console.log(chalk.yellow('  ⚠ No mobile devices connected'));
        console.log('');
        console.log(chalk.gray('  To test:'));
        console.log(chalk.gray('  1. Open Thought Traveller on your iOS device'));
        console.log(chalk.gray('  2. Enable "Monitoring Mode"'));
        console.log(chalk.gray('  3. Run this command again'));
        return;
      }

      console.log(chalk.green(`  ✓ ${connectedDevices} device(s) connected`));
      console.log('');
      console.log(chalk.white('  Sending test notification...'));
      console.log(chalk.gray('  Waiting for response (timeout: ' + options.timeout + 's)'));
      console.log('');

      const startTime = Date.now();
      const optionsArray = options.options.split(',').map((o: string) => o.trim());

      const requestBody = JSON.stringify({
        prompt: options.prompt,
        options: optionsArray,
        input_type: 'numeric',
        timeout_seconds: parseInt(options.timeout, 10),
        project_tag: 'test',
      });

      const inputResponse = await new Promise<{
        ok: boolean;
        status: number;
        data: { success: boolean; response?: string; error?: string };
      }>((resolve) => {
        const inputOptions = {
          hostname: '127.0.0.1',
          port: config.listener.port,
          path: '/input-request',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
            Authorization: `Bearer ${config.listener.auth_token}`,
          },
          ...(protocol === 'https' && { rejectUnauthorized: false }),
        };

        const req = client.request(inputOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({
              ok: res.statusCode === 200,
              status: res.statusCode || 0,
              data: JSON.parse(data),
            });
          });
        });

        req.on('error', (err) => {
          resolve({
            ok: false,
            status: 0,
            data: { success: false, error: err.message },
          });
        });

        req.write(requestBody);
        req.end();
      });

      const elapsedMs = Date.now() - startTime;
      const elapsedStr = elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;

      console.log(chalk.gray('─'.repeat(40)));

      if (inputResponse.ok && inputResponse.data.success) {
        console.log(chalk.green('  ✓ Response received!'));
        console.log('');
        console.log(chalk.white('  User selected: ') + chalk.cyan(inputResponse.data.response));
        console.log(chalk.white('  Response time: ') + elapsedStr);
        console.log('');
        console.log(chalk.green('  Test successful - mobile monitoring is working!'));
      } else if (inputResponse.status === 504) {
        console.log(chalk.yellow('  ⚠ Request timed out'));
        console.log(chalk.gray('    No response received within ' + options.timeout + ' seconds'));
        console.log(chalk.gray('    Check that the notification appeared on your device'));
      } else {
        console.log(chalk.red('  ✗ Request failed'));
        console.log(chalk.gray('    Error: ' + (inputResponse.data.error || 'Unknown error')));
      }

      console.log('');
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// APNs commands
const apnsCmd = program
  .command('apns')
  .description('Configure Apple Push Notifications for mobile monitoring');

apnsCmd
  .command('setup')
  .description('Configure APNs credentials')
  .requiredOption('-k, --key <path>', 'Path to APNs .p8 key file')
  .requiredOption('-i, --key-id <id>', 'APNs Key ID from Apple Developer portal')
  .requiredOption('-t, --team-id <id>', 'Apple Developer Team ID')
  .requiredOption('-b, --bundle-id <id>', 'App bundle identifier (e.g., com.example.traveller)')
  .option('-p, --production', 'Use production APNs server (default: sandbox)')
  .action((options) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found. Run "thought-traveller init" first.');
        process.exit(1);
      }

      const keyPath = resolvePath(options.key);
      if (!fs.existsSync(keyPath)) {
        console.error(chalk.red('Error:'), `Key file not found: ${keyPath}`);
        process.exit(1);
      }

      const config = loadConfig();

      if (!config.monitoring) {
        config.monitoring = { input_timeout_minutes: 30 };
      }

      config.monitoring.apns = {
        enabled: true,
        key_path: keyPath,
        key_id: options.keyId,
        team_id: options.teamId,
        bundle_id: options.bundleId,
        production: options.production || false,
      };

      saveConfig(config);

      console.log(chalk.green('✓ APNs configured'));
      console.log('');
      console.log(chalk.white('  Key:        ') + keyPath);
      console.log(chalk.white('  Key ID:     ') + options.keyId);
      console.log(chalk.white('  Team ID:    ') + options.teamId);
      console.log(chalk.white('  Bundle ID:  ') + options.bundleId);
      console.log(chalk.white('  Mode:       ') + (options.production ? 'production' : 'sandbox'));
      console.log('');
      console.log(chalk.gray('Restart the listener for changes to take effect.'));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

apnsCmd
  .command('status')
  .description('Show APNs configuration status')
  .action(() => {
    try {
      if (!configExists()) {
        console.log(chalk.yellow('Not configured'));
        return;
      }

      const config = loadConfig();
      const apns = config.monitoring?.apns;

      console.log('');
      console.log(chalk.cyan('APNs Configuration'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log('');

      if (!apns?.enabled) {
        console.log(chalk.gray('  APNs not configured'));
        console.log('');
        console.log(chalk.white('  To enable APNs push notifications:'));
        console.log(chalk.gray('  thought-traveller apns setup \\'));
        console.log(chalk.gray('    --key /path/to/AuthKey.p8 \\'));
        console.log(chalk.gray('    --key-id XXXXXXXXXX \\'));
        console.log(chalk.gray('    --team-id XXXXXXXXXX \\'));
        console.log(chalk.gray('    --bundle-id com.example.app'));
        return;
      }

      console.log(chalk.green('  ● APNs Enabled'));
      console.log('');
      console.log(chalk.white('  Key File:   ') + (apns.key_path || 'not set'));
      console.log(chalk.white('  Key ID:     ') + (apns.key_id || 'not set'));
      console.log(chalk.white('  Team ID:    ') + (apns.team_id || 'not set'));
      console.log(chalk.white('  Bundle ID:  ') + (apns.bundle_id || 'not set'));
      console.log(chalk.white('  Mode:       ') + (apns.production ? 'production' : 'sandbox'));

      // Check if key file exists
      if (apns.key_path && !fs.existsSync(resolvePath(apns.key_path))) {
        console.log('');
        console.log(chalk.yellow('  ⚠ Key file not found at configured path'));
      }

      console.log('');
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

apnsCmd
  .command('disable')
  .description('Disable APNs push notifications')
  .action(() => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found.');
        process.exit(1);
      }

      const config = loadConfig();

      if (config.monitoring?.apns) {
        config.monitoring.apns.enabled = false;
      }

      saveConfig(config);
      console.log(chalk.green('✓ APNs disabled'));
      console.log(chalk.gray('  WebSocket-only notifications will still work.'));
      console.log(chalk.gray('  Restart the listener for changes to take effect.'));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

apnsCmd
  .command('enable')
  .description('Re-enable previously configured APNs')
  .action(() => {
    try {
      if (!configExists()) {
        console.error(chalk.red('Error:'), 'Configuration not found.');
        process.exit(1);
      }

      const config = loadConfig();

      if (!config.monitoring?.apns?.key_path) {
        console.error(chalk.red('Error:'), 'APNs not configured. Run "thought-traveller apns setup" first.');
        process.exit(1);
      }

      config.monitoring.apns.enabled = true;
      saveConfig(config);

      console.log(chalk.green('✓ APNs enabled'));
      console.log(chalk.gray('  Restart the listener for changes to take effect.'));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// Logs command
program
  .command('logs')
  .description('View logs')
  .option('-t, --tail <lines>', 'Number of lines to show', '50')
  .option('-f, --follow', 'Follow log output (not implemented in MVP)')
  .action((options) => {
    try {
      const logsDir = getLogsDir();
      const logFile = path.join(logsDir, 'combined.log');

      if (!fs.existsSync(logFile)) {
        console.log(chalk.gray('No logs yet'));
        return;
      }

      if (options.follow) {
        console.log(chalk.yellow('Follow mode will be available in Phase 5'));
        console.log(chalk.gray('Showing last', options.tail, 'lines:'));
        console.log('');
      }

      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      const tailLines = lines.slice(-parseInt(options.tail, 10));

      for (const line of tailLines) {
        try {
          const entry = JSON.parse(line);
          const timestamp = new Date(entry.timestamp).toLocaleString();
          const level = entry.level.toUpperCase().padEnd(5);
          const levelColor = entry.level === 'error' ? chalk.red : entry.level === 'warn' ? chalk.yellow : chalk.blue;
          console.log(chalk.gray(timestamp) + ' ' + levelColor(level) + ' ' + entry.message);
        } catch {
          console.log(line);
        }
      }
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });

// Version
program.version(VERSION, '-v, --version');

// Parse and run
program.parse(process.argv);

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
