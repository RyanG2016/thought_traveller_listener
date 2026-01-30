import winston from 'winston';
import * as path from 'path';
import { getLogsDir, ensureConfigDir } from './config';

let logger: winston.Logger | null = null;

export function initLogger(isDaemon: boolean = false): winston.Logger {
  ensureConfigDir();
  const logsDir = getLogsDir();

  const transports: winston.transport[] = [];

  // File transport for all modes
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
    })
  );

  // Console transport only for foreground mode
  if (!isDaemon) {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      })
    );
  }

  logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports,
  });

  return logger;
}

export function getLogger(): winston.Logger {
  if (!logger) {
    return initLogger();
  }
  return logger;
}
