const screenshot = require('screenshot-desktop');
const { Jimp } = require('jimp');
const robot = require('robotjs');
const config = require('../config');
const configManager = config.getConfigManager();
const { findWindowBounds, ensureWindowActive, findWindowBoundsByHandle } = require('../window-detector');
const { findChatPaneStructural, findVerticalEdges, findHorizontalEdges, findTerminalPane, drawDebugMarkers } = require('../pane-detector');
const clientManager = require('./ClientManager');

class StreamEngine {
    constructor(io) {
        this.io = io;
        this.isStreaming = false;
        this.streamInterval = null;
        this.detectionInterval = null;
        this.isCapturing = false;
        this.globalDetectedWindow = null;
    }

    start() {
        if (this.isStreaming) return;
        this.isStreaming = true;
        this.updateInterval();
        this.startWindowDetection();
        console.log("Stream Engine started");
    }

    stop() {
        if (!this.isStreaming) return;
        this.isStreaming = false;
        if (this.streamInterval) clearInterval(this.streamInterval);
        if (this.detectionInterval) clearInterval(this.detectionInterval);
        console.log("Stream Engine stopped");
    }

    updateInterval() {
        if (this.streamInterval) clearInterval(this.streamInterval);

        const globalConfig = configManager.getGlobalConfig();
        const lowResourceMode = configManager.isLowResourceMode();
        const clients = clientManager.getAllClients();

        // In low-resource mode, use the reduced FPS
        let baseFps = lowResourceMode ? configManager.getEffectiveFps() : globalConfig.fps;

        // Find max requested FPS among clients (but cap at base if low-resource)
        const clientFps = clients.map(c => {
            const conf = clientManager.getEffectiveConfig(c.socketId);
            return conf ? conf.fps : baseFps;
        });

        const targetFps = lowResourceMode
            ? baseFps  // In low-resource mode, ignore client overrides
            : Math.max(baseFps, ...clientFps);

        const intervalMs = 1000 / targetFps;

        if (this.isStreaming) {
            this.streamInterval = setInterval(() => this.captureAndEmit(), intervalMs);
        }
    }

    startWindowDetection() {
        console.log("Starting window detection cycle");
        this.detectionInterval = setInterval(async () => {
            try {
                // Per-client detection
                const clients = clientManager.getAllClients();
                for (const state of clients) {
                    // Added 'apps' to allowed detection modes
                    if (!['chat', 'terminal', 'apps'].includes(state.viewMode)) continue;
                    if (!state.isActive) continue;

                    // Apps Mode Logic
                    if (state.viewMode === 'apps') {
                        if (state.streamSource.type === 'window') {
                            // Detect specific window
                            let bounds = null;

                            // Priority: Handle (most reliable for tracking moves/resizes)
                            if (state.streamSource.handle) {
                                bounds = await findWindowBoundsByHandle(state.streamSource.handle);
                            }

                            // Fallback: Title (if handle failed or not present)
                            if (!bounds && state.streamSource.target) {
                                bounds = await findWindowBounds(state.streamSource.target);
                            }

                            if (bounds) {
                                state.detectedWindow = bounds;
                            }
                        } else {
                            // Global or unset - full screen
                            state.detectedWindow = null;
                        }
                    } else {
                        // Standard Chat/Terminal Logic
                        const effectiveConfig = clientManager.getEffectiveConfig(state.socketId);
                        const titles = effectiveConfig.windowTitles;

                        // Activation logic
                        if (effectiveConfig.autoActivateWindow) {
                            await ensureWindowActive(titles);
                        }

                        // Detection logic
                        const bounds = await findWindowBounds(titles);
                        if (bounds) {
                            state.detectedWindow = bounds;
                        }
                    }
                }

                // Global fallback
                const globalConfig = configManager.getGlobalConfig();
                const globalBounds = await findWindowBounds(globalConfig.targetWindowTitles);
                if (globalBounds) this.globalDetectedWindow = globalBounds;

            } catch (e) {
                console.error("Window detection error:", e);
            }
        }, configManager.getDetectionInterval());
    }

    getDpiScale(width, height) {
        const logical = robot.getScreenSize();
        return {
            x: width / logical.width,
            y: height / logical.height
        };
    }

