/**
 * Configuration module
 * Handles application configuration management
 */

import { ConfigError, ErrorCodes } from '../errors/index.js';
import { LogLevel, LogLevels } from '../types/logging.js';

/**
 * Environment variable names
 */
export const EnvVars = {
    NODE_ENV: 'NODE_ENV',
    LOG_LEVEL: 'LOG_LEVEL',
    ATLAS_STORAGE_DIR: 'ATLAS_STORAGE_DIR',
    ATLAS_STORAGE_NAME: 'ATLAS_STORAGE_NAME'
} as const;

/**
 * Environment types
 */
export const Environments = {
    DEVELOPMENT: 'development',
    PRODUCTION: 'production',
    TEST: 'test'
} as const;

/**
 * Logging configuration type
 */
export interface LoggingConfig {
    level: LogLevel;
    console: boolean;
    file: boolean;
    dir?: string;
    maxFiles: number;
    maxSize: number;
}

/**
 * Configuration schema
 */
export const configSchema = {
    env: {
        type: 'string',
        enum: [
            Environments.DEVELOPMENT,
            Environments.PRODUCTION,
            Environments.TEST
        ],
        default: Environments.DEVELOPMENT
    },
    logging: {
        type: 'object',
        properties: {
            level: {
                type: 'string',
                enum: [
                    LogLevels.ERROR,
                    LogLevels.WARN,
                    LogLevels.INFO,
                    LogLevels.HTTP,
                    LogLevels.VERBOSE,
                    LogLevels.DEBUG,
                    LogLevels.SILLY
                ],
                default: LogLevels.INFO
            },
            console: {
                type: 'boolean',
                default: true
            },
            file: {
                type: 'boolean',
                default: false
            },
            dir: {
                type: 'string',
                optional: true
            },
            maxFiles: {
                type: 'number',
                minimum: 1,
                default: 5
            },
            maxSize: {
                type: 'number',
                minimum: 1024,
                default: 5242880 // 5MB
            }
        },
        required: ['level']
    },
    storage: {
        type: 'object',
        properties: {
            baseDir: {
                type: 'string'
            },
            name: {
                type: 'string'
            },
            connection: {
                type: 'object',
                properties: {
                    maxRetries: {
                        type: 'number',
                        minimum: 1,
                        optional: true
                    },
                    retryDelay: {
                        type: 'number',
                        minimum: 0,
                        optional: true
                    },
                    busyTimeout: {
                        type: 'number',
                        minimum: 0,
                        optional: true
                    }
                },
                optional: true
            },
            performance: {
                type: 'object',
                properties: {
                    checkpointInterval: {
                        type: 'number',
                        minimum: 0,
                        optional: true
                    },
                    cacheSize: {
                        type: 'number',
                        minimum: 0,
                        optional: true
                    },
                    mmapSize: {
                        type: 'number',
                        minimum: 0,
                        optional: true
                    },
                    pageSize: {
                        type: 'number',
                        minimum: 0,
                        optional: true
                    }
                },
                optional: true
            }
        },
        required: ['baseDir', 'name']
    }
};

/**
 * Default logging configuration
 */
const defaultLoggingConfig: LoggingConfig = {
    level: LogLevels.INFO,
    console: true,
    file: false,
    maxFiles: 5,
    maxSize: 5242880
};

/**
 * Default configuration values
 */
export const defaultConfig = {
    env: Environments.DEVELOPMENT,
    logging: defaultLoggingConfig
};

/**
 * Configuration manager class
 */
export class ConfigManager {
    private static instance: ConfigManager;
    private config: any;

    private constructor(initialConfig: any = {}) {
        this.config = this.loadConfig(initialConfig);
    }

    /**
     * Gets the configuration manager instance
     */
    static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    /**
     * Initializes the configuration manager with custom config
     */
    static initialize(config: any): void {
        if (ConfigManager.instance) {
            throw new ConfigError(
                ErrorCodes.CONFIG_INVALID,
                'Configuration already initialized'
            );
        }
        ConfigManager.instance = new ConfigManager(config);
    }

