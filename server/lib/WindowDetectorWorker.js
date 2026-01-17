/**
 * WindowDetectorWorker - Persistent PowerShell process for window detection
 * Reduces CPU overhead by reusing a single PowerShell process instead of spawning new ones.
 * Includes result caching to minimize redundant queries.
 */
const { spawn } = require('child_process');

class WindowDetectorWorker {
    constructor() {
        this.proc = null;
        this.isReady = false;
        this.pendingCallbacks = new Map();
        this.callId = 0;
        this.cache = new Map();
        this.cacheTTL = 2000; // 2 second cache
        this.init();
    }

    init() {
        this.proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true
        });

        this.proc.stdin.setDefaultEncoding('utf-8');

        // Buffer for accumulating output
        this.outputBuffer = '';

        this.proc.stdout.on('data', (data) => {
            this.outputBuffer += data.toString();
            this.processOutput();
        });

        // Initialize with required .NET types
        const initScript = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = "SilentlyContinue"

function Find-Window {
    param([string]$Pattern)
    $Root = [System.Windows.Automation.AutomationElement]::RootElement
    $Condition = [System.Windows.Automation.Automation]::ControlViewCondition
    $AllTopWindows = $Root.FindAll([System.Windows.Automation.TreeScope]::Children, $Condition)
    
    foreach ($Win in $AllTopWindows) {
        if ($Win.Current.Name -match $Pattern) {
            $Rect = $Win.Current.BoundingRectangle
            if ($Rect.Width -gt 0 -and $Rect.Height -gt 0) {
                return "$($Rect.X),$($Rect.Y),$($Rect.Width),$($Rect.Height)"
            }
        }
    }
    return "NOT_FOUND"
}

function Find-WindowByHandle {
    param([long]$Handle)
    try {
        $hWnd = [IntPtr]$Handle
        $el = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
        if ($el) {
            $Rect = $el.Current.BoundingRectangle
            if ($Rect.Width -gt 0 -and $Rect.Height -gt 0) {
                return "$($Rect.X),$($Rect.Y),$($Rect.Width),$($Rect.Height)"
            }
        }
    } catch {}
    return "NOT_FOUND"
}

Write-Output "WORKER_READY"
`;
        this.proc.stdin.write(initScript + '\n');

        this.proc.on('exit', (code) => {
            console.log('WindowDetectorWorker exited with code:', code);
            this.isReady = false;
            // Auto-restart after delay
            setTimeout(() => this.init(), 2000);
        });

        this.proc.on('error', (err) => {
            console.error('WindowDetectorWorker error:', err);
        });
    }

    processOutput() {
        const lines = this.outputBuffer.split('\n');
        // Keep the last incomplete line in buffer
        this.outputBuffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed === 'WORKER_READY') {
                this.isReady = true;
                console.log('WindowDetectorWorker ready');
                continue;
            }

            // Parse response format: CALLID:RESULT
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx > 0) {
                const callId = trimmed.substring(0, colonIdx);
                const result = trimmed.substring(colonIdx + 1);

                if (this.pendingCallbacks.has(callId)) {
                    const callback = this.pendingCallbacks.get(callId);
                    this.pendingCallbacks.delete(callId);
                    callback(result);
                }
            }
        }
    }

    /**
     * Find window bounds by title pattern
     * @param {string} titlePattern - Regex pattern to match window title
     * @returns {Promise<{x: number, y: number, width: number, height: number} | null>}
     */
    findWindowBounds(titlePattern) {
        // Validate titlePattern
        if (!titlePattern || typeof titlePattern !== 'string') {
            return Promise.resolve(null);
        }

        // Check cache first
        const cacheKey = `title:${titlePattern}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.time < this.cacheTTL) {
            return Promise.resolve(cached.value);
        }

        return new Promise((resolve) => {
            if (!this.isReady || !this.proc || this.proc.killed) {
                resolve(null);
                return;
            }

            const id = String(++this.callId);
            this.pendingCallbacks.set(id, (result) => {
                const bounds = this.parseResult(result);
                this.cache.set(cacheKey, { value: bounds, time: Date.now() });
                resolve(bounds);
            });

            // Escape double quotes in pattern
            const escapedPattern = titlePattern.replace(/"/g, '`"');
            this.proc.stdin.write(`Write-Output "${id}:$(Find-Window -Pattern '${escapedPattern}')"\\n`);

            // Timeout fallback
            setTimeout(() => {
                if (this.pendingCallbacks.has(id)) {
                    this.pendingCallbacks.delete(id);
                    resolve(null);
                }
            }, 3000);
        });
    }

    /**
     * Find window bounds by handle
     * @param {number|string} handle - Native window handle
     * @returns {Promise<{x: number, y: number, width: number, height: number} | null>}
     */
    findWindowBoundsByHandle(handle) {
        const cacheKey = `handle:${handle}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.time < this.cacheTTL) {
            return Promise.resolve(cached.value);
        }

        return new Promise((resolve) => {
            if (!this.isReady || !this.proc || this.proc.killed) {
                resolve(null);
                return;
            }

            const id = String(++this.callId);
            this.pendingCallbacks.set(id, (result) => {
                const bounds = this.parseResult(result);
                this.cache.set(cacheKey, { value: bounds, time: Date.now() });
                resolve(bounds);
            });

            this.proc.stdin.write(`Write-Output "${id}:$(Find-WindowByHandle -Handle ${handle})"\n`);

            setTimeout(() => {
                if (this.pendingCallbacks.has(id)) {
                    this.pendingCallbacks.delete(id);
                    resolve(null);
                }
            }, 3000);
        });
    }

    parseResult(result) {
        if (!result || result === 'NOT_FOUND') return null;
        const parts = result.split(',');
        if (parts.length === 4) {
            return {
                x: parseInt(parts[0]),
                y: parseInt(parts[1]),
                width: parseInt(parts[2]),
                height: parseInt(parts[3])
            };
        }
        return null;
    }

    clearCache() {
        this.cache.clear();
    }

    destroy() {
        if (this.proc && !this.proc.killed) {
            this.proc.stdin.write('exit\n');
            this.proc.kill();
        }
    }
}

// Export singleton
module.exports = new WindowDetectorWorker();