    async captureAndEmit() {
        if (this.isCapturing) return;
        this.isCapturing = true;

        try {
            const clients = clientManager.getAllClients();
            const activeLinkClients = clients.filter(c =>
                c.isActive &&
                ['chat', 'terminal', 'apps'].includes(c.viewMode)
            );

            if (activeLinkClients.length === 0) {
                this.isCapturing = false;
                return;
            }

            const imgBuffer = await screenshot();
            const mainImage = await Jimp.read(imgBuffer);
            const screenWidth = mainImage.width;
            const screenHeight = mainImage.height;
            const dpiScale = this.getDpiScale(screenWidth, screenHeight);

            for (const state of activeLinkClients) {
                const socket = this.io.sockets.sockets.get(state.socketId);
                if (!socket) continue;

                const effectiveConfig = clientManager.getEffectiveConfig(state.socketId);

                // Determine Base Region
                let baseX, baseY, baseW, baseH;
                const activeWindow = state.detectedWindow || this.globalDetectedWindow;

                if (activeWindow) {
                    baseX = Math.round(activeWindow.x * dpiScale.x);
                    baseY = Math.round(activeWindow.y * dpiScale.y);
                    baseW = Math.round(activeWindow.width * dpiScale.x);
                    baseH = Math.round(activeWindow.height * dpiScale.y);
                } else {
                    const screenConfig = configManager.getScreenConfig();
                    baseX = Math.round(screenConfig.x * dpiScale.x);
                    baseY = Math.round(screenConfig.y * dpiScale.y);
                    baseW = Math.round(screenConfig.width * dpiScale.x);
                    baseH = Math.round(screenConfig.height * dpiScale.y);
                }

                // Clip
                if (baseX < 0) baseX = 0;
                if (baseY < 0) baseY = 0;
                if (baseX + baseW > screenWidth) baseW = screenWidth - baseX;
                if (baseY + baseH > screenHeight) baseH = screenHeight - baseY;

                const clientImage = mainImage.clone().crop({ x: baseX, y: baseY, w: baseW, h: baseH });

                // Detect Pane
                let finalX = baseX;
                let finalY = baseY;
                let finalW = baseW;
                let finalH = baseH;

                // Pane Detection (only for Chat/Terminal)
                if (state.detectedWindow && ['chat', 'terminal'].includes(state.viewMode)) {
                    await this.performPaneDetection(state, clientImage, baseW, baseH);
                }

                // Apply Stable Crops
                if (state.viewMode === 'chat' && state.stablePaneX > 0) {
                    const paneW = baseW - state.stablePaneX;
                    clientImage.crop({ x: state.stablePaneX, y: 0, w: paneW, h: baseH });
                    finalX = baseX + state.stablePaneX;
                    finalW = paneW;
                } else if (state.viewMode === 'terminal' && state.stablePaneY > 0) {
                    const cropX = state.stablePaneX > 0 ? state.stablePaneX : 0;
                    const cropW = state.stablePaneW > 0 ? state.stablePaneW : baseW - cropX;
                    const cropH = state.stablePaneH > 0 ? state.stablePaneH : baseH - state.stablePaneY;

                    clientImage.crop({ x: cropX, y: state.stablePaneY, w: cropW, h: cropH });
                    finalX = baseX + cropX;
                    finalY = baseY + state.stablePaneY;
                    finalW = cropW;
                    finalH = cropH;
                }

                state.lastCaptureArea = { x: finalX, y: finalY, width: finalW, height: finalH };

                // User Manual Config Crop
                const { cropTop, cropBottom, cropLeft, cropRight } = effectiveConfig;
                let displayW = finalW - cropLeft - cropRight;
                let displayH = finalH - cropTop - cropBottom;

                if (displayH > 0 && displayW > 0) {
                    clientImage.crop({ x: cropLeft, y: cropTop, w: displayW, h: displayH });
                }

                // Determine quality - use low-resource quality if enabled
                const lowResourceMode = configManager.isLowResourceMode();
                const quality = lowResourceMode
                    ? configManager.getEffectiveQuality()
                    : effectiveConfig.quality;

                // Optional downscale for low-resource mode
                const downscale = configManager.getImageDownscale();
                if (lowResourceMode && downscale < 1.0) {
                    clientImage.scale(downscale);
                }

                const buffer = await clientImage.getBuffer("image/jpeg", { quality });
                socket.volatile.emit('frame', buffer.toString('base64'));
            }

        } catch (err) {
            console.error('StreamEngine Error:', err);
        } finally {
            this.isCapturing = false;
        }
    }

