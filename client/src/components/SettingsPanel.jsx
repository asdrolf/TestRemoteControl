import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../services/socket';

// Debounce helper
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

const SettingsPanel = ({ onOpenCropConfig }) => {
    const [activeTab, setActiveTab] = useState('chat');

    // Default settings - server-synced settings will be updated when config loads
    const [settings, setSettings] = useState(() => {
        const saved = localStorage.getItem('clientSettings');
        const defaultSettings = {
            // UI preferences (client-only, saved locally)
            theme: 'dark',
            fabPosition: 'bottom-right',
            // Server-synced settings (defaults, will be updated from server)
            fps: 30,
            fpsMin: 10,
            fpsMax: 60,
            quality: 70,
            qualityMin: 30,
            qualityMax: 100,
            scrollSensitivity: 1.0,
            threeFingerScrollSensitivity: 1.0,
            windowTitles: "Cursor|Antigravity|Windsurf",
            detectionMode: 'fixed', // 'dynamic' | 'fixed'
            showDebugLines: true,
            autoActivateWindow: true,
            console: {
                fontSize: 14,
                fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                theme: 'dark',
                cursorStyle: 'block',
                cursorBlink: true,
                lineHeight: 1.2,
                letterSpacing: 0
            }
        };

        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return { ...defaultSettings, ...parsed };
            } catch (e) {
                console.error("Error parsing saved client settings", e);
            }
        }
        return defaultSettings;
    });

    const [isCalibrating, setIsCalibrating] = useState(false);
    const [serverUrl, setServerUrl] = useState(() => {
        return localStorage.getItem('serverUrl') || `${window.location.hostname}:3001`;
    });

    // Debounced config update
    const emitConfigUpdate = useRef(
        debounce((updates) => {
            socket.emit('config:update', updates);
        }, 150)
    ).current;

    // Keep settings in a ref for sync access without closure staleness
    const settingsRef = useRef(settings);
    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

    // Load settings from server on connect
    useEffect(() => {
        const handleConfig = (config) => {
            setSettings(prev => ({
                ...prev,
                // Update server-controlled settings
                fps: config.fps ?? prev.fps,
                fpsMin: config.fpsMin ?? prev.fpsMin,
                fpsMax: config.fpsMax ?? prev.fpsMax,
                quality: config.quality ?? prev.quality,
                qualityMin: config.qualityMin ?? prev.qualityMin,
                qualityMax: config.qualityMax ?? prev.qualityMax,
                scrollSensitivity: config.scrollSensitivity ?? prev.scrollSensitivity,
                threeFingerScrollSensitivity: config.threeFingerScrollSensitivity ?? prev.threeFingerScrollSensitivity,
                windowTitles: config.windowTitles ?? prev.windowTitles,
                detectionMode: config.detectionMode ?? prev.detectionMode,
                showDebugLines: config.showDebugLines ?? prev.showDebugLines,
                autoActivateWindow: config.autoActivateWindow ?? prev.autoActivateWindow,
                console: config.console ? { ...prev.console, ...config.console } : prev.console,
            }));
        };

        const handleCalibrationStatus = (status) => {
            if (status.reset) {
                setIsCalibrating(true);
                setTimeout(() => setIsCalibrating(false), 5000);
            }
        };

        const syncWithServer = () => {
            console.log("Requesting config from server...");
            // Just request current config from server - don't push local settings
            socket.emit('config:get');
        };

        socket.on('config:current', handleConfig);
        socket.on('calibration:status', handleCalibrationStatus);
        socket.on('connect', syncWithServer);

        // SYNC: Push local settings if already connected
        if (socket.connected) {
            syncWithServer();
        }

        return () => {
            socket.off('config:current', handleConfig);
            socket.off('calibration:status', handleCalibrationStatus);
            socket.off('connect', syncWithServer);
        };
    }, []);

    // Apply theme on load
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', settings.theme);
    }, [settings.theme]);

    // Update setting, save client preferences to localStorage and emit to server
    const updateSetting = useCallback((key, value) => {
        setSettings(prev => {
            let next;
            if (key.startsWith('console.')) {
                const consoleKey = key.split('.')[1];
                next = {
                    ...prev,
                    console: { ...prev.console, [consoleKey]: value }
                };
            } else {
                next = { ...prev, [key]: value };
            }

            // Save only client-specific preferences to localStorage
            const clientSettings = {
                theme: next.theme,
                fabPosition: next.fabPosition
            };
            localStorage.setItem('clientSettings', JSON.stringify(clientSettings));

            return next;
        });

        // Determine if this is a server setting or client-only setting
        const serverKeyMap = {
            fps: 'fps',
            quality: 'quality',
            scrollSensitivity: 'scrollSensitivity',
            threeFingerScrollSensitivity: 'threeFingerScrollSensitivity',
            windowTitles: 'windowTitles',
            showDebugLines: 'showDebugLines',
            detectionMode: 'detectionMode',
            autoActivateWindow: 'autoActivateWindow',
            'console.fontSize': 'console.fontSize',
            'console.fontFamily': 'console.fontFamily',
            'console.theme': 'console.theme',
            'console.cursorStyle': 'console.cursorStyle',
            'console.cursorBlink': 'console.cursorBlink',
            'console.lineHeight': 'console.lineHeight',
            'console.letterSpacing': 'console.letterSpacing'
        };

        const clientOnlyKeys = ['theme', 'fabPosition'];

        if (serverKeyMap[key]) {
            const serverKey = serverKeyMap[key];
            if (serverKey.includes('.')) {
                const [parent, child] = serverKey.split('.');
                emitConfigUpdate({ [parent]: { [child]: value } });
            } else {
                emitConfigUpdate({ [serverKey]: value });
            }
        } else if (clientOnlyKeys.includes(key)) {
            // Client-only settings don't need server sync
        }
    }, [emitConfigUpdate]);

    // UI/Client-only settings (convenience wrapper)
    const updateClientSetting = updateSetting;

    const handleRecalibrate = () => {
        socket.emit('calibration:reset');
        setIsCalibrating(true);
    };

    const handleServerUrlChange = (newUrl) => {
        setServerUrl(newUrl);
        localStorage.setItem('serverUrl', newUrl);
    };

    const applyServerUrl = () => {
        localStorage.setItem('serverUrl', serverUrl);
        window.location.reload();
    };

    const tabs = [
        { id: 'chat', label: '💬 Chat' },
        { id: 'console', label: '⌨️ Console' },
        { id: 'apps', label: '📱 Apps' },
        { id: 'general', label: '⚙️ General' }
    ];

    return (
        <div className="settings-panel">
            {/* Tab Bar */}
            <div className="settings-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="settings-content">
                {/* CHAT TAB */}
                {activeTab === 'chat' && (
                    <>
                        <section className="settings-section">
                            <h3 className="section-title">
                                <span className="icon">📺</span>
                                Stream
                            </h3>

                            <div className="setting-item">
                                <div className="setting-label">
                                    <span>FPS</span>
                                    <span className="setting-value">{settings.fps}</span>
                                </div>
                                <input
                                    type="range"
                                    min={settings.fpsMin}
                                    max={settings.fpsMax}
                                    step="5"
                                    value={settings.fps}
                                    onChange={(e) => updateSetting('fps', parseInt(e.target.value))}
                                    className="slider"
                                />
                                <div className="slider-labels">
                                    <span>Lento</span>
                                    <span>Rápido</span>
                                </div>
                            </div>

                            <div className="setting-item">
                                <div className="setting-label">
                                    <span>Calidad</span>
                                    <span className="setting-value">{settings.quality}%</span>
                                </div>
                                <input
                                    type="range"
                                    min={settings.qualityMin}
                                    max={settings.qualityMax}
                                    step="5"
                                    value={settings.quality}
                                    onChange={(e) => updateSetting('quality', parseInt(e.target.value))}
                                    className="slider"
                                />
                                <div className="slider-labels">
                                    <span>Baja</span>
                                    <span>Alta</span>
                                </div>
                            </div>
                        </section>

                        <section className="settings-section">
                            <h3 className="section-title">
                                <span className="icon">🔍</span>
                                Detección de Ventana
                            </h3>

                            <div className="setting-item">
                                <label className="input-label">Títulos de ventana (| separados)</label>
                                <input
                                    type="text"
                                    value={settings.windowTitles}
                                    onChange={(e) => updateSetting('windowTitles', e.target.value)}
                                    className="text-input"
                                    placeholder="Cursor|Antigravity|Windsurf"
                                />
                            </div>

                            <div className="setting-item">
                                <label className="input-label">Depuración</label>
                                <div className="button-group">
                                    <button
                                        className={`toggle-btn ${settings.showDebugLines ? 'active' : ''}`}
                                        onClick={() => updateSetting('showDebugLines', true)}
                                    >
                                        👁️ Ver líneas
                                    </button>
                                    <button
                                        className={`toggle-btn ${!settings.showDebugLines ? 'active' : ''}`}
                                        onClick={() => updateSetting('showDebugLines', false)}
                                    >
                                        🚫 Ocultar
                                    </button>
                                </div>
                                <p className="setting-hint">Líneas rojas/verdes durante calibración</p>
                            </div>

                            <div className="setting-item">
                                <label className="input-label">Modo de Detección</label>
                                <div className="button-group">
                                    <button
                                        className={`toggle-btn ${settings.detectionMode !== 'fixed' ? 'active' : ''}`}
                                        onClick={() => updateSetting('detectionMode', 'dynamic')}
                                    >
                                        🔄 Dinámico
                                    </button>
                                    <button
                                        className={`toggle-btn ${settings.detectionMode === 'fixed' ? 'active' : ''}`}
                                        onClick={() => updateSetting('detectionMode', 'fixed')}
                                    >
                                        📍 Fijo
                                    </button>
                                </div>
                                <p className="setting-hint">"Fijo" guarda la zona detectada para mayor estabilidad.</p>
                            </div>

                            {settings.detectionMode === 'fixed' ? (
                                <button
                                    className={`action-btn ${isCalibrating ? 'disabled' : ''}`}
                                    onClick={() => {
                                        socket.emit('calibration:resetFixed');
                                        setIsCalibrating(true);
                                    }}
                                    disabled={isCalibrating}
                                    style={{ marginBottom: '8px' }}
                                >
                                    {isCalibrating ? '🔄 Reseteando...' : '📏 Resetear Zona Fija'}
                                </button>
                            ) : (
                                <button
                                    className={`action-btn ${isCalibrating ? 'disabled' : ''}`}
                                    onClick={handleRecalibrate}
                                    disabled={isCalibrating}
                                >
                                    {isCalibrating ? '🔄 Calibrando...' : '🎯 Recalibrar Detección'}
                                </button>
                            )}

                            <button
                                className="action-btn secondary"
                                onClick={onOpenCropConfig}
                                style={{ marginTop: '12px' }}
                            >
                                ✂️ Ajustar Recorte de Pantalla
                            </button>
                        </section>

                        <section className="settings-section">
                            <h3 className="section-title">
                                <span className="icon">🖱️</span>
                                Entrada
                            </h3>

                            <div className="setting-item">
                                <div className="setting-label">
                                    <span>Sensibilidad del Scroll</span>
                                    <span className="setting-value">{settings.scrollSensitivity.toFixed(1)}x</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="3"
                                    step="0.1"
                                    value={settings.scrollSensitivity}
                                    onChange={(e) => updateSetting('scrollSensitivity', parseFloat(e.target.value))}
                                    className="slider"
                                />
                                <div className="slider-labels">
                                    <span>Lento</span>
                                    <span>Rápido</span>
                                </div>
                            </div>

                            <div className="setting-item">
                                <div className="setting-label">
                                    <span>Scroll 3 Dedos</span>
                                    <span className="setting-value">{settings.threeFingerScrollSensitivity.toFixed(1)}x</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.3"
                                    max="3"
                                    step="0.1"
                                    value={settings.threeFingerScrollSensitivity}
                                    onChange={(e) => updateSetting('threeFingerScrollSensitivity', parseFloat(e.target.value))}
                                    className="slider"
                                />
                                <div className="slider-labels">
                                    <span>Lento</span>
                                    <span>Rápido</span>
                                </div>
                                <p className="setting-hint">Arrastra 3 dedos para scroll del chat</p>
                            </div>
                        </section>
                    </>
                )}

                {/* CONSOLE TAB */}
                {activeTab === 'console' && (
                    <>
                        <section className="settings-section">
                            <h3 className="section-title">
                                <span className="icon">🔤</span>
                                Fuente y Texto
                            </h3>

                            <div className="setting-item">
                                <div className="setting-label">
                                    <span>Tamaño de fuente</span>
                                    <span className="setting-value">{settings.console.fontSize}px</span>
                                </div>
                                <input
                                    type="range"
                                    min="8"
                                    max="32"
                                    step="1"
                                    value={settings.console.fontSize}
                                    onChange={(e) => updateSetting('console.fontSize', parseInt(e.target.value))}
                                    className="slider"
                                />
                                <div className="slider-labels">
                                    <span>Pequeño</span>
                                    <span>Grande</span>
                                </div>
                            </div>

                            <div className="setting-item">
                                <label className="input-label">Familia de fuente</label>
                                <select
                                    value={settings.console.fontFamily}
                                    onChange={(e) => updateSetting('console.fontFamily', e.target.value)}
                                    className="select-input"
                                >
                                    <option value='Consolas, Monaco, "Courier New", monospace'>Consolas (Recomendado)</option>
                                    <option value='"Fira Code", Consolas, Monaco, monospace'>Fira Code</option>
                                    <option value='"JetBrains Mono", Consolas, Monaco, monospace'>JetBrains Mono</option>
                                    <option value='"Source Code Pro", Consolas, Monaco, monospace'>Source Code Pro</option>
                                    <option value='Monaco, Consolas, "Courier New", monospace'>Monaco</option>
                                    <option value='"Courier New", monospace'>Courier New</option>
                                </select>
                            </div>

                            <div className="setting-item">
                                <div className="setting-label">
                                    <span>Interlineado</span>
                                    <span className="setting-value">{settings.console.lineHeight.toFixed(1)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.8"
                                    max="2.0"
                                    step="0.1"
                                    value={settings.console.lineHeight}
                                    onChange={(e) => updateSetting('console.lineHeight', parseFloat(e.target.value))}
                                    className="slider"
                                />
                                <div className="slider-labels">
                                    <span>Compacto</span>
                                    <span>Espaciado</span>
                                </div>
                            </div>

                            <div className="setting-item">
                                <div className="setting-label">
                                    <span>Espaciado de letras</span>
                                    <span className="setting-value">{settings.console.letterSpacing}px</span>
                                </div>
                                <input
                                    type="range"
                                    min="-2"
                                    max="10"
                                    step="1"
                                    value={settings.console.letterSpacing}
                                    onChange={(e) => updateSetting('console.letterSpacing', parseInt(e.target.value))}
                                    className="slider"
                                />
                                <div className="slider-labels">
                                    <span>Estrecho</span>
                                    <span>Ancho</span>
                                </div>
                            </div>
                        </section>

                        <section className="settings-section">
                            <h3 className="section-title">
                                <span className="icon">👁️</span>
                                Apariencia
                            </h3>

                            <div className="setting-item">
                                <label className="input-label">Tema de colores</label>
                                <div className="button-group">
                                    <button
                                        className={`toggle-btn ${settings.console.theme === 'dark' ? 'active' : ''}`}
                                        onClick={() => updateSetting('console.theme', 'dark')}
                                    >
                                        🌙 Oscuro
                                    </button>
                                    <button
                                        className={`toggle-btn ${settings.console.theme === 'light' ? 'active' : ''}`}
                                        onClick={() => updateSetting('console.theme', 'light')}
                                    >
                                        ☀️ Claro
                                    </button>
                                </div>
                            </div>

                            <div className="setting-item">
                                <label className="input-label">Estilo del cursor</label>
                                <div className="button-group">
                                    <button
                                        className={`toggle-btn ${settings.console.cursorStyle === 'block' ? 'active' : ''}`}
                                        onClick={() => updateSetting('console.cursorStyle', 'block')}
                                    >
                                        █ Bloque
                                    </button>
                                    <button
                                        className={`toggle-btn ${settings.console.cursorStyle === 'underline' ? 'active' : ''}`}
                                        onClick={() => updateSetting('console.cursorStyle', 'underline')}
                                    >
                                        _ Subrayado
                                    </button>
                                    <button
                                        className={`toggle-btn ${settings.console.cursorStyle === 'bar' ? 'active' : ''}`}
                                        onClick={() => updateSetting('console.cursorStyle', 'bar')}
                                    >
                                        | Barra
                                    </button>
                                </div>
                            </div>

                            <div className="setting-item">
                                <label className="input-label">Cursor parpadeante</label>
                                <div className="button-group">
                                    <button
                                        className={`toggle-btn ${settings.console.cursorBlink ? 'active' : ''}`}
                                        onClick={() => updateSetting('console.cursorBlink', true)}
                                    >
                                        ✅ Sí
                                    </button>
                                    <button
                                        className={`toggle-btn ${!settings.console.cursorBlink ? 'active' : ''}`}
                                        onClick={() => updateSetting('console.cursorBlink', false)}
                                    >
                                        ❌ No
                                    </button>
                                </div>
                            </div>
                        </section>
                    </>
                )}

                {/* APPS TAB */}
                {activeTab === 'apps' && (
                    <section className="settings-section">
                        <h3 className="section-title">
                            <span className="icon">📱</span>
                            Aplicaciones
                        </h3>
                        <div className="placeholder-box">
                            <span>🚧</span>
                            <p>Configuración de aplicaciones próximamente...</p>
                        </div>
                    </section>
                )}

                {/* GENERAL TAB */}
                {activeTab === 'general' && (
                    <>
                        <section className="settings-section">
                            <h3 className="section-title">
                                <span className="icon">🌐</span>
                                Conexión
                            </h3>

                            <div className="setting-item">
                                <label className="input-label">URL del Servidor</label>
                                <div className="url-input-group">
                                    <input
                                        type="text"
                                        value={serverUrl}
                                        onChange={(e) => handleServerUrlChange(e.target.value)}
                                        className="text-input"
                                        placeholder="192.168.1.100:3001"
                                    />
                                    <button className="apply-btn" onClick={applyServerUrl}>
                                        Aplicar
                                    </button>
                                </div>
                                <p className="setting-hint">Requiere recargar la página</p>
                            </div>
                        </section>

                        <section className="settings-section">
                            <h3 className="section-title">
                                <span className="icon">⚙️</span>
                                Comportamiento
                            </h3>

                            <div className="setting-item">
                                <label className="input-label">Auto-activar Ventana</label>
                                <div className="button-group">
                                    <button
                                        className={`toggle-btn ${settings.autoActivateWindow ? 'active' : ''}`}
                                        onClick={() => updateSetting('autoActivateWindow', true)}
                                    >
                                        ⚡ Activado
                                    </button>
                                    <button
                                        className={`toggle-btn ${!settings.autoActivateWindow ? 'active' : ''}`}
                                        onClick={() => updateSetting('autoActivateWindow', false)}
                                    >
                                        🛑 Desactivado
                                    </button>
                                </div>
                                <p className="setting-hint">Maximiza la ventana si está minimizada o en otro plano</p>
                            </div>
                        </section>

                        <section className="settings-section">
                            <h3 className="section-title">
                                <span className="icon">🎨</span>
                                Interfaz
                            </h3>

                            <div className="setting-item">
                                <label className="input-label">Tema</label>
                                <div className="button-group">
                                    <button
                                        className={`toggle-btn ${settings.theme === 'dark' ? 'active' : ''}`}
                                        onClick={() => updateClientSetting('theme', 'dark')}
                                    >
                                        🌙 Oscuro
                                    </button>
                                    <button
                                        className={`toggle-btn ${settings.theme === 'light' ? 'active' : ''}`}
                                        onClick={() => updateClientSetting('theme', 'light')}
                                    >
                                        ☀️ Claro
                                    </button>
                                </div>
                            </div>

                            <div className="setting-item">
                                <label className="input-label">Posición del Teclado</label>
                                <div className="button-group">
                                    <button
                                        className={`toggle-btn ${settings.fabPosition === 'bottom-right' ? 'active' : ''}`}
                                        onClick={() => updateClientSetting('fabPosition', 'bottom-right')}
                                    >
                                        ↘️ Derecha
                                    </button>
                                    <button
                                        className={`toggle-btn ${settings.fabPosition === 'bottom-left' ? 'active' : ''}`}
                                        onClick={() => updateClientSetting('fabPosition', 'bottom-left')}
                                    >
                                        ↙️ Izquierda
                                    </button>
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
};

export default SettingsPanel;
