# TestRemoteControl - Standalone Startup Script
# This script starts both the client and server components

Write-Host "=== TestRemoteControl Standalone Launcher ==="

# Check if Node.js is installed
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Node.js detected: $nodeVersion"
} else {
    Write-Host "ERROR: Node.js is not installed. Please install Node.js from https://nodejs.org/"
    exit 1
}

# Check if npm is available
$npmVersion = npm --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "npm detected: $npmVersion"
} else {
    Write-Host "ERROR: npm is not available"
    exit 1
}

Write-Host ""

# Function to install dependencies
function Install-Dependencies {
    param([string]$path, [string]$name)

    Write-Host "Checking dependencies for $name..."

    if (!(Test-Path "$path/node_modules")) {
        Write-Host "Installing dependencies for $name..."
        Push-Location $path
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Failed to install dependencies for $name"
            exit 1
        }
        Write-Host "Dependencies installed for $name"
        Pop-Location
    } else {
        Write-Host "Dependencies already installed for $name"
    }
}



# Install client dependencies
Install-Dependencies -path "client" -name "client"

# Install server dependencies
Install-Dependencies -path "server" -name "server"

Write-Host ""

# Get local IP addresses
Write-Host "Detecting network interfaces..."
$ipAddresses = @()


try {
    $networkInterfaces = Get-NetIPAddress | Where-Object {
        $_.AddressFamily -eq "IPv4" -and $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*"
    }
    foreach ($interface in $networkInterfaces) {
        $ipAddresses += $interface.IPAddress
    }
    $ipAddresses = $ipAddresses | Select-Object -Unique
} catch {
    Write-Host "Warning: Could not detect network interfaces automatically"
    $ipAddresses = @("localhost")
}

Write-Host ""

# Start server in background
Write-Host "Starting server..."
$serverJob = Start-Job -ScriptBlock {
    Set-Location "$using:PWD\server"
    node index.js
} -Name "TestRemoteControl-Server"

Start-Sleep -Seconds 2

# Check if server started successfully
if ($serverJob.State -eq "Running") {
    Write-Host "Server started successfully"
} else {
    Write-Host "ERROR: Server failed to start"
    Receive-Job -Job $serverJob
    exit 1
}

# Start client in background
Write-Host "Starting client..."
$clientJob = Start-Job -ScriptBlock {
    Set-Location "$using:PWD\client"
    npm run dev
} -Name "TestRemoteControl-Client"

Start-Sleep -Seconds 3

# Check if client started successfully
if ($clientJob.State -eq "Running") {
    Write-Host "Client started successfully"
} else {
    Write-Host "ERROR: Client failed to start"
    if ($clientJob) {
        Receive-Job -Job $clientJob
    }
    exit 1
}

Write-Host ""
Write-Host "=== TestRemoteControl is now running! ==="
Write-Host ""

# Display URLs
Write-Host "Server (WebSocket/HTTP API):"
foreach ($ip in $ipAddresses) {
    Write-Host "  http://$($ip):3001"
}
Write-Host "  http://localhost:3001"

Write-Host ""
Write-Host "Client (Web Interface):"
foreach ($ip in $ipAddresses) {
    Write-Host "  http://$($ip):5173"
}
Write-Host "  http://localhost:5173"

Write-Host ""
# Handle Ctrl+C gracefully
trap {
    Write-Host ""
    Write-Host "Stopping services..."
    Get-Job | Stop-Job
    Get-Job | Remove-Job
    exit 0
}

# Keep the script running to show logs
Write-Host "=== Service Logs ==="
Write-Host "Press Ctrl+C to stop all services"
Write-Host ""

# Simple monitoring
while ($true) {
    Start-Sleep -Seconds 10
    Write-Host "Services are running... (Press Ctrl+C to stop)"
}