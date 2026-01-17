const os = require('os');
const pty = require('node-pty');

const cp = require('child_process');

class TerminalManager {
    constructor() {
        this.terminals = {};
    }

    createTerminal(socket) {
        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

        // Create the pty process
        const ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 24,
            cwd: process.cwd(), // Default to current server directory (project root)
            env: process.env
        });

        const termId = ptyProcess.pid.toString();

        this.terminals[termId] = {
            process: ptyProcess,
            history: '' // Buffer to store recent output for reconnection (optional, kept simple for now)
        };

        // Data handler
        ptyProcess.onData((data) => {
            // Send data to the specific socket that requested it? 
            // OR broadcast to all if we want shared sessions? 
            // For now, let's assume one-to-one or shared. 
            // Typically in this app, there's one main user. Broadcasting is fine or using the specific socket.
            // But if we want persistent terminals that survive page refreshes, we need to handle that.
            // For now, we'll emit to the socket.

            // We should really emit to the room or global namespace if we want persistence across reloads.
            // Let's assume the socket passed in is the one that created it, but we might want to attach others.
            // For simplicity: emit to the socket that created it, but also allow re-attaching.

            socket.emit('term:data', { id: termId, data });
        });

        ptyProcess.onExit(() => {
            delete this.terminals[termId];
            socket.emit('term:exit', { id: termId });
        });

        return termId;
    }

    resize(id, cols, rows) {
        const term = this.terminals[id];
        if (term) {
            term.process.resize(cols, rows);
        }
    }

    write(id, data) {
        const term = this.terminals[id];
        if (term) {
            term.process.write(data);
        }
    }

    kill(id) {
        const term = this.terminals[id];
        if (term) {
            console.log(`[DEBUG] Killing terminal ${id} (PID: ${term.process.pid})`);
            // Force kill the process tree on Windows
            if (process.platform === 'win32') {
                try {
                    // /F = Force, /T = Tree (child processes)
                    const cmd = `taskkill /pid ${term.process.pid} /T /F`;
                    console.log(`[DEBUG] Executing: ${cmd}`);
                    cp.exec(cmd, (err, stdout, stderr) => {
                        if (err) console.error(`[ERROR] Taskkill failed:`, err);
                        if (stdout) console.log(`[INFO] Taskkill stdout:`, stdout);
                        if (stderr) console.error(`[WARN] Taskkill stderr:`, stderr);
                    });
                } catch (e) {
                    console.error("Error running taskkill:", e);
                }
            }
            // Standard kill as backup / cleanup
            term.process.kill();
            delete this.terminals[id];
            console.log(`[INFO] Terminal ${id} removed from manager.`);
        } else {
            console.log(`[WARN] Attempted to kill non-existent terminal ${id}`);
        }
    }

    listTerminals() {
        return Object.keys(this.terminals).map(id => ({
            id,
            name: this.terminals[id].process.process
        }));
    }
}

module.exports = new TerminalManager();
