// Legacy config.js - now delegates to configManager for backward compatibility
const configManager = require('./configManager');

module.exports = {
    PORT: 3001,

    // Legacy accessors - these now delegate to configManager
    get SCREEN_CONFIG() { return configManager.getScreenConfig(); },
    get CHAT_CROP() {
        const crop = configManager.getChatCrop();
        return { TOP: crop.top, BOTTOM: crop.bottom, LEFT: crop.left, RIGHT: crop.right };
    },
    get TERMINAL_CROP() {
        const crop = configManager.getTerminalCrop();
        return { TOP: crop.top, BOTTOM: crop.bottom, LEFT: crop.left, RIGHT: crop.right };
    },

    // Stream settings
    get FPS() { return configManager.getDefaultFps(); },
    get FPS_MIN() { return configManager.getGlobalValue('fpsMin'); },
    get FPS_MAX() { return configManager.getGlobalValue('fpsMax'); },
    get QUALITY() { return configManager.getDefaultQuality(); },
    get QUALITY_MIN() { return configManager.getGlobalValue('qualityMin'); },
    get QUALITY_MAX() { return configManager.getGlobalValue('qualityMax'); },

    // Input settings
    get SCROLL_SENSITIVITY() { return configManager.getDefaultScrollSensitivity(); },

    // Auto-detection settings
    get DETECTION_INTERVAL() { return configManager.getDetectionInterval(); },
    get TARGET_WINDOW_TITLES() { return configManager.getTargetWindowTitles(); },
    get SHOW_DEBUG_LINES() { return configManager.getDefaultShowDebugLines(); },

    // Console settings
    get CONSOLE_CONFIG() { return configManager.getConsoleConfig(); },

    // Config manager access
    getConfigManager() { return configManager; }
};
