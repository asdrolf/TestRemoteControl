const { spawn } = require('child_process');

/**
 * Finds a window matching the given title pattern and returns its bounds.
 * Uses PowerShell to interact with Windows API.
 * 
 * @param {string} titlePattern Regex string to match window title (e.g. "Cursor|Antigravity")
 * @returns {Promise<{x: number, y: number, width: number, height: number} | null>}
 */
function findWindowBounds(titlePattern) {
    return new Promise((resolve, reject) => {
        const script = `
Add-Type -AssemblyName UIAutomationClient
$Root = [System.Windows.Automation.AutomationElement]::RootElement
$Condition = [System.Windows.Automation.Automation]::ControlViewCondition
$AllTopWindows = $Root.FindAll([System.Windows.Automation.TreeScope]::Children, $Condition)

foreach ($Win in $AllTopWindows) {
    if ($Win.Current.Name -match "${titlePattern}") {
        $Rect = $Win.Current.BoundingRectangle
        if ($Rect.Width -gt 0 -and $Rect.Height -gt 0) {
            Write-Output "$($Rect.X),$($Rect.Y),$($Rect.Width),$($Rect.Height)"
            exit 0
        }
    }
}
exit 1
        `;

        const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);

        let output = '';
        let error = '';

        ps.stdout.on('data', (data) => {
            output += data.toString();
        });

        ps.stderr.on('data', (data) => {
            error += data.toString();
        });

        ps.on('close', (code) => {
            if (code === 0 && output.trim()) {
                const parts = output.trim().split(',');
                if (parts.length === 4) {
                    resolve({
                        x: parseInt(parts[0]),
                        y: parseInt(parts[1]),
                        width: parseInt(parts[2]),
                        height: parseInt(parts[3])
                    });
                    return;
                }
            }
            resolve(null); // Not found or error
        });

        ps.on('error', (err) => {
            console.error("Failed to spawn PowerShell:", err);
            resolve(null);
        });
    });
}

/**
 * Gets the current UI focus details.
 * @returns {Promise<Object>}
 */
