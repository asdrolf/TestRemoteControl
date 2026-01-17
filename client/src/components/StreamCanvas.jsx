import React, { useRef, useEffect, useState } from 'react';
import { socket } from '../services/socket';
import DraggableFab from './DraggableFab';

// Debounce helper
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

const StreamCanvas = ({ showCropModal: externalCropModal, onCloseCropModal, viewMode = 'chat' }) => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const inputRef = useRef(null);
    const [status, setStatus] = useState('Disconnected');
    const [inputMode, setInputMode] = useState(false);
    const [remoteScrollMode, setRemoteScrollMode] = useState(false);

    // Use external control for crop modal if provided
    const showCropModal = externalCropModal ?? false;
    const setShowCropModal = (val) => {
        if (!val && onCloseCropModal) {
            onCloseCropModal();
        }
    };

    const [focusNotice, setFocusNotice] = useState(null);
    const hasCheckedFocus = useRef(false);

    // Crop Config State
    const [cropConfig, setCropConfig] = useState({
        top: 40,
        bottom: 40,
        left: 0,
        right: 0
    });

    // Debounced emitter for crop updates
    const emitCropUpdate = useRef(
        debounce((config) => {
            socket.emit('config:update', {
                cropTop: config.top,
                cropBottom: config.bottom,
                cropLeft: config.left,
                cropRight: config.right
            });
        }, 100)
    ).current;


    // Zoom & Pan State
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

    // Sync viewMode with Server
    useEffect(() => {
        if (socket.connected) {
            socket.emit('view:setMode', viewMode);
            // Refresh config for the new mode to update sliders
            socket.emit('config:get');
        }

        const onConnectMode = () => {
            socket.emit('view:setMode', viewMode);
            socket.emit('config:get');
        }

        socket.on('connect', onConnectMode);
        return () => {
            socket.off('connect', onConnectMode);
        }
    }, [viewMode]);

    useEffect(() => {
        const onConnect = () => setStatus('Connected');
        const onDisconnect = () => setStatus('Disconnected');

        if (socket.connected) {
            setStatus('Connected');
        }

        const onFrame = (base64) => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (canvas && container) {
                const ctx = canvas.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    if (canvas.width !== img.width) canvas.width = img.width;
                    if (canvas.height !== img.height) canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);
                };
                img.src = `data:image/jpeg;base64,${base64}`;
            }
        };

        const onFocusLocation = (data) => {
            if (data.isInChat) {
                if (!inputMode) {
                    setInputMode(true);
                    setTimeout(() => {
                        if (inputRef.current) {
                            inputRef.current.value = '.';
                            inputRef.current.focus({ preventScroll: true });
                        }
                    }, 100);
                }
            } else {
                const msg = viewMode === 'chat' ? "⛔ Click in chat area to enable keyboard" : "⛔ Click in active area to enable keyboard";
                setFocusNotice(msg);
                setTimeout(() => setFocusNotice(null), 3000);
            }
        };

        // Load current config from server
        const onConfig = (config) => {
            setCropConfig({
                top: config.cropTop ?? 0,
                bottom: config.cropBottom ?? 0,
                left: config.cropLeft ?? 0,
                right: config.cropRight ?? 0
            });
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('frame', onFrame);
        socket.on('input:focusLocation', onFocusLocation);
        socket.on('config:current', onConfig);

        // Request current config
        socket.emit('config:get');

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('frame', onFrame);
            socket.off('input:focusLocation', onFocusLocation);
            socket.off('config:current', onConfig);
        };
    }, []);

    // Handle crop update
    const updateCrop = (key, value) => {
        const newVal = parseInt(value, 10) || 0;
        const newConfig = { ...cropConfig, [key]: newVal };
        setCropConfig(newConfig);
        emitCropUpdate(newConfig);
    };

    // Handle Input Mode Toggle
    const toggleInputMode = () => {
        if (inputMode) {
            setInputMode(false);
            inputRef.current?.blur();
        } else {
            socket.emit('input:checkFocus');
        }
    };

    // Handle Blur - Sync state when keyboard is dismissed natively
    const handleBlur = () => {
        // Use a tiny timeout to check if we are immediately re-focusing (e.g. clicking canvas)
        setTimeout(() => {
            if (document.activeElement !== inputRef.current) {
                setInputMode(false);
            }
        }, 100);
    };

    const handleInteraction = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e.type.startsWith('touch')) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const finalX = Math.round(x * scaleX);
        const finalY = Math.round(y * scaleY);

        if (e.type === 'click' || e.type === 'touchstart') {
            if (inputRef.current && containerRef.current) {
                const container = containerRef.current;
                const scrollTop = container.scrollTop;
                const scrollLeft = container.scrollLeft;

                inputRef.current.style.top = `${y + scrollTop}px`;
                inputRef.current.style.left = `${x + scrollLeft}px`;
            }

            socket.emit('input:click', { x: finalX, y: finalY });

            if (inputMode) {
                inputRef.current?.focus({ preventScroll: true });
            }
        }
    };

    const handleVirtualKey = (key) => {
        socket.emit('input:keyTap', key);
        inputRef.current?.focus({ preventScroll: true });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            socket.emit('input:keyTap', 'enter');
        }
    };

    const handleType = (e) => {
        const inputType = e.nativeEvent.inputType;
        const val = e.target.value;
        const char = val.slice(-1);

        if (inputType === 'deleteContentBackward') {
            socket.emit('input:keyTap', 'backspace');
        } else if (inputType === 'insertText' && char) {
            socket.emit('input:type', char);
        }

        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.value = '.';
            }
        }, 0);
    };


    const getTouchDistance = (touches) => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const getTouchCenter = (touches) => {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2,
        };
    };

    const lastTouchDistanceRef = useRef(null);
    const lastTouchPosRef = useRef(null);
    const isDraggingRef = useRef(false);
    const touchStartPosRef = useRef(null);

    // Three-finger scroll state
    const isThreeFingerRef = useRef(false);
    const threeFingerStartedRef = useRef(false);

    // Helper: get center of 3 touches
    const getTouchCenterThree = (touches) => {
        return {
            x: (touches[0].clientX + touches[1].clientX + touches[2].clientX) / 3,
            y: (touches[0].clientY + touches[1].clientY + touches[2].clientY) / 3,
        };
    };

    const handleTouchStart = (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const distance = getTouchDistance(e.touches);
            const center = getTouchCenter(e.touches);

            lastTouchDistanceRef.current = distance;
            lastTouchPosRef.current = center;
            // Record starting transform for relative movement if needed, 
            // but we'll use delta-based movement for better feeling
        } else if (e.touches.length === 3) {
            // Three-finger scroll gesture
            e.preventDefault();
            isThreeFingerRef.current = true;
            threeFingerStartedRef.current = false;
            lastTouchPosRef.current = getTouchCenterThree(e.touches);
        } else if (e.touches.length === 1) {
            const touch = e.touches[0];
            touchStartPosRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
            lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
            isDraggingRef.current = false;
        }
    };

    const handleTouchMove = (e) => {
        if (e.touches.length === 2 && lastTouchPosRef.current && lastTouchDistanceRef.current) {
            e.preventDefault();

            const currentDistance = getTouchDistance(e.touches);
            const currentCenter = getTouchCenter(e.touches);

            // ZOOM logic
            let zoomFactor = currentDistance / lastTouchDistanceRef.current;
            let newScale = transform.scale * zoomFactor;
            newScale = Math.max(1, Math.min(newScale, 5));

            // Adjust X/Y to keep pinch center stable
            const dx = currentCenter.x - lastTouchPosRef.current.x;
            const dy = currentCenter.y - lastTouchPosRef.current.y;

            // Simple zoom toward center logic
            // To be more precise, we'd need to calculate based on the canvas-relative pinch center
            // but delta-based pan + zoom is often good enough for this UI

            setTransform(prev => ({
                scale: newScale,
                x: prev.x + dx,
                y: prev.y + dy
            }));

            lastTouchDistanceRef.current = currentDistance;
            lastTouchPosRef.current = currentCenter;
            isDraggingRef.current = true;

        } else if (e.touches.length === 3 && isThreeFingerRef.current && lastTouchPosRef.current) {
            // Three-finger scroll: scroll remote chat/terminal content
            e.preventDefault();

            // On first move: click on panel edge to ensure focus
            if (!threeFingerStartedRef.current) {
                socket.emit('input:threeFingerScrollStart');
                threeFingerStartedRef.current = true;
            }

            // Calculate delta and emit scroll
            const center = getTouchCenterThree(e.touches);
            const dy = center.y - lastTouchPosRef.current.y;

            // Emit scroll with three-finger flag for separate sensitivity
            socket.emit('input:scroll', {
                deltaY: -dy * 0.8, // Inverted for natural scroll feel
                isThreeFinger: true
            });

            lastTouchPosRef.current = center;
            isDraggingRef.current = true;

        } else if (e.touches.length === 1 && lastTouchPosRef.current) {
            const touch = e.touches[0];
            const dx = touch.clientX - lastTouchPosRef.current.x;
            const dy = touch.clientY - lastTouchPosRef.current.y;

            // Threshold for dragging
            const dist = Math.sqrt(
                Math.pow(touch.clientX - touchStartPosRef.current.x, 2) +
                Math.pow(touch.clientY - touchStartPosRef.current.y, 2)
            );
            if (dist > 10) {
                isDraggingRef.current = true;
                e.preventDefault(); // Prevent browser scroll/bounce

                if (remoteScrollMode) {
                    // REMOTE SCROLL MODE (Priority): scroll chat content with sensitivity
                    // 0.1 provides smoother control
                    const scrollFactor = 0.1;
                    console.log('[Client Debug] Emitting scroll:', dy * scrollFactor);
                    socket.emit('input:scroll', {
                        deltaY: dy * scrollFactor,
                        isThreeFinger: true
                    });
                } else if (transform.scale > 1) {
                    // PAN image locally if zoomed and NOT in scroll mode
                    setTransform(prev => ({
                        ...prev,
                        x: prev.x + dx,
                        y: prev.y + dy
                    }));
                }

                lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
            }
        }
    };

    const handleTouchEnd = (e) => {
        // Handle Tap (Click fallback)
        if (!isDraggingRef.current && touchStartPosRef.current) {
            const duration = Date.now() - touchStartPosRef.current.time;
            if (duration < 300) {
                // It was a tap, trigger interaction
                handleInteraction(e);
            }
        }

        lastTouchDistanceRef.current = null;
        lastTouchPosRef.current = null;
        touchStartPosRef.current = null;
        isDraggingRef.current = false;

        // Clean up three-finger state
        isThreeFingerRef.current = false;
        threeFingerStartedRef.current = false;
    };


    return (
        <div
            className={`stream-container ${inputMode ? 'input-active' : ''}`}
            style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                position: 'relative',
                width: '100%',
                overflow: 'hidden', // Main container doesn't scroll
            }}
        >
            {/* Scrollable Area for Content */}
            <div
                ref={containerRef}
                style={{
                    width: '100%',
                    height: '100%',
                    overflowY: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    position: 'relative'
                }}
            >

                {/* Connection Status Overlay - Only show if disconnected */}
                {status !== 'Connected' && (
                    <div className="status-indicator status-disconnected">
                        {status}
                    </div>
                )}

                {/* Focus Warning Toast */}
                {focusNotice && (
                    <div className="focus-notice-overlay">
                        {focusNotice}
                    </div>
                )}

                {/* The Stream */}
                <canvas
                    ref={canvasRef}
                    onClick={handleInteraction}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    style={{
                        width: '100%',
                        height: 'auto',
                        objectFit: 'contain',
                        boxShadow: '0 0 20px rgba(0,0,0,0.5)',
                        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                        transformOrigin: '0 0',
                        touchAction: 'pan-x pan-y'
                    }}
                />

                {/* Hidden Input for Keyboard */}
                <input
                    ref={inputRef}
                    type="text"
                    style={{
                        opacity: 0,
                        position: 'fixed',
                        bottom: '0px',
                        left: '0px',
                        width: '1px',
                        height: '1px',
                        overflow: 'hidden',
                        pointerEvents: 'none',
                        fontSize: '16px',
                        zIndex: -1
                    }}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    onChange={handleType}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                />

                {/* Crop Modal Overlay */}
                {showCropModal && (
                    <div className="crop-modal-overlay" onClick={() => setShowCropModal(false)}>
                        <div className="crop-modal-content" onClick={(e) => e.stopPropagation()}>
                            <h3 style={{ marginTop: 0, marginBottom: '16px' }}>✂️ Ajustar Recorte</h3>

                            <div className="crop-control-group">
                                <div className="crop-label">
                                    <span>Arriba</span>
                                    <span>{cropConfig.top}px</span>
                                </div>
                                <input
                                    type="range" min="0" max="250"
                                    value={cropConfig.top}
                                    onChange={(e) => updateCrop('top', e.target.value)}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div className="crop-control-group">
                                <div className="crop-label">
                                    <span>Abajo</span>
                                    <span>{cropConfig.bottom}px</span>
                                </div>
                                <input
                                    type="range" min="0" max="250"
                                    value={cropConfig.bottom}
                                    onChange={(e) => updateCrop('bottom', e.target.value)}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div className="crop-control-group">
                                <div className="crop-label">
                                    <span>Izquierda</span>
                                    <span>{cropConfig.left}px</span>
                                </div>
                                <input
                                    type="range" min="0" max="150"
                                    value={cropConfig.left}
                                    onChange={(e) => updateCrop('left', e.target.value)}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div className="crop-control-group">
                                <div className="crop-label">
                                    <span>Derecha</span>
                                    <span>{cropConfig.right}px</span>
                                </div>
                                <input
                                    type="range" min="0" max="150"
                                    value={cropConfig.right}
                                    onChange={(e) => updateCrop('right', e.target.value)}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <button className="primary-btn" onClick={() => setShowCropModal(false)}>
                                Listo
                            </button>
                        </div>
                    </div>
                )}

            </div>

            {/* Keyboard FAB - Now outside scrollable div, sits in main stream-container */}
            <DraggableFab
                className="fab-input"
                onClick={toggleInputMode}
                style={{
                    position: 'absolute',
                    bottom: inputMode ? '60px' : '16px',
                    right: '16px',
                    zIndex: 200
                }}
            >
                {inputMode ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m6 8 .001 0" /><path d="m10 8 .001 0" /><path d="m14 8 .001 0" /><path d="m18 8 .001 0" /><path d="m6 12 .001 0" /><path d="m10 12 .001 0" /><path d="m14 12 .001 0" /><path d="m18 12 .001 0" /><path d="m7 16 10 0" /></svg>
                )}
            </DraggableFab>

            {/* Remote Scroll Mode FAB - Only visible in 'chat' mode */}
            {viewMode === 'chat' && (
                <DraggableFab
                    className={`fab-input ${remoteScrollMode ? 'active' : ''}`}
                    onClick={() => {
                        const newMode = !remoteScrollMode;
                        setRemoteScrollMode(newMode);
                        if (newMode) {
                            // Click to give focus when activating
                            socket.emit('input:threeFingerScrollStart');
                        }
                    }}
                    style={{
                        position: 'absolute',
                        bottom: inputMode ? '60px' : '16px',
                        left: '16px',
                        zIndex: 200,
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: remoteScrollMode ? '#2196F3' : '#333', // Blue vs Dark Grey
                        color: 'white',
                        border: remoteScrollMode ? '2px solid white' : 'none',
                        boxShadow: remoteScrollMode ? '0 0 10px rgba(33, 150, 243, 0.6)' : '0 2px 5px rgba(0,0,0,0.3)',
                        transition: 'background-color 0.2s, box-shadow 0.2s, color 0.2s, border-color 0.2s'
                    }}
                    title={remoteScrollMode ? 'Modo Scroll Activo (1 dedo)' : 'Activar Modo Scroll (1 dedo)'}
                >
                    {remoteScrollMode ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="m8 6 4-3 4 3" /><path d="m8 18 4 3 4-3" /></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="m8 8 4-4 4 4" /><path d="m8 16 4 4 4-4" /></svg>
                    )}
                </DraggableFab>
            )}

        </div>
    );
};

export default StreamCanvas;
