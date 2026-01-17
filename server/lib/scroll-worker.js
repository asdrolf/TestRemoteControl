const { spawn } = require('child_process');

class ScrollWorker {
    constructor() {
        this.proc = null;
        this.init();
    }

    init() {
        // Start persistent powershell process attached to stdin
        // -Command - allows reading code from stdin
        this.proc = spawn('powershell', ['-Command', '-'], {
            stdio: ['pipe', 'ignore', 'ignore'], // Optimization: ignore output
            windowsHide: true
        });

        this.proc.stdin.setDefaultEncoding('utf-8');

        // Define C# types once at startup
        const initScript = `
$code = @"
    using System;
    using System.Runtime.InteropServices;
    public class Mouse {
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, int dwExtraInfo);
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public static void Scroll(int amount) {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, amount, 0);
        }
    }
"@
Add-Type -TypeDefinition $code
`;
        this.proc.stdin.write(initScript + '\n');

        this.proc.on('exit', () => {
            // console.log('Scroll worker exited. Restarting...'); // Clean logs
            setTimeout(() => this.init(), 1000); // Auto-restart with delay
        });

        this.proc.on('error', (err) => {
            console.error('Scroll worker error:', err);
        });
    }

    scroll(amount) {
        if (!this.proc || this.proc.killed || this.proc.stdin.destroyed) return;

        try {
            // Send command to persistent process
            // Windows API: 120 = 1 tick UP
            // RobotJS/Client: Positive = UP? Depending on implementation.
            // We pass the raw amount (which is ticks * 120 from index.js)
            this.proc.stdin.write(`[Mouse]::Scroll(${Math.round(amount)})\n`);
        } catch (e) {
            console.error('Failed to send scroll command:', e);
        }
    }
}

module.exports = new ScrollWorker();
