import React, { useEffect, useState } from 'react';
import { socket } from '../services/socket';
import StreamCanvas from './StreamCanvas';
import './AppsPanel.css'; // We'll create this or append to App.css

const AppsPanel = () => {
    const [view, setView] = useState('list'); // 'list' | 'stream'
    const [windows, setWindows] = useState([]);
    const [selectedWindow, setSelectedWindow] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        // Initial fetch
        fetchWindows();

        const onList = (data) => {
            setWindows(data);
            setRefreshing(false);
        };

        socket.on('apps:list', onList);

        // cleanup
        return () => {
            socket.off('apps:list', onList);
            // If unmounting, ideally reset mode? Handled by App.jsx tab switch usually.
        };
    }, []);

    const fetchWindows = () => {
        setRefreshing(true);
        socket.emit('apps:list');
    };

    const handleGlobalStream = () => {
        setSelectedWindow({ title: 'Global Desktop', type: 'global' });
        socket.emit('apps:setSource', { type: 'global' });
        socket.emit('view:setMode', 'apps');
        setView('stream');
    };

    const handleWindowClick = (win) => {
        setSelectedWindow({ ...win, type: 'window' });

        // 1. Activate plain window
        // 1. Activate plain window
        socket.emit('apps:activate', { title: win.title, handle: win.handle });

        // 2. Set source
        // 2. Set source
        // We can pass handle here too for better tracking if we update backend stream logic
        socket.emit('apps:setSource', { type: 'window', target: win.title, handle: win.handle });

        // 3. Enable stream mode
        socket.emit('view:setMode', 'apps');

        setView('stream');
    };

    const handleBack = () => {
        setView('list');
        socket.emit('view:setMode', 'idle'); // Stop streaming
        fetchWindows(); // Refresh list on return
    };

    if (view === 'stream') {
        return (
            <div className="apps-stream-wrapper">
                <div className="apps-toolbar">
                    <button className="back-btn" onClick={handleBack}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                        Back
                    </button>
                    <span className="window-title-bar">
                        {selectedWindow?.title || 'Stream'}
                    </span>
                </div>
                <div className="apps-stream-content">
                    {/* Reuse StreamCanvas - we can pass generic viewMode 'apps' or just let it inherit defaults */}
                    {/* Reuse StreamCanvas - we can pass generic viewMode 'apps' or just let it inherit defaults */}
                    <StreamCanvas viewMode="apps" />

                    {/* Bring to Front FAB */}
                    {selectedWindow && selectedWindow.type === 'window' && (
                        <button
                            className="fab-crop"
                            style={{
                                position: 'absolute',
                                bottom: '80px',
                                right: '16px',
                                zIndex: 300 // Higher than StreamCanvas FAB
                            }}
                            onClick={() => socket.emit('apps:activate', { title: selectedWindow.title, handle: selectedWindow.handle })}
                            title="Bring to Front"
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="apps-panel">
            <div className="apps-header">
                <h2>Apps</h2>
                <button className="refresh-btn" onClick={fetchWindows} disabled={refreshing}>
                    {refreshing ? '...' : '↻'}
                </button>
            </div>

            <div className="apps-grid">
                {/* Global Option */}
                <div className="app-card global-card" onClick={handleGlobalStream}>
                    <div className="app-icon global-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10z" /></svg>
                    </div>
                    <div className="app-info">
                        <span className="app-name">Global Screen</span>
                        <span className="app-desc">Stream entire desktop</span>
                    </div>
                </div>

                {/* Windows List */}
                {windows.map((win, idx) => (
                    <div key={`${win.handle}-${idx}`} className="app-card" onClick={() => handleWindowClick(win)}>
                        <div className="app-icon">
                            {/* Generic Window Icon */}
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
                        </div>
                        <div className="app-info">
                            <span className="app-name" title={win.title}>{win.title}</span>
                            <span className="app-desc">ID: {win.handle}</span>
                        </div>
                    </div>
                ))}
            </div>

            {windows.length === 0 && !refreshing && (
                <div className="empty-state">No windows found</div>
            )}
        </div>
    );
};

export default AppsPanel;
