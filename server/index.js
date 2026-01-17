const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const screenshot = require('screenshot-desktop');
const { Jimp } = require('jimp');
const robot = require('robotjs');
const scrollWorker = require('./lib/scroll-worker');
const cors = require('cors');

const config = require('./config');
const configManager = config.getConfigManager();

// CLI Argument for Low-Resource Mode
const lowResourceArg = process.argv.includes('--low-resources') || process.argv.includes('-lr');
if (lowResourceArg) {
    configManager.updateGlobalConfig({ lowResourceMode: true });
    console.log('\x1b[33m%s\x1b[0m', '🚀 Low-Resource Mode activated via CLI argument');
}

const { getActiveFocus, getOpenWindows, ensureWindowActive, ensureWindowActiveByHandle } = require('./window-detector');
const terminalManager = require('./terminalManager');

const clientManager = require('./lib/ClientManager');
const StreamEngine = require('./lib/StreamEngine');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const streamEngine = new StreamEngine(io);
let vscodeSocket = null;

// Helper to get DPI scale
function getDpiScale(width, height) {
    const logical = robot.getScreenSize();
    return {
        x: width / logical.width,
        y: height / logical.height
    };
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    clientManager.addClient(socket);

    // Start streaming if we have clients
    if (io.engine.clientsCount > 0) {
        streamEngine.start();
    }

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        clientManager.removeClient(socket.id);

        if (socket === vscodeSocket) {
            console.log("VSCode Agent Disconnected");
            vscodeSocket = null;
            io.emit('vscode:status', { connected: false });
        }

        if (io.engine.clientsCount === 0) {
            streamEngine.stop();
        } else {
            streamEngine.updateInterval();
        }
    });

    // --- VSCODE AGENT HANDLERS ---
    socket.on('agent:identify', (info) => {
        if (info.type === 'vscode') {
            console.log("VSCode Agent Connected:", socket.id);
            vscodeSocket = socket;
            io.emit('vscode:status', { connected: true });
        }
    });

    socket.on('agent:update', (update) => {
        if (update.type === 'terminals') {
            io.emit('vscode:terminals', update.data);
        }
    });

    socket.on('client:vscode:action', (action) => {
        clientManager.updateActivity(socket.id);
        if (vscodeSocket) {
            vscodeSocket.emit(`vscode:${action.type}`, action.payload);
        }
    });

    // --- TERMINAL EVENTS ---
    socket.on('term:create', () => {
        clientManager.updateActivity(socket.id);
        try {
            const id = terminalManager.createTerminal(socket);
            socket.emit('term:created', { id });
            socket.emit('term:list', terminalManager.listTerminals());
            console.log(`Terminal created: ${id}`);
        } catch (e) {
            console.error("Error creating terminal:", e);
        }
    });

    socket.on('term:list', () => {
        clientManager.updateActivity(socket.id);
        socket.emit('term:list', terminalManager.listTerminals());
    });

    socket.on('term:input', ({ id, data }) => {
        clientManager.updateActivity(socket.id);
        terminalManager.write(id, data);
    });

    socket.on('term:resize', ({ id, cols, rows }) => {
        clientManager.updateActivity(socket.id);
        terminalManager.resize(id, cols, rows);
    });

    socket.on('term:kill', ({ id }) => {
        clientManager.updateActivity(socket.id);
        terminalManager.kill(id);
        socket.emit('term:list', terminalManager.listTerminals());
    });

    // --- APPS / WINDOW MANAGEMENT ---
    socket.on('apps:list', async () => {
        clientManager.updateActivity(socket.id);
        const windows = await getOpenWindows();
        socket.emit('apps:list', windows);
    });

    socket.on('apps:activate', async ({ title, handle }) => {
        clientManager.updateActivity(socket.id);
        if (handle) {
            console.log(`[${socket.id}] Activating window by handle: ${handle}`);
            await ensureWindowActiveByHandle(handle);
        } else if (title) {
            console.log(`[${socket.id}] Activating window by title: ${title}`);
            await ensureWindowActive(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
    });

    socket.on('apps:setSource', ({ type, target, handle }) => {
        clientManager.updateActivity(socket.id);
        const state = clientManager.getClientState(socket.id);
        if (state) {
            state.streamSource = { type, target, handle };
            console.log(`[${socket.id}] Stream source set to: ${type} ${target || ''} (Handle: ${handle || 'N/A'})`);
            // Force immediate update if possible
            streamEngine.updateInterval();
        }
    });

    // --- INPUT EVENTS ---
    socket.on('input:click', async (pos) => {
        clientManager.updateActivity(socket.id);
        if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;

        const state = clientManager.getClientState(socket.id);
        if (!state || !state.lastCaptureArea) return;

        try {
            const imgBuffer = await screenshot();
            const mainImage = await Jimp.read(imgBuffer);
            const scale = getDpiScale(mainImage.width, mainImage.height);

            const effectiveConfig = clientManager.getEffectiveConfig(socket.id);
            const cropTop = effectiveConfig.cropTop;
            const cropLeft = effectiveConfig.cropLeft;

            const isLowResource = configManager.isLowResourceMode();
            const downscale = isLowResource ? configManager.getImageDownscale() : 1.0;

            const absoluteX = state.lastCaptureArea.x + (pos.x / downscale) + cropLeft;
            const absoluteY = state.lastCaptureArea.y + (pos.y / downscale) + cropTop;

            state.lastClickPos = { x: absoluteX, y: absoluteY, time: Date.now() };

            const logicalX = Math.round(absoluteX / scale.x);
            const logicalY = Math.round(absoluteY / scale.y);

            robot.moveMouse(logicalX, logicalY);
            robot.mouseClick();
        } catch (e) {
            console.error("Input click error:", e);
        }
    });

    socket.on('input:type', (text) => {
        clientManager.updateActivity(socket.id);
        if (text) robot.typeString(text);
    });

    socket.on('input:keyTap', (key) => {
        clientManager.updateActivity(socket.id);
        if (key) {
            try {
                robot.keyTap(key);
            } catch (e) {
                console.error("Error tapping key:", key, e);
            }
        }
    });

    socket.on('input:scroll', async (data) => {
        clientManager.updateActivity(socket.id);
        if (!data || typeof data.deltaY !== 'number') return;

        const state = clientManager.getClientState(socket.id);
        if (!state || !state.lastCaptureArea) return;

        const effectiveConfig = clientManager.getEffectiveConfig(socket.id);

        // Use different sensitivity for three-finger scroll (reused for button mode)
        const sensitivity = data.isThreeFinger
            ? effectiveConfig.threeFingerScrollSensitivity
            : effectiveConfig.scrollSensitivity;

        let scrollTicks = 0;

        if (data.isThreeFinger) {
            // Accumulate scroll for smooth remote scrolling
            if (typeof state.scrollAccumulatorY !== 'number') state.scrollAccumulatorY = 0;
            state.scrollAccumulatorY += (data.deltaY * sensitivity);

            if (Math.abs(state.scrollAccumulatorY) >= 1) {
                scrollTicks = Math.trunc(state.scrollAccumulatorY);
                state.scrollAccumulatorY -= scrollTicks;
                console.log(`[Scroll Win] Accum: ${state.scrollAccumulatorY.toFixed(2)}, Executing: ${scrollTicks}`);
            }
        } else {
            // Direct scroll for legacy/standard
            scrollTicks = Math.round(data.deltaY * sensitivity);
        }

        if (scrollTicks === 0 && !data.isThreeFinger) return; // Ignore 0 only if direct mode

        try {
            // If coords provided (touch scroll), verify focus and position
            if (data.x !== undefined && data.y !== undefined) {
                const isLowResource = configManager.isLowResourceMode();
                const downscale = isLowResource ? configManager.getImageDownscale() : 1.0;

                const imgBuffer = await screenshot();
                const mainImage = await Jimp.read(imgBuffer);
                const scale = getDpiScale(mainImage.width, mainImage.height);

                const cropTop = effectiveConfig.cropTop;
                const cropLeft = effectiveConfig.cropLeft;
                const absoluteX = state.lastCaptureArea.x + (data.x / downscale) + cropLeft;
                const absoluteY = state.lastCaptureArea.y + (data.y / downscale) + cropTop;

                const logicalX = Math.round(absoluteX / scale.x);
                const logicalY = Math.round(absoluteY / scale.y);
                robot.moveMouse(logicalX, logicalY);
            }

            // Execute Scroll using Scroll Worker (Persistent PowerShell)
            if (scrollTicks !== 0) {
                // 1 tick = 120 native units
                scrollWorker.scroll(scrollTicks * 120);
            }
        } catch (e) {
            console.error("Scroll error:", e);
        }
    });

    // Three-finger scroll: click on panel edge to give focus before scrolling
    socket.on('input:threeFingerScrollStart', async () => {
        clientManager.updateActivity(socket.id);
        try {
            const state = clientManager.getClientState(socket.id);
            if (!state || !state.lastCaptureArea) {
                console.log('No capture area for three-finger scroll focus');
                return;
            }

            const effectiveConfig = clientManager.getEffectiveConfig(socket.id);
            const cropLeft = effectiveConfig.cropLeft || 0;
            const cropTop = effectiveConfig.cropTop || 0;

            // Click on left-center of the visible pane
            const pane = state.lastCaptureArea;
            const clickX = pane.x + cropLeft + 10; // 10px from left edge
            const clickY = pane.y + cropTop + Math.floor((pane.height - cropTop - (effectiveConfig.cropBottom || 0)) / 2);

            // Get DPI scale for correct mouse positioning
            const imgBuffer = await screenshot();
            const mainImage = await Jimp.read(imgBuffer);
            const scale = getDpiScale(mainImage.width, mainImage.height);

            const logicalX = Math.round(clickX / scale.x);
            const logicalY = Math.round(clickY / scale.y);

            robot.moveMouse(logicalX, logicalY);
            robot.mouseClick('left');

            console.log(`Three-finger scroll focus: clicked at (${logicalX}, ${logicalY})`);
        } catch (e) {
            console.error("Three-finger scroll start error:", e);
        }
    });

    socket.on('view:setMode', (mode) => {
        console.log(`[${socket.id}] Setting mode to: ${mode}`);
        clientManager.setMode(socket.id, mode);

        // Return config for validation/UI update
        const effectiveConfig = clientManager.getEffectiveConfig(socket.id);
        socket.emit('config:current', effectiveConfig);

        streamEngine.updateInterval();
    });

    socket.on('input:checkFocus', async () => {
        clientManager.updateActivity(socket.id);
        const state = clientManager.getClientState(socket.id);
        if (!state || !state.lastCaptureArea) return;

        const effectiveConfig = clientManager.getEffectiveConfig(socket.id);
        const { cropTop, cropBottom, cropLeft, cropRight } = effectiveConfig;

        const captureArea = {
            x: state.lastCaptureArea.x + cropLeft,
            y: state.lastCaptureArea.y + cropTop,
            width: state.lastCaptureArea.width - cropLeft - cropRight,
            height: state.lastCaptureArea.height - cropTop - cropBottom
        };

        let isInChat = false;

        // PRIORITY 1: Check Last Click
        if (state.lastClickPos && (Date.now() - state.lastClickPos.time < 30000)) {
            const clickInChat =
                state.lastClickPos.x >= captureArea.x &&
                state.lastClickPos.x <= (captureArea.x + captureArea.width) &&
                state.lastClickPos.y >= captureArea.y &&
                state.lastClickPos.y <= (captureArea.y + captureArea.height);

            if (clickInChat) {
                const validRelativeY = (state.lastClickPos.y - captureArea.y) / captureArea.height;
                socket.emit('input:focusLocation', {
                    isInChat: true,
                    relativeY: Math.max(0, Math.min(1, validRelativeY)),
                    focusName: "Last Click Priority"
                });
                return;
            }
        }

        // PRIORITY 2: OS Detection
        try {
            const focus = await getActiveFocus();
            if (focus.found) {
                isInChat =
                    focus.x >= captureArea.x &&
                    focus.x <= (captureArea.x + captureArea.width) &&
                    focus.y >= captureArea.y &&
                    focus.y <= (captureArea.y + captureArea.height);
            }
            socket.emit('input:focusLocation', {
                isInChat,
                relativeY: 0.5,
                focusName: focus.name
            });
        } catch (e) {
            console.error("Focus check failed:", e);
            socket.emit('input:focusLocation', { isInChat: false });
        }
    });

    socket.on('config:update', async (newConfig) => {
        clientManager.updateActivity(socket.id);
        // Delegate to configManager logic
        // We need to parse updates similar to before
        // Ideally refactor this too, but for now copying logic is safer

        console.log(`[${socket.id}] Updating config:`, newConfig);
        const state = clientManager.getClientState(socket.id);
        if (!state) return;

        // Global config updates
        const globalUpdates = {};
        let hasGlobalUpdates = false;

        // Region updates (disable auto-detection)
        if (newConfig.x !== undefined || newConfig.y !== undefined || newConfig.width !== undefined || newConfig.height !== undefined) {
            const screenConfig = configManager.getScreenConfig();
            globalUpdates.screenConfig = { ...screenConfig, ...newConfig };
            if (newConfig.x) globalUpdates.screenConfig.x = newConfig.x; // ensure
            hasGlobalUpdates = true;
            state.detectedWindow = null;
        }

        // Crop offsets
        if (newConfig.cropTop !== undefined || newConfig.cropBottom !== undefined || newConfig.cropLeft !== undefined || newConfig.cropRight !== undefined) {
            const chatCrop = configManager.getChatCrop();
            const terminalCrop = configManager.getTerminalCrop();
            const activeCrop = state.viewMode === 'chat' ? chatCrop : terminalCrop;
            const cropName = state.viewMode === 'chat' ? 'chatCrop' : 'terminalCrop';

            globalUpdates[cropName] = {
                top: newConfig.cropTop !== undefined ? newConfig.cropTop : activeCrop.top,
                bottom: newConfig.cropBottom !== undefined ? newConfig.cropBottom : activeCrop.bottom,
                left: newConfig.cropLeft !== undefined ? newConfig.cropLeft : activeCrop.left,
                right: newConfig.cropRight !== undefined ? newConfig.cropRight : activeCrop.right
            };
            hasGlobalUpdates = true;
        }

        // Simple global settings
        ['fps', 'quality', 'scrollSensitivity', 'threeFingerScrollSensitivity', 'showDebugLines', 'windowTitles', 'autoActivateWindow', 'detectionMode', 'console', 'lowResourceMode'].forEach(key => {
            if (newConfig[key] !== undefined && newConfig[key] !== null) {
                if (key === 'windowTitles') globalUpdates.targetWindowTitles = newConfig[key];
                else globalUpdates[key] = newConfig[key];
                hasGlobalUpdates = true;
            }
        });

        if (hasGlobalUpdates) {
            await configManager.updateGlobalConfig(globalUpdates);
            if (newConfig.fps || newConfig.quality) streamEngine.updateInterval();
        }

        // Client overrides
        const clientUpdates = {};
        let hasClientUpdates = false;

        if (hasClientUpdates) {
            configManager.updateClientConfig(socket.id, clientUpdates);
            streamEngine.updateInterval();
        }
    });

    socket.on('config:get', () => {
        clientManager.updateActivity(socket.id);
        const effectiveConfig = clientManager.getEffectiveConfig(socket.id);
        socket.emit('config:current', effectiveConfig);
    });

    socket.on('calibration:reset', () => {
        clientManager.updateActivity(socket.id);
        console.log(`[${socket.id}] Restarting calibration...`);
        clientManager.setMode(socket.id, clientManager.getClientState(socket.id).viewMode); // Trigger reset logic

        // Force calibration = true in state
        const state = clientManager.getClientState(socket.id);
        if (state) {
            state.calibrationMode = true;
            state.calibrationStartTime = null;
        }

        socket.emit('calibration:status', { reset: true });
    });

    socket.on('calibration:resetFixed', () => {
        clientManager.updateActivity(socket.id);
        console.log(`[${socket.id}] Resetting FIXED zones...`);
        const state = clientManager.getClientState(socket.id);
        if (state) {
            state.fixedChatZone = null;
            state.fixedTerminalZone = null;

            // Force reset of current mode
            clientManager.setMode(socket.id, state.viewMode);
            state.calibrationMode = true;
            state.calibrationStartTime = null;

            socket.emit('calibration:status', { reset: true });
        }
    });
});

server.listen(config.PORT, () => {
    console.log(`Server listening on port ${config.PORT}`);
    streamEngine.start();
});
