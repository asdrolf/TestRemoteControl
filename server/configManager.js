const fs = require('fs').promises;
const path = require('path');

class ConfigManager {
    constructor() {
        this.configPath = path.join(__dirname, 'config.json');
        this.defaults = {
            // Global settings (shared across all clients)
            global: {
                // Screen capture settings
                screenConfig: {
                    x: 0,
                    y: 0,
                    width: 800,
                    height: 600
                },

                // Fixed cropping regions
                chatCrop: {
                    top: 40,
                    bottom: 40,
                    left: 0,
                    right: 0
                },
                terminalCrop: {
                    top: 10,
                    bottom: 10,
                    left: 0,
                    right: 0
                },

                // Stream defaults
                fps: 30,
                fpsMin: 10,
                fpsMax: 60,
                quality: 70,
                qualityMin: 30,
                qualityMax: 100,

                // Input defaults
                scrollSensitivity: 1.0,
                threeFingerScrollSensitivity: 1.0,

                // Detection settings
                detectionInterval: 2000,
                targetWindowTitles: "Cursor|Antigravity|Windsurf",
                detectionMode: 'dynamic', // 'dynamic' | 'fixed'
                showDebugLines: true,
                autoActivateWindow: true,

                // Console settings
                console: {
                    fontSize: 14,
                    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                    theme: 'dark',
                    cursorStyle: 'block',
                    cursorBlink: true,
                    lineHeight: 1.2,
                    letterSpacing: 0,
                    colors: {
                        background: '#1e1e1e',
                        foreground: '#cccccc',
                        cursor: '#ffffff',
                        selection: 'rgba(255, 255, 255, 0.3)',
                        black: '#000000',
                        red: '#cd3131',
                        green: '#0dbc79',
                        yellow: '#e5e510',
                        blue: '#2472c8',
                        magenta: '#bc3fbc',
                        cyan: '#11a8cd',
                        white: '#e5e5e5',
                        brightBlack: '#666666',
                        brightRed: '#f14c4c',
                        brightGreen: '#23d18b',
                        brightYellow: '#f5f543',
                        brightBlue: '#3b8eea',
                        brightMagenta: '#d670d6',
                        brightCyan: '#29b8db',
                        brightWhite: '#e5e5e5'
                    }
                }
            },

            // Per-client settings templates
            clientDefaults: {
                // Stream overrides
                fps: null, // null means use global default
                quality: null,

                // Input overrides
                scrollSensitivity: null,
                threeFingerScrollSensitivity: null,

                // Detection overrides
                windowTitles: null,
                detectionMode: null,

                showDebugLines: null,
                autoActivateWindow: null,

                // UI preferences
                theme: 'dark',
                fabPosition: 'bottom-right',

                // Console overrides
                console: {
                    fontSize: null,
                    fontFamily: null,
                    theme: null,
                    cursorStyle: null,
                    cursorBlink: null,
                    lineHeight: null,
                    letterSpacing: null,
                    colors: null
                }
            }
        };

        this.config = {
            global: { ...this.defaults.global },
            clients: new Map() // socketId -> client config
        };

        this.loadConfig();
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            const saved = JSON.parse(data);

            // Merge saved global config with defaults
            this.config.global = { ...this.defaults.global, ...saved.global };

            console.log('Configuration loaded from file');
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('No saved configuration found, using defaults');
            } else {
                console.error('Error loading configuration:', error);
            }
            // Save defaults if file doesn't exist
            await this.saveConfig();
        }
    }

    async saveConfig() {
        try {
            const toSave = {
                global: this.config.global,
                // Don't save per-client configs to file (they're session-based)
                lastSaved: new Date().toISOString()
            };

            await fs.writeFile(this.configPath, JSON.stringify(toSave, null, 2));
            console.log('Configuration saved to file');
        } catch (error) {
            console.error('Error saving configuration:', error);
        }
    }

    // Global config getters
    getGlobalConfig() {
        return { ...this.config.global };
    }

    getGlobalValue(key) {
        return this.config.global[key];
    }

    // Update global config
    async updateGlobalConfig(updates) {
        // Validate and sanitize updates
        const sanitized = {};

        // Screen config
        if (updates.screenConfig) {
            sanitized.screenConfig = {
                x: Math.max(0, updates.screenConfig.x || 0),
                y: Math.max(0, updates.screenConfig.y || 0),
                width: Math.max(100, updates.screenConfig.width || 800),
                height: Math.max(100, updates.screenConfig.height || 600)
            };
        }

        // Crop configs
        if (updates.chatCrop) {
            sanitized.chatCrop = {
                top: Math.max(0, updates.chatCrop.top || 0),
                bottom: Math.max(0, updates.chatCrop.bottom || 0),
                left: Math.max(0, updates.chatCrop.left || 0),
                right: Math.max(0, updates.chatCrop.right || 0)
            };
        }

        if (updates.terminalCrop) {
            sanitized.terminalCrop = {
                top: Math.max(0, updates.terminalCrop.top || 0),
                bottom: Math.max(0, updates.terminalCrop.bottom || 0),
                left: Math.max(0, updates.terminalCrop.left || 0),
                right: Math.max(0, updates.terminalCrop.right || 0)
            };
        }

        // Stream settings
        if (updates.fps !== undefined) {
            sanitized.fps = Math.max(this.config.global.fpsMin, Math.min(this.config.global.fpsMax, updates.fps));
        }
        if (updates.quality !== undefined) {
            sanitized.quality = Math.max(this.config.global.qualityMin, Math.min(this.config.global.qualityMax, updates.quality));
        }

        // Input settings
        if (updates.scrollSensitivity !== undefined) {
            sanitized.scrollSensitivity = Math.max(0.1, Math.min(5.0, updates.scrollSensitivity));
        }
        if (updates.threeFingerScrollSensitivity !== undefined) {
            sanitized.threeFingerScrollSensitivity = Math.max(0.3, Math.min(3.0, updates.threeFingerScrollSensitivity));
        }

        // Detection settings
        if (updates.detectionInterval !== undefined) {
            sanitized.detectionInterval = Math.max(500, Math.min(10000, updates.detectionInterval));
        }
        if (updates.targetWindowTitles !== undefined) {
            sanitized.targetWindowTitles = updates.targetWindowTitles;
        }
        if (updates.detectionMode !== undefined) {
            sanitized.detectionMode = updates.detectionMode; // 'dynamic' or 'fixed'
        }
        if (updates.showDebugLines !== undefined) {
            sanitized.showDebugLines = !!updates.showDebugLines;
        }
        if (updates.autoActivateWindow !== undefined) {
            sanitized.autoActivateWindow = !!updates.autoActivateWindow;
        }

        // Console settings
        if (updates.console) {
            sanitized.console = { ...this.config.global.console };

            if (updates.console.fontSize !== undefined) {
                sanitized.console.fontSize = Math.max(8, Math.min(32, updates.console.fontSize));
            }
            if (updates.console.fontFamily !== undefined) {
                sanitized.console.fontFamily = updates.console.fontFamily;
            }
            if (updates.console.theme !== undefined) {
                sanitized.console.theme = updates.console.theme;
            }
            if (updates.console.cursorStyle !== undefined) {
                sanitized.console.cursorStyle = updates.console.cursorStyle;
            }
            if (updates.console.cursorBlink !== undefined) {
                sanitized.console.cursorBlink = !!updates.console.cursorBlink;
            }
            if (updates.console.lineHeight !== undefined) {
                sanitized.console.lineHeight = Math.max(0.8, Math.min(2.0, updates.console.lineHeight));
            }
            if (updates.console.letterSpacing !== undefined) {
                sanitized.console.letterSpacing = Math.max(-2, Math.min(10, updates.console.letterSpacing));
            }
            if (updates.console.colors) {
                sanitized.console.colors = { ...this.config.global.console.colors, ...updates.console.colors };
            }
        }

        // Apply updates
        this.config.global = { ...this.config.global, ...sanitized };
        await this.saveConfig();

        console.log('Global configuration updated:', sanitized);
        return sanitized;
    }

    // Per-client config management
    getClientConfig(socketId) {
        if (!this.config.clients.has(socketId)) {
            this.config.clients.set(socketId, { ...this.defaults.clientDefaults });
        }
        return this.config.clients.get(socketId);
    }

    updateClientConfig(socketId, updates) {
        const clientConfig = this.getClientConfig(socketId);
        const sanitized = {};

        // Stream overrides
        if (updates.fps !== undefined) {
            sanitized.fps = updates.fps === null ? null : Math.max(this.config.global.fpsMin, Math.min(this.config.global.fpsMax, updates.fps));
        }
        if (updates.quality !== undefined) {
            sanitized.quality = updates.quality === null ? null : Math.max(this.config.global.qualityMin, Math.min(this.config.global.qualityMax, updates.quality));
        }

        // Input overrides
        if (updates.scrollSensitivity !== undefined) {
            sanitized.scrollSensitivity = updates.scrollSensitivity === null ? null : Math.max(0.1, Math.min(5.0, updates.scrollSensitivity));
        }
        if (updates.threeFingerScrollSensitivity !== undefined) {
            sanitized.threeFingerScrollSensitivity = updates.threeFingerScrollSensitivity === null
                ? null
                : Math.max(0.3, Math.min(3.0, updates.threeFingerScrollSensitivity));
        }

        // Detection overrides
        if (updates.windowTitles !== undefined) {
            sanitized.windowTitles = updates.windowTitles;
        }
        if (updates.detectionMode !== undefined) {
            sanitized.detectionMode = updates.detectionMode;
        }
        if (updates.showDebugLines !== undefined) {
            sanitized.showDebugLines = updates.showDebugLines;
        }
        if (updates.autoActivateWindow !== undefined) {
            sanitized.autoActivateWindow = updates.autoActivateWindow;
        }

        // UI preferences
        if (updates.theme !== undefined) {
            sanitized.theme = updates.theme;
        }
        if (updates.fabPosition !== undefined) {
            sanitized.fabPosition = updates.fabPosition;
        }

        // Console overrides
        if (updates.console) {
            sanitized.console = { ...clientConfig.console };

            if (updates.console.fontSize !== undefined) {
                sanitized.console.fontSize = updates.console.fontSize === null ? null : Math.max(8, Math.min(32, updates.console.fontSize));
            }
            if (updates.console.fontFamily !== undefined) {
                sanitized.console.fontFamily = updates.console.fontFamily;
            }
            if (updates.console.theme !== undefined) {
                sanitized.console.theme = updates.console.theme;
            }
            if (updates.console.cursorStyle !== undefined) {
                sanitized.console.cursorStyle = updates.console.cursorStyle;
            }
            if (updates.console.cursorBlink !== undefined) {
                sanitized.console.cursorBlink = updates.console.cursorBlink === null ? null : !!updates.console.cursorBlink;
            }
            if (updates.console.lineHeight !== undefined) {
                sanitized.console.lineHeight = updates.console.lineHeight === null ? null : Math.max(0.8, Math.min(2.0, updates.console.lineHeight));
            }
            if (updates.console.letterSpacing !== undefined) {
                sanitized.console.letterSpacing = updates.console.letterSpacing === null ? null : Math.max(-2, Math.min(10, updates.console.letterSpacing));
            }
            if (updates.console.colors) {
                sanitized.console.colors = updates.console.colors;
            }
        }

        // Apply updates
        const updated = { ...clientConfig, ...sanitized };
        this.config.clients.set(socketId, updated);

        console.log(`Client ${socketId} configuration updated:`, sanitized);
        return updated;
    }

    removeClientConfig(socketId) {
        this.config.clients.delete(socketId);
    }

    // Get effective config for a client (client overrides + global defaults)
    getEffectiveConfig(socketId, viewMode = 'chat') {
        const global = this.config.global;
        const client = this.getClientConfig(socketId);

        const effective = {
            // Stream settings
            fps: client.fps !== null ? client.fps : global.fps,
            fpsMin: global.fpsMin,
            fpsMax: global.fpsMax,
            quality: client.quality !== null ? client.quality : global.quality,
            qualityMin: global.qualityMin,
            qualityMax: global.qualityMax,

            // Input settings
            scrollSensitivity: client.scrollSensitivity !== null ? client.scrollSensitivity : global.scrollSensitivity,
            threeFingerScrollSensitivity: client.threeFingerScrollSensitivity !== null
                ? client.threeFingerScrollSensitivity
                : global.threeFingerScrollSensitivity,

            // Detection settings
            windowTitles: client.windowTitles || global.targetWindowTitles,
            detectionMode: client.detectionMode || global.detectionMode,
            showDebugLines: client.showDebugLines !== null ? client.showDebugLines : global.showDebugLines,
            autoActivateWindow: client.autoActivateWindow !== null ? client.autoActivateWindow : global.autoActivateWindow,

            // UI preferences
            theme: client.theme,
            fabPosition: client.fabPosition,

            // Crop settings based on view mode
            cropTop: viewMode === 'chat' ? global.chatCrop.top : global.terminalCrop.top,
            cropBottom: viewMode === 'chat' ? global.chatCrop.bottom : global.terminalCrop.bottom,
            cropLeft: viewMode === 'chat' ? global.chatCrop.left : global.terminalCrop.left,
            cropRight: viewMode === 'chat' ? global.chatCrop.right : global.terminalCrop.right,

            // Console settings (with inheritance)
            console: {
                fontSize: client.console.fontSize !== null ? client.console.fontSize : global.console.fontSize,
                fontFamily: client.console.fontFamily || global.console.fontFamily,
                theme: client.console.theme || global.console.theme,
                cursorStyle: client.console.cursorStyle || global.console.cursorStyle,
                cursorBlink: client.console.cursorBlink !== null ? client.console.cursorBlink : global.console.cursorBlink,
                lineHeight: client.console.lineHeight !== null ? client.console.lineHeight : global.console.lineHeight,
                letterSpacing: client.console.letterSpacing !== null ? client.console.letterSpacing : global.console.letterSpacing,
                colors: client.console.colors || global.console.colors
            }
        };

        return effective;
    }

    // Utility methods for backward compatibility
    getScreenConfig() { return this.config.global.screenConfig; }
    getChatCrop() { return this.config.global.chatCrop; }
    getTerminalCrop() { return this.config.global.terminalCrop; }
    getDefaultFps() { return this.config.global.fps; }
    getDefaultQuality() { return this.config.global.quality; }
    getDefaultScrollSensitivity() { return this.config.global.scrollSensitivity; }
    getDetectionInterval() { return this.config.global.detectionInterval; }
    getTargetWindowTitles() { return this.config.global.targetWindowTitles; }
    getDefaultShowDebugLines() { return this.config.global.showDebugLines; }
    getDefaultAutoActivateWindow() { return this.config.global.autoActivateWindow; }
    getConsoleConfig() { return this.config.global.console; }
}

module.exports = new ConfigManager();