import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { socket } from '../services/socket';
import StreamCanvas from './StreamCanvas';

// --- Sub-component: XTerm View for System Terminals ---
const SystemTerminalView = ({ id, isActive }) => {
    const containerRef = useRef(null);
    const terminalRef = useRef(null);
    const fitAddonRef = useRef(null);

    useEffect(() => {
        const term = new Terminal({
            theme: { background: '#1e1e1e', foreground: '#ffffff', cursor: '#ffffff' },
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace'
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        if (containerRef.current) {
            term.open(containerRef.current);
            fitAddon.fit();
            setTimeout(() => {
                fitAddon.fit();
                socket.emit('term:resize', { id, cols: term.cols, rows: term.rows });
            }, 100);
        }

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;

        term.onData((data) => socket.emit('term:input', { id, data }));

        const handleData = (data) => {
            if (data.id === id) term.write(data.data);
        };
        socket.on('term:data', handleData);

        const resizeObserver = new ResizeObserver(() => {
            if (isActive && fitAddonRef.current) {
                try {
                    fitAddonRef.current.fit();
                    socket.emit('term:resize', { id, cols: term.cols, rows: term.rows });
                } catch (e) { }
            }
        });
        if (containerRef.current) resizeObserver.observe(containerRef.current);

        return () => {
            // Check if terminalRef.current exists before disposing to avoid errors
            if (terminalRef.current) term.dispose();
            socket.off('term:data', handleData);
            resizeObserver.disconnect();
        };
    }, [id]);

    useEffect(() => {
        if (isActive && fitAddonRef.current) {
            setTimeout(() => {
                try {
                    fitAddonRef.current.fit();
                    terminalRef.current.focus();
                } catch (e) { }
            }, 50);
        }
    }, [isActive]);

    return <div ref={containerRef} style={{ display: isActive ? 'block' : 'none', width: '100%', height: '100%' }} />;
};

// --- Sub-component: Control View for VSCode Terminals ---
const VSCodeTerminalControl = ({ id, name, isActive }) => {
    const [input, setInput] = useState('');
    const [history, setHistory] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('term_cmd_history') || '[]');
        } catch (e) {
            return [];
        }
    });

    const handleSend = (e) => {
        e.preventDefault();
        if (!input.trim()) return;

        socket.emit('client:vscode:action', {
            type: 'type',
            payload: { id, text: input + '\r' }
        });

        // Update history: Add new at top, remove duplicates, keep max 50
        const newHistory = [input, ...history.filter(h => h !== input)].slice(0, 50);
        setHistory(newHistory);
        localStorage.setItem('term_cmd_history', JSON.stringify(newHistory));

        setInput('');
    };

    const sendKey = (code) => {
        socket.emit('client:vscode:action', {
            type: 'type',
            payload: { id, text: code }
        });
    };

    const handleCtrlC = () => sendKey('\x03'); // ASCII for Ctrl+C
    const handleUpArrow = () => sendKey('\x1b[A');
    const handleDownArrow = () => sendKey('\x1b[B');

    useEffect(() => {
        if (isActive) {
            socket.emit('client:vscode:action', {
                type: 'focus',
                payload: id
            });
        }
    }, [isActive, id]);

    // IMPORTANT: Return null if not active to avoid stacking in DOM
    if (!isActive) return null;

    return (
        <div style={{ padding: '16px', color: '#fff', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1.2em' }}>VSCode: {name}</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={handleUpArrow}
                        style={{
                            background: '#333', color: '#fff', border: '1px solid #555',
                            padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                        }}
                        title="Up Arrow"
                    >
                        ↑
                    </button>
                    <button
                        onClick={handleDownArrow}
                        style={{
                            background: '#333', color: '#fff', border: '1px solid #555',
                            padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                        }}
                        title="Down Arrow"
                    >
                        ↓
                    </button>
                    <button
                        onClick={handleCtrlC}
                        style={{
                            background: '#d9534f', color: 'white', border: 'none',
                            padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                        }}
                        title="Send Ctrl+C"
                    >
                        ^C
                    </button>
                    <button
                        onClick={() => socket.emit('client:vscode:action', { type: 'kill', payload: id })}
                        style={{
                            background: '#444', color: '#ccc', border: 'none',
                            padding: '6px 12px', borderRadius: '4px', cursor: 'pointer'
                        }}
                        title="Close Terminal"
                    >
                        Close
                    </button>
                </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
                <StreamCanvas viewMode="terminal" />
            </div>

            <form onSubmit={handleSend} style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Type command..."
                        list="term-history-list"
                        style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '6px',
                            border: '1px solid #444',
                            background: '#222',
                            color: 'white',
                            fontSize: '16px',
                            fontFamily: 'monospace',
                            outline: 'none'
                        }}
                        autoCapitalize="none"
                        autoComplete="off"
                    />
                    <datalist id="term-history-list">
                        {history.map((cmd, index) => (
                            <option key={index} value={cmd} />
                        ))}
                    </datalist>
                </div>
                <button type="submit" className="primary-btn" style={{ width: 'auto', minWidth: '80px' }}>Send</button>
            </form>
        </div>
    );
};