    /**
     * Gets the current configuration
     */
    getConfig(): any {
        return { ...this.config };
    }

    /**
     * Updates the configuration
     */
    updateConfig(updates: any): void {
        const newConfig = {
            ...this.config,
            ...updates,
            logging: {
                ...this.config.logging,
                ...(updates.logging || {})
            },
            storage: {
                ...this.config.storage,
                ...(updates.storage || {})
            }
        };

        this.validateConfig(newConfig);
        this.config = newConfig;
    }

    /**
     * Loads and validates configuration
     */
    private loadConfig(customConfig: any): any {
        try {
            // Load from environment
            const envConfig = this.loadEnvConfig(customConfig);

            // Merge configurations with precedence:
            // custom > environment > default
            const mergedConfig = {
                ...defaultConfig,
                ...envConfig,
                ...customConfig,
                logging: {
                    ...defaultLoggingConfig,
                    ...(envConfig.logging || {}),
                    ...(customConfig.logging || {})
                },
                storage: {
                    ...(envConfig.storage || {}),
                    ...(customConfig.storage || {})
                }
            };

            // Validate final configuration
            this.validateConfig(mergedConfig);

            return mergedConfig;
        } catch (error) {
            if (error instanceof ConfigError) {
                throw error;
            }
            throw new ConfigError(
                ErrorCodes.CONFIG_INVALID,
                'Failed to load configuration',
                error
            );
        }
    }

    /**
     * Loads configuration from environment variables
     */
    private loadEnvConfig(customConfig: any): any {
        const env = process.env[EnvVars.NODE_ENV];
        const logLevel = process.env[EnvVars.LOG_LEVEL];
        const storageDir = customConfig.storage?.baseDir || process.env[EnvVars.ATLAS_STORAGE_DIR];
        const storageName = customConfig.storage?.name || process.env[EnvVars.ATLAS_STORAGE_NAME] || 'atlas-tasks';

        if (!storageDir) {
            throw new ConfigError(
                ErrorCodes.CONFIG_MISSING,
                'Storage directory must be provided'
            );
        }

        const config: any = {
            storage: {
                baseDir: storageDir,
                name: storageName,
                connection: {
                    maxRetries: 3,
                    retryDelay: 1000,
                    busyTimeout: 5000
                },
                performance: {
                    checkpointInterval: 300000, // 5 minutes
                    cacheSize: 2000,
                    mmapSize: 30000000000, // 30GB
                    pageSize: 4096
                }
            },
            logging: { ...defaultLoggingConfig }
        };

        if (env) {
            if (!Object.values(Environments).includes(env as any)) {
                throw new ConfigError(
                    ErrorCodes.CONFIG_INVALID,
                    'Invalid environment'
                );
            }
            config.env = env;
        }

        if (logLevel) {
            const level = logLevel.toLowerCase();
            if (!Object.values(LogLevels).includes(level as any)) {
                throw new ConfigError(
                    ErrorCodes.CONFIG_INVALID,
                    'Invalid log level'
                );
            }
            config.logging!.level = level;
        }

        return config;
    }

    /**
     * Validates configuration against schema
     */
    private validateConfig(config: any): void {
        // Basic validation - could be expanded
        if (!config.storage?.baseDir) {
            throw new ConfigError(
                ErrorCodes.CONFIG_MISSING,
                'Storage directory must be provided'
            );
        }

        if (config.logging?.level && !Object.values(LogLevels).includes(config.logging.level)) {
            throw new ConfigError(
                ErrorCodes.CONFIG_INVALID,
                'Invalid log level'
            );
        }
    }
}

/**
 * Creates a default configuration manager
 */
export function createDefaultConfig(): ConfigManager {
    return ConfigManager.getInstance();
}
