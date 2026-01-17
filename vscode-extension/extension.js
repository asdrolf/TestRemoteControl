const vscode = require('vscode');
const io = require('socket.io-client');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Create Output Channel
    const outputChannel = vscode.window.createOutputChannel("Remote Control Bridge");
    outputChannel.show(true);
    outputChannel.appendLine('Remote Control Bridge is active');

    // Connect to the local server
    // Server runs on port 3001
    // Connect to the local server
    // Server runs on port 3001
    const socket = io('http://localhost:3001');

    socket.on('connect', () => {
        outputChannel.appendLine('✅ Connected to Remote Control Server');
        socket.emit('agent:identify', { type: 'vscode' });

        // Send initial list
        pushTerminalList(socket);
    });

    // Handle refresh request
    socket.on('vscode:refresh', () => {
        pushTerminalList(socket);
    });

    socket.on('connect_error', (err) => {
        outputChannel.appendLine(`⚠️ Connection Error: ${err.message}`);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from Remote Control Server');
    });

    // --- Command Handlers ---

    // Focus a terminal
    socket.on('vscode:focus', (termId) => {
        // ID format: vscode-{index}-{name}
        if (typeof termId === 'string' && termId.startsWith('vscode-')) {
            const parts = termId.split('-');
            const index = parseInt(parts[1], 10);
            const term = vscode.window.terminals[index];
            if (term) {
                term.show();
            }
        } else {
            // Fallback for name-based lookup (legacy or error)
            const term = vscode.window.terminals.find(t => t.name === termId);
            if (term) term.show();
        }
    });

    // Create a new terminal
    socket.on('vscode:create', (name) => {
        const term = vscode.window.createTerminal(name || "Remote Term");
        term.show();
        // The onDidOpenTerminal event will trigger the list update
    });

    // Send text to terminal
    socket.on('vscode:type', ({ id, text }) => {
        let term;
        if (id && id.startsWith('vscode-')) {
            const index = parseInt(id.split('-')[1], 10);
            term = vscode.window.terminals[index];
        }

        if (term) {
            // Check for control characters if needed, but normally sendText handles it.
            // For Ctrl+C, the client might send "\x03"
            term.sendText(text, false);
        }
    });

    // Execute command (with auto-enter)
    socket.on('vscode:run', ({ name, command }) => {
        const term = name
            ? vscode.window.terminals.find(t => t.name === name)
            : vscode.window.activeTerminal;

        if (term) {
            term.sendText(command, true);
        }
    });

    // Kill a terminal
    socket.on('vscode:kill', async (termId) => {
        outputChannel.appendLine(`[DEBUG] Request to kill terminal: ${termId}`);
        if (typeof termId === 'string' && termId.startsWith('vscode-')) {
            const index = parseInt(termId.split('-')[1], 10);
            const term = vscode.window.terminals[index];
            if (term) {
                // Try to force kill the process tree on Windows
                if (process.platform === 'win32') {
                    try {
                        const pid = await term.processId;
                        outputChannel.appendLine(`[DEBUG] Terminal PID: ${pid}`);
                        if (pid) {
                            const cmd = `taskkill /pid ${pid} /T /F`;
                            outputChannel.appendLine(`[DEBUG] Executing: ${cmd}`);

                            require('child_process').exec(cmd, (error, stdout, stderr) => {
                                if (error) {
                                    outputChannel.appendLine(`[ERROR] Taskkill failed: ${error.message}`);
                                    return;
                                }
                                if (stderr) {
                                    outputChannel.appendLine(`[WARN] Taskkill stderr: ${stderr}`);
                                }
                                outputChannel.appendLine(`[INFO] Taskkill output: ${stdout}`);
                            });
                        } else {
                            outputChannel.appendLine(`[WARN] Could not retrieve PID for terminal.`);
                        }
                    } catch (e) {
                        outputChannel.appendLine(`[ERROR] Failed to kill terminal process: ${e.message}`);
                    }
                }
                term.dispose();
                outputChannel.appendLine(`[INFO] Terminal disposed.`);
            } else {
                outputChannel.appendLine(`[WARN] Terminal at index ${index} not found.`);
            }
        } else {
            outputChannel.appendLine(`[WARN] Invalid terminal ID format: ${termId}`);
        }
    });

    // --- Event Listeners ---

    context.subscriptions.push(
        vscode.window.onDidOpenTerminal(() => {
            pushTerminalList(socket);
        })
    );

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal(() => {
            // Small delay to ensure it's gone from the array
            setTimeout(() => pushTerminalList(socket), 200);
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTerminal(() => {
            pushTerminalList(socket);
        })
    );

    // Register a manual connect command just in case
    let disposable = vscode.commands.registerCommand('remote-control.connect', function () {
        socket.connect();
        vscode.window.showInformationMessage('Reconnecting to Remote Control Server...');
    });

    context.subscriptions.push(disposable);
}

function pushTerminalList(socket) {
    if (!socket.connected) return;

    // Filter out terminals with exitStatus set (closed/done)
    const terminals = vscode.window.terminals
        .filter(t => !t.exitStatus)
        .map((t, i) => ({
            id: `vscode-${i}-${t.name.replace(/\s+/g, '')}`, // Generate a somewhat unique ID
            name: t.name,
            isActive: vscode.window.activeTerminal === t,
            options: t.creationOptions // Expose creation options for filtering
        }));

    socket.emit('agent:update', {
        type: 'terminals',
        data: terminals
    });
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