    async performPaneDetection(state, clientImage, baseW, baseH) {
        // Logic extracted from original index.js
        if (state.calibrationMode && state.calibrationStartTime === null) {
            state.calibrationStartTime = Date.now();
        }
        state.frameCount++;

        // Calibration Timeout
        const CALIBRATION_DURATION = 5000;
        if (state.calibrationMode && state.calibrationStartTime) {
            if (Date.now() - state.calibrationStartTime >= CALIBRATION_DURATION) {
                state.calibrationMode = false;
                console.log(`[${state.socketId}] CALIBRATION COMPLETE`);
            }
        }

        const effectiveConfig = clientManager.getEffectiveConfig(state.socketId);
        const isFixedMode = effectiveConfig.detectionMode === 'fixed';

        // Fast Exit if Fixed Mode AND already stable
        if (isFixedMode && !state.calibrationMode) {
            if (state.viewMode === 'chat' && state.stablePaneX > 0) return;
            if (state.viewMode === 'terminal' && state.stablePaneY > 0) return;
        }

        const shouldRunDetection = state.calibrationMode ||
            (state.frameCount % 10 === 0) || // Freq
            (state.viewMode === 'chat' && state.stablePaneX === -1) ||
            (state.viewMode === 'terminal' && state.stablePaneY === -1);

        if (!shouldRunDetection) return;

        const isQuiet = !state.calibrationMode;

        if (state.viewMode === 'chat') {
            let paneBounds = await findChatPaneStructural(clientImage, { quiet: isQuiet });
            if (paneBounds) {
                const detectedX = paneBounds.x;
                if (Math.abs(detectedX - state.lastPaneX) < 5) {
                    state.stabilityCount++;
                } else {
                    state.stabilityCount = 0;
                    state.lastPaneX = detectedX;
                }
                if (state.stabilityCount >= 3) {
                    state.stablePaneX = state.lastPaneX;
                    // AUTO-LOCK: If in fixed mode, save this result
                    if (isFixedMode) {
                        state.fixedChatZone = { stablePaneX: state.stablePaneX };
                        state.calibrationMode = false; // Stop searching
                        console.log(`[${state.socketId}] FIXED MODE: Chat zone locked at X=${state.stablePaneX}`);
                    }
                }
                if (state.calibrationMode && state.showDebugLines) {
                    const edges = findVerticalEdges(clientImage, { minEdgeScore: 0.50, edgeThreshold: 20, sampleStep: 8 });
                    drawDebugMarkers(clientImage, edges, state.stablePaneX > 0 ? state.stablePaneX : detectedX, false);
                }
            }
        } else if (state.viewMode === 'terminal') {
            let paneBounds = await findTerminalPane(clientImage, { quiet: isQuiet });
            if (paneBounds) {
                const detectedY = paneBounds.y;
                const detectedX = paneBounds.x;
                const detectedW = paneBounds.width;
                const detectedH = paneBounds.height;

                if (Math.abs(detectedY - state.lastPaneY) < 5 && Math.abs(detectedX - state.lastPaneX) < 5) {
                    state.stabilityCount++;
                } else {
                    state.stabilityCount = 0;
                    state.lastPaneY = detectedY;
                    state.lastPaneX = detectedX;
                }

                if (state.stabilityCount >= 3) {
                    state.stablePaneY = state.lastPaneY;
                    state.stablePaneX = state.lastPaneX;
                    state.stablePaneW = detectedW;
                    state.stablePaneH = detectedH;

                    // AUTO-LOCK: If in fixed mode, save this result
                    if (isFixedMode) {
                        state.fixedTerminalZone = {
                            stablePaneX: state.stablePaneX,
                            stablePaneY: state.stablePaneY,
                            stablePaneW: state.stablePaneW,
                            stablePaneH: state.stablePaneH
                        };
                        state.calibrationMode = false; // Stop searching
                        console.log(`[${state.socketId}] FIXED MODE: Terminal zone locked`);
                    }
                }

                if (state.calibrationMode && state.showDebugLines) {
                    const hEdges = findHorizontalEdges(clientImage, { minEdgeScore: 0.50, edgeThreshold: 20, sampleStep: 8 });
                    const selectedY = state.stablePaneY > 0 ? state.stablePaneY : detectedY;
                    const selectedH = state.stablePaneH > 0 ? state.stablePaneH : detectedH;
                    drawDebugMarkers(clientImage, hEdges, [selectedY, selectedY + selectedH], true);

                    const vEdges = findVerticalEdges(clientImage, { minEdgeScore: 0.40, edgeThreshold: 20, sampleStep: 8, fullWidth: true });
                    drawDebugMarkers(clientImage, vEdges, [paneBounds.x, paneBounds.x + paneBounds.width], false);
                }
            }
        }
    }
}

module.exports = StreamEngine;
