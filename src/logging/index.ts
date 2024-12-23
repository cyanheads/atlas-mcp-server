/**
 * Logging module
 * Provides centralized logging functionality with structured output
 */

import { createLogger, format, transports, Logger as WinstonLogger, config as winstonConfig } from 'winston';
import { join, normalize } from 'path';
import { BaseError, ErrorCodes } from '../errors/index.js';
import { LogLevel, LogLevels, LoggerConfig } from '../types/logging.js';

/**
 * Logger class
 * Provides structured logging with context and error handling
 */
export class Logger {
    private static instance: Logger;
    private logger: WinstonLogger;

    private constructor(config: LoggerConfig) {
        this.logger = this.createLogger(config);
    }

    /**
     * Gets the logger instance
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger({
                minLevel: LogLevels.INFO,
                console: true
            });
        }
        return Logger.instance;
    }

    /**
     * Initializes the logger with configuration
     */
    static initialize(config: LoggerConfig): void {
        if (Logger.instance) {
            throw new BaseError(
                ErrorCodes.INVALID_STATE,
                'Logger already initialized'
            );
        }
        Logger.instance = new Logger(config);
    }

    /**
     * Creates a child logger with additional context
     */
    child(context: Record<string, unknown>): Logger {
        const childLogger = new Logger({
            minLevel: LogLevels.INFO,
            console: true
        });
        childLogger.logger = this.logger.child(context);
        return childLogger;
    }

    /**
     * Logs a debug message
     */
    debug(message: string, context?: Record<string, unknown>): void {
        this.log(LogLevels.DEBUG, message, context);
    }

    /**
     * Logs an info message
     */
    info(message: string, context?: Record<string, unknown>): void {
        this.log(LogLevels.INFO, message, context);
    }

    /**
     * Logs a warning message
     */
    warn(message: string, context?: Record<string, unknown>): void {
        this.log(LogLevels.WARN, message, context);
    }

    /**
     * Logs an error message
     */
    error(message: string, error?: unknown, context?: Record<string, unknown>): void {
        const errorInfo = this.formatError(error);
        this.log(LogLevels.ERROR, message, { ...context, error: errorInfo });
    }

    /**
     * Logs a fatal error message (maps to error level for Winston compatibility)
     */
    fatal(message: string, error?: unknown, context?: Record<string, unknown>): void {
        const errorInfo = this.formatError(error);
        this.log(LogLevels.ERROR, message, { ...context, error: errorInfo });
    }

    /**
     * Creates the Winston logger instance
     */
    private createLogger(config: LoggerConfig): WinstonLogger {
        const loggerTransports = [];

        // Console transport
        if (config.console) {
            const formats = [format.simple()];
            if (!config.noColors) {
                formats.unshift(format.colorize());
            }
            loggerTransports.push(
                new transports.Console({
                    format: format.combine(...formats)
                })
            );
        }

        // File transport
        if (config.file && config.logDir) {
            loggerTransports.push(
                new transports.File({
                    filename: normalize(join(config.logDir, 'error.log')),
                    level: LogLevels.ERROR,
                    maxsize: config.maxFileSize,
                    maxFiles: config.maxFiles
                }),
                new transports.File({
                    filename: normalize(join(config.logDir, 'combined.log')),
                    maxsize: config.maxFileSize,
                    maxFiles: config.maxFiles
                })
            );
        }

        return createLogger({
            level: config.minLevel,
            format: format.combine(
                format.timestamp(),
                format.json()
            ),
            transports: loggerTransports,
            levels: winstonConfig.npm.levels // Use standard npm levels
        });
    }

    /**
     * Formats an error for logging
     */
    private formatError(error: unknown): Record<string, unknown> | undefined {
        if (!error) return undefined;

        if (error instanceof BaseError) {
            return {
                name: error.name,
                message: error.message,
                code: error.code,
                details: error.details,
                stack: error.stack
            };
        }

        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }

        return {
            name: 'UnknownError',
            message: String(error)
        };
    }

    /**
     * Internal log method
     */
    private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
        this.logger.log({
            level,
            message,
            ...context
        });
    }
}

/**
 * Creates a logger instance with default configuration
 */
export function createDefaultLogger(): Logger {
    try {
        return Logger.getInstance();
    } catch (error) {
        throw new BaseError(
            ErrorCodes.STORAGE_INIT,
            'Failed to create default logger',
            error
        );
    }
}

/**
 * Re-export types
 */
export type { LogLevel, LoggerConfig } from '../types/logging.js';
export { LogLevels } from '../types/logging.js';