function getActiveFocus() {
    return new Promise((resolve) => {
        const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = "SilentlyContinue"
try {
    $focus = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($focus) {
        $rect = $focus.Current.BoundingRectangle
        $result = @{
            found = $true
            x = $rect.X
            y = $rect.Y
            width = $rect.Width
            height = $rect.Height
            name = $focus.Current.Name
        }
        Write-Output ($result | ConvertTo-Json -Compress)
    } else {
        Write-Output '{"found": false}'
    }
} catch {
    Write-Output '{"found": false}'
}
        `;

        const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
        let output = '';
        ps.stdout.on('data', (data) => output += data.toString());
        ps.on('close', () => {
            try {
                resolve(JSON.parse(output.trim()));
            } catch (e) {
                resolve({ found: false });
            }
        });
    });
}


/**
 * Ensures the window matching the pattern is active (foreground) and maximized.
 * Intelligent check: Only maximizes if not already maximized to avoid flickering.
 * Uses robust techniques (AttachThreadInput + keybd_event).
 * @param {string} titlePattern Regex to match window title
 * @returns {Promise<string>} "ALREADY_ACTIVE", "ACTIVATED", "FAILED", "NOT_FOUND", or "ERROR"
 */
function ensureWindowActive(titlePattern) {
    return new Promise((resolve) => {
        const script = `
Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
        [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    }
"@

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$Root = [System.Windows.Automation.AutomationElement]::RootElement
$Condition = [System.Windows.Automation.Automation]::ControlViewCondition
$AllTopWindows = $Root.FindAll([System.Windows.Automation.TreeScope]::Children, $Condition)

foreach ($Win in $AllTopWindows) {
    if ($Win.Current.Name -match "${titlePattern}") {
        $hWnd = [IntPtr]$Win.Current.NativeWindowHandle
        $foregroundHWnd = [Win32]::GetForegroundWindow()

        # Check Visual State
        $isMaximized = $false
        $isMinimized = $false
        
        try {
            $pattern = $Win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
            $state = $pattern.Current.WindowVisualState
            $isMaximized = ($state -eq [System.Windows.Automation.WindowVisualState]::Maximized)
            $isMinimized = ($state -eq [System.Windows.Automation.WindowVisualState]::Minimized)
        } catch {
            # Fallback if pattern fails (rare)
        }

        if (($hWnd -eq $foregroundHWnd) -and $isMaximized) {
            Write-Output "ALREADY_ACTIVE"
        } else {
            # Robust activation sequence
            $foregroundThreadId = [Win32]::GetWindowThreadProcessId($foregroundHWnd, [IntPtr]::Zero)
            $thisThreadId = [Win32]::GetCurrentThreadId()
            
            if ($foregroundThreadId -ne $thisThreadId) {
                [void][Win32]::AttachThreadInput($thisThreadId, $foregroundThreadId, $true)
            }
            
            # Alt Hack
            [Win32]::keybd_event(0, 0, 0, 0)

            # 1. If Minimized, Restore first
            if ($isMinimized) {
                [void][Win32]::ShowWindow($hWnd, 9) # SW_RESTORE
            }
            
            # 2. Bring to front
            [void][Win32]::SetForegroundWindow($hWnd)
            [void][Win32]::SwitchToThisWindow($hWnd, $true)
            
            # 3. Maximize ONLY if not already maximized
            if (-not $isMaximized) {
                [void][Win32]::ShowWindow($hWnd, 3) # SW_MAXIMIZE
            }

            if ($foregroundThreadId -ne $thisThreadId) {
                [void][Win32]::AttachThreadInput($thisThreadId, $foregroundThreadId, $false)
            }
            
            # Verify
            Start-Sleep -Milliseconds 50
            $finalForeground = [Win32]::GetForegroundWindow()
            if ($finalForeground -eq $hWnd) {
                 Write-Output "ACTIVATED"
            } else {
                 Write-Output "FAILED"
            }
        }
        exit 0
    }
}
Write-Output "NOT_FOUND"
exit 0
        `;

        const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);

        let output = '';

        ps.stdout.on('data', (data) => output += data.toString());
        ps.on('close', () => resolve(output.trim()));
        ps.on('error', (err) => {
            console.error("Powershell error ensureWindowActive:", err);
            resolve("ERROR");
        });
    });
}

/**
 * Gets a list of all visible top-level windows.
 * Returns valid JSON array of { title, process, handle }
 * @returns {Promise<Array<{title: string, process: string, handle: number}>>}
 */
function getOpenWindows() {
    return new Promise((resolve) => {
        const script = `
Add-Type -AssemblyName UIAutomationClient
$Root = [System.Windows.Automation.AutomationElement]::RootElement
$Condition = [System.Windows.Automation.Automation]::ControlViewCondition
$AllTopWindows = $Root.FindAll([System.Windows.Automation.TreeScope]::Children, $Condition)

$results = @()

foreach ($Win in $AllTopWindows) {
    if ($Win.Current.Name -and $Win.Current.BoundingRectangle.Width -gt 0) {
        $results += @{
            title = $Win.Current.Name
            handle = $Win.Current.NativeWindowHandle
            process = $Win.Current.ProcessId # Placeholder, requires more expensive call to get name
        }
    }
}

Write-Output ($results | ConvertTo-Json -Compress)
        `;

        const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
        let output = '';

        ps.stdout.on('data', (data) => output += data.toString());

        ps.on('close', () => {
            try {
                const result = JSON.parse(output.trim() || '[]');
                // Ensure it's always an array
                const list = Array.isArray(result) ? result : [result];
                // Filter out empty titles or likely garbage
                resolve(list.filter(w => w.title && w.title.trim().length > 0));
            } catch (e) {
                console.error("Error parsing window list:", e);
                resolve([]);
            }
        });

        ps.on('error', (err) => {
            console.error("PowerShell spawn error:", err);
            resolve([]);
        });
    });
}

/**
 * Ensures the window with specific handle is active (foreground).
 * @param {number|string} handle Native Window Handle
 * @returns {Promise<string>}
 */
function ensureWindowActiveByHandle(handle) {
    return new Promise((resolve) => {
        const script = `
Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
        [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    }
"@

$hWnd = [IntPtr]${handle}
$foregroundHWnd = [Win32]::GetForegroundWindow()

if ($hWnd -eq $foregroundHWnd) {
    Write-Output "ALREADY_ACTIVE"
} else {
    $foregroundThreadId = [Win32]::GetWindowThreadProcessId($foregroundHWnd, [IntPtr]::Zero)
    $thisThreadId = [Win32]::GetCurrentThreadId()
    
    if ($foregroundThreadId -ne $thisThreadId) {
        [void][Win32]::AttachThreadInput($thisThreadId, $foregroundThreadId, $true)
    }
    
    # Alt Hack
    [Win32]::keybd_event(0, 0, 0, 0)

    # Restore if minimized
    if ([Win32]::IsIconic($hWnd)) {
         [void][Win32]::ShowWindow($hWnd, 9) # SW_RESTORE
    }
    
    # Bring to front
    [void][Win32]::SetForegroundWindow($hWnd)
    [void][Win32]::SwitchToThisWindow($hWnd, $true)
    
    # Detach
    if ($foregroundThreadId -ne $thisThreadId) {
        [void][Win32]::AttachThreadInput($thisThreadId, $foregroundThreadId, $false)
    }
    
    Start-Sleep -Milliseconds 50
    $final = [Win32]::GetForegroundWindow()
    if ($final -eq $hWnd) { Write-Output "ACTIVATED" } else { Write-Output "FAILED" }
}
exit 0
        `;

        const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
        let output = '';
        ps.stdout.on('data', (data) => output += data.toString());
        ps.on('close', () => resolve(output.trim()));
        ps.on('error', (err) => resolve("ERROR"));
    });
}

/**
 * Finds window bounds by handle.
 * @param {number|string} handle
 * @returns {Promise<{x: number, y: number, width: number, height: number} | null>}
 */
function findWindowBoundsByHandle(handle) {
    return new Promise((resolve) => {
        const script = `
Add-Type -AssemblyName UIAutomationClient
try {
    $hWnd = [IntPtr]${handle}
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
    if ($el) {
        $Rect = $el.Current.BoundingRectangle
        if ($Rect.Width -gt 0 -and $Rect.Height -gt 0) {
            Write-Output "$($Rect.X),$($Rect.Y),$($Rect.Width),$($Rect.Height)"
            exit 0
        }
    }
} catch {
    # Handle invalid handle or closed window
}
exit 1
        `;

        const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
        let output = '';
        ps.stdout.on('data', (data) => output += data.toString());
        ps.on('close', (code) => {
            if (code === 0 && output.trim()) {
                const parts = output.trim().split(',');
                if (parts.length === 4) {
                    resolve({
                        x: parseInt(parts[0]),
                        y: parseInt(parts[1]),
                        width: parseInt(parts[2]),
                        height: parseInt(parts[3])
                    });
                    return;
                }
            }
            resolve(null);
        });
        ps.on('error', () => resolve(null));
    });
}

module.exports = { findWindowBounds, getActiveFocus, ensureWindowActive, getOpenWindows, ensureWindowActiveByHandle, findWindowBoundsByHandle };
