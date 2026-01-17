const config = require('../config');
const configManager = config.getConfigManager();

const INACTIVITY_TIMEOUT_MS = 60000; // 1 minute inactivity timeout

class ClientManager {
    constructor() {
        this.clientStates = new Map();
        this.inactivityInterval = setInterval(() => this.checkInactivity(), 10000);
    }

    createDefaultClientState(socketId) {
        return {
            socketId,
            viewMode: 'chat', // Default to chat, but can be switched
            lastActivity: Date.now(),
            isActive: true, // Used for logical activity (connected and awake)

            // Detection State
            calibrationMode: true,
            calibrationStartTime: null,
            frameCount: 0,
            lastPaneX: -1,
            stablePaneX: -1,
            lastPaneY: -1,
            stablePaneY: -1,
            stablePaneW: -1,
            stablePaneH: -1,
            stabilityCount: 0,

            // Detection Cache
            detectedWindow: null,
            lastCaptureArea: null,

            // Fixed Mode Zones (Persistent)
            fixedChatZone: null,
            fixedTerminalZone: null,

            // Input State
            lastClickPos: null,
            scrollAccumulatorY: 0,

            // Config Overrides (null means use global)
            fps: null,
            quality: null,
            scrollSensitivity: null,
            windowTitles: null,
            showDebugLines: null,
            autoActivateWindow: null,
            detectionMode: null,
            theme: null,
            fabPosition: null,
            console: null,

            // Stream Source State
            streamSource: { type: 'auto', target: null } // type: 'auto' | 'global' | 'window'
        };
    }

    addClient(socket) {
        if (!this.clientStates.has(socket.id)) {
            const state = this.createDefaultClientState(socket.id);
            this.clientStates.set(socket.id, state);
            return state;
        }
        return this.clientStates.get(socket.id);
    }

    removeClient(socketId) {
        this.clientStates.delete(socketId);
        configManager.removeClientConfig(socketId);
    }

    getClientState(socketId) {
        return this.clientStates.get(socketId);
    }

    getAllClients() {
        return Array.from(this.clientStates.values());
    }

    updateActivity(socketId) {
        const state = this.clientStates.get(socketId);
        if (state) {
            state.lastActivity = Date.now();
            if (!state.isActive) {
                state.isActive = true;
                console.log(`[${socketId}] Client woke up`);
            }
        }
    }

    checkInactivity() {
        const now = Date.now();
        for (const [socketId, state] of this.clientStates.entries()) {
            if (state.isActive && (now - state.lastActivity > INACTIVITY_TIMEOUT_MS)) {
                console.log(`[${socketId}] Client inactive - pausing stream`);
                state.isActive = false;
                state.viewMode = 'idle'; // Switch to idle to stop streaming
            }
        }
    }

    setMode(socketId, mode) {
        const state = this.clientStates.get(socketId);
        if (!state) return;

        // Reset stable values on significant mode switches
        // Only reset if we are in 'auto' stream mode (standard chat/terminal detection)
        if (['chat', 'terminal'].includes(mode) && state.viewMode !== mode) {
            const config = this.getEffectiveConfig(socketId);

            // IF FIXED MODE: Check if we have a cached zone
            if (config.detectionMode === 'fixed') {
                if (mode === 'chat' && state.fixedChatZone) {
                    // Restore chat zone
                    state.stablePaneX = state.fixedChatZone.stablePaneX;
                    state.lastPaneX = state.fixedChatZone.stablePaneX;
                    state.stabilityCount = 3;
                    state.calibrationMode = false;
                    console.log(`[${socketId}] Restored FIXED chat zone`);
                } else if (mode === 'terminal' && state.fixedTerminalZone) {
                    // Restore terminal zone
                    state.stablePaneX = state.fixedTerminalZone.stablePaneX;
                    state.stablePaneY = state.fixedTerminalZone.stablePaneY;
                    state.stablePaneW = state.fixedTerminalZone.stablePaneW;
                    state.stablePaneH = state.fixedTerminalZone.stablePaneH;

                    state.lastPaneX = state.fixedTerminalZone.stablePaneX;
                    state.lastPaneY = state.fixedTerminalZone.stablePaneY;
                    state.stabilityCount = 3;
                    state.calibrationMode = false;
                    console.log(`[${socketId}] Restored FIXED terminal zone`);
                } else {
                    // Start fresh calibration for this mode
                    this.resetDetectionState(state);
                }
            } else {
                // DYNAMIC MODE: Always reset
                this.resetDetectionState(state);
            }
        }

        state.viewMode = mode;
        this.updateActivity(socketId);
    }

    resetDetectionState(state) {
        state.stablePaneX = -1;
        state.stablePaneY = -1;
        state.stabilityCount = 0;
        state.calibrationMode = true;
        state.calibrationStartTime = null;
    }

    getEffectiveConfig(socketId, viewModeOverride = null) {
        const state = this.clientStates.get(socketId);
        if (!state) return configManager.getGlobalConfig(); // Fallback

        const effectiveViewMode = viewModeOverride || state.viewMode;
        return configManager.getEffectiveConfig(socketId, effectiveViewMode);
    }
}

module.exports = new ClientManager();