const ConsolePanel = () => {
    const [sysTerminals, setSysTerminals] = useState([]);
    const [vscodeTerminals, setVscodeTerminals] = useState([]);
    const [activeTab, setActiveTab] = useState(null); // { type: 'sys'|'vscode', id: string }

    // Group State: 'sys' | 'vscode'
    const [activeGroup, setActiveGroup] = useState('sys');

    const [showAll, setShowAll] = useState(false);
    const [hiddenTerminals, setHiddenTerminals] = useState(new Set());

    // Refresh function to be called on mount and via button
    const refreshTerminals = () => {
        socket.emit('term:list');
        socket.emit('client:vscode:action', { type: 'refresh' });
    };

    const toggleHide = (e, id) => {
        e.stopPropagation();
        const newHidden = new Set(hiddenTerminals);
        if (newHidden.has(id)) {
            newHidden.delete(id);
        } else {
            newHidden.add(id);
        }
        setHiddenTerminals(newHidden);
    };

    useEffect(() => {
        refreshTerminals();
    }, []);

    // Sync activeGroup with activeTab
    useEffect(() => {
        if (activeTab) {
            setActiveGroup(activeTab.type);
        }
    }, [activeTab]);

    useEffect(() => {
        const onSysList = (list) => {
            setSysTerminals(list);
            if (!activeTab && list.length > 0) setActiveTab({ type: 'sys', id: list[0].id });
        };

        const onVscodeList = (list) => {
            const newList = list || [];
            if (JSON.stringify(newList) !== JSON.stringify(vscodeTerminals)) {
                setVscodeTerminals(newList);
            }

            // Auto-select if nothing selected and no sys terminals
            if (!activeTab && newList.length > 0 && sysTerminals.length === 0) {
                setActiveTab({ type: 'vscode', id: newList[0].id });
            }
        };

        const onSysCreated = ({ id }) => {
            socket.emit('term:list');
            setActiveTab({ type: 'sys', id });
            setActiveGroup('sys'); // Ensure we switch to sys view
        };

        socket.on('term:list', onSysList);
        socket.on('term:created', onSysCreated);
        socket.on('vscode:terminals', onVscodeList);

        return () => {
            socket.off('term:list', onSysList);
            socket.off('term:created', onSysCreated);
            socket.off('vscode:terminals', onVscodeList);
        };
    }, [activeTab, sysTerminals.length, vscodeTerminals]);

    const switchTab = (type, id) => setActiveTab({ type, id });

    // Filter displayed VSCode terminals
    const displayedVscodeTerminals = vscodeTerminals.filter(t => {
        if (showAll) return true;
        // Hide if in hidden list
        if (hiddenTerminals.has(t.id)) return false;
        return true;
    });

    // Styles
    const groupBarStyle = {
        display: 'flex',
        background: '#181818',
        borderBottom: '1px solid #333',
        padding: '0 8px'
    };

    const groupTabStyle = (key) => {
        const isActive = activeGroup === key;
        const color = key === 'sys' ? '#4CAF50' : '#007acc';
        return {
            flex: 1,
            textAlign: 'center',
            padding: '10px',
            cursor: 'pointer',
            color: isActive ? color : '#666',
            fontWeight: isActive ? 'bold' : 'normal',
            borderBottom: isActive ? `2px solid ${color}` : '2px solid transparent',
            transition: 'all 0.2s'
        };
    };

    const tabBarStyle = {
        display: 'flex',
        overflowX: 'auto',
        background: '#1e1e1e', // Slightly lighter than group bar
        borderBottom: '1px solid #333',
        padding: '8px 8px 0 8px',
        gap: '4px',
        alignItems: 'center',
        scrollbarWidth: 'thin' // Firefox
    };

    const tabStyle = (isActive, type) => ({
        padding: '8px 12px',
        background: isActive ? '#252526' : '#2d2d2d',
        color: isActive ? '#fff' : '#888',
        border: 'none',
        borderRadius: '6px 6px 0 0',
        minWidth: '120px',
        maxWidth: '180px',
        borderTop: isActive
            ? (type === 'vscode' ? '2px solid #007acc' : '2px solid #4CAF50') // Blue for VSCode, Green for Sys
            : '2px solid transparent',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        fontSize: '13px',
        transition: 'background 0.2s, color 0.2s',
        flexShrink: 0
    });

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>

            {/* Level 1: Group Selectors */}
            <div style={groupBarStyle}>
                <div style={groupTabStyle('sys')} onClick={() => setActiveGroup('sys')}>
                    🐚 System ({sysTerminals.length})
                </div>
                <div style={groupTabStyle('vscode')} onClick={() => setActiveGroup('vscode')}>
                    📝 VSCode ({displayedVscodeTerminals.length})
                </div>
            </div>

            {/* Level 2: Tab Bar (Filtered by Group) */}
            <div style={tabBarStyle} className="custom-scroll">

                {/* Fixed Toolbar Actions */}
                <div style={{ display: 'flex', gap: '4px', paddingRight: '12px', borderRight: '1px solid #333', marginRight: '8px' }}>
                    <button
                        onClick={refreshTerminals}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ccc',
                            padding: '6px',
                            cursor: 'pointer',
                            borderRadius: '4px'
                        }}
                        title="Refresh List"
                    >
                        ↻
                    </button>
                    {activeGroup === 'vscode' && (
                        <button
                            onClick={() => setShowAll(!showAll)}
                            style={{
                                background: showAll ? '#3794ff' : '#333',
                                border: 'none',
                                color: showAll ? '#fff' : '#aaa',
                                padding: '4px 8px',
                                cursor: 'pointer',
                                fontSize: '10px',
                                borderRadius: '4px',
                                fontWeight: 'bold'
                            }}
                            title={showAll ? "Showing Hidden Terminals" : "Hiding Ignored Terminals"}
                        >
                            {showAll ? 'ALL' : 'FILTER'}
                        </button>
                    )}
                </div>

                {/* Filtered Tabs List */}
                {activeGroup === 'sys' && (
                    <>
                        {sysTerminals.map(t => (
                            <div
                                key={`sys-${t.id}`}
                                onClick={() => switchTab('sys', t.id)}
                                style={tabStyle(activeTab?.type === 'sys' && activeTab?.id === t.id, 'sys')}
                            >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', marginRight: '6px' }}>
                                    {t.name}
                                </span>
                                <span
                                    onClick={(e) => { e.stopPropagation(); socket.emit('term:kill', { id: t.id }); }}
                                    style={{ opacity: 0.6, fontSize: '14px', padding: '0 4px', borderRadius: '50%', cursor: 'pointer' }}
                                    title="Kill Terminal"
                                >✕</span>
                            </div>
                        ))}
                        {/* New System Terminal Button */}
                        <button
                            onClick={() => socket.emit('term:create')}
                            style={{ ...tabStyle(false, 'sys'), minWidth: 'auto', padding: '0 12px', color: '#4CAF50', fontWeight: 'bold' }}
                            title="New System Terminal"
                        >+</button>
                    </>
                )}

                {activeGroup === 'vscode' && (
                    <>
                        {displayedVscodeTerminals.map(t => (
                            <div
                                key={`vscode-${t.id}`}
                                onClick={() => switchTab('vscode', t.id)}
                                style={tabStyle(activeTab?.type === 'vscode' && activeTab?.id === t.id, 'vscode')}
                            >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', marginRight: '6px' }}>
                                    {t.name}
                                </span>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    {/* Hide Button */}
                                    <span
                                        onClick={(e) => toggleHide(e, t.id)}
                                        style={{ opacity: 0.5, fontSize: '12px', cursor: 'pointer' }}
                                        title={hiddenTerminals.has(t.id) ? "Unhide" : "Hide from list"}
                                    >
                                        👁️
                                    </span>
                                    {/* Close Button */}
                                    <span
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            socket.emit('client:vscode:action', { type: 'kill', payload: t.id });
                                        }}
                                        style={{ opacity: 0.6, fontSize: '14px', marginLeft: '2px', cursor: 'pointer' }}
                                        title="Close Terminal"
                                    >✕</span>
                                </div>
                            </div>
                        ))}
                        {/* New VSCode Terminal Button */}
                        <button
                            onClick={() => socket.emit('client:vscode:action', { type: 'create' })}
                            style={{ ...tabStyle(false, 'vscode'), minWidth: 'auto', padding: '0 12px', color: '#007acc', fontWeight: 'bold' }}
                            title="New VS Code Terminal"
                        >+</button>
                    </>
                )}

            </div>

            {/* Content Area */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {sysTerminals.map(t => (
                    <SystemTerminalView
                        key={t.id}
                        id={t.id}
                        isActive={activeTab?.type === 'sys' && activeTab?.id === t.id}
                    />
                ))}

                {displayedVscodeTerminals.map(t => (
                    <VSCodeTerminalControl
                        key={t.id}
                        id={t.id}
                        name={t.name}
                        isActive={activeTab?.type === 'vscode' && activeTab?.id === t.id}
                    />
                ))}

                {(!activeTab && sysTerminals.length === 0 && vscodeTerminals.length === 0) && (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%',
                        color: '#666', gap: '10px'
                    }}>
                        <div style={{ fontSize: '40px', opacity: 0.2 }}>💻</div>
                        <p>No active terminals.</p>
                        <p>Select a group and tap <span style={{ color: '#ccc' }}>+</span> to start one.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ConsolePanel;
