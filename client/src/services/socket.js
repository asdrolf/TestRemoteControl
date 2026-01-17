import { io } from 'socket.io-client';

// Connect to the server. 
// Check localStorage for custom URL first, fallback to auto-detection
const getServerUrl = () => {
    // Priority 1: Query param 'server'
    const params = new URLSearchParams(window.location.search);
    const queryServer = params.get('server');
    if (queryServer) {
         return queryServer.startsWith('http') ? queryServer : `http://${queryServer}`;
    }

    // Priority 2: LocalStorage
    const savedUrl = localStorage.getItem('serverUrl');
    if (savedUrl) {
        // Ensure it has http:// prefix
        return savedUrl.startsWith('http') ? savedUrl : `http://${savedUrl}`;
    }
    // Default: same host, port 3001
    return `http://${window.location.hostname}:3001`;
};

const URL = getServerUrl();
console.log('Connecting to server:', URL);

export const socket = io(URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
});

// Export URL for display purposes
export const getConnectedUrl = () => URL;
