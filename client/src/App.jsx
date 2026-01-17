import { useState, useEffect } from 'react'
import StreamCanvas from './components/StreamCanvas'
import SettingsPanel from './components/SettingsPanel'
import ConsolePanel from './components/ConsolePanel'
import AppsPanel from './components/AppsPanel'
import { socket } from './services/socket'
import './App.css'

// Inline Icons (Lucide-style)
const Icons = {
  MessageSquare: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
  ),
  Terminal: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
  ),
  Globe: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10z" /></svg>
  ),
  Grid: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
  ),
  Settings: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
  )
};

function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [showCropModal, setShowCropModal] = useState(false);

  // Handle Tab Switch
  const handleTabSwitch = (tab) => {
    setActiveTab(tab);

    // Explicitly set mode on server to avoid stuck states
    if (socket.connected) {
      if (tab === 'chat') {
        // StreamCanvas will mount and emit 'chat', but we can pre-set/ensure it
        socket.emit('view:setMode', 'chat');
      } else if (tab === 'console') {
        // Default to idle for console tab until a VSCode terminal is selected
        socket.emit('view:setMode', 'idle');
      } else if (tab === 'settings') {
        socket.emit('view:setMode', 'config');
      } else if (tab === 'apps') {
        socket.emit('view:setMode', 'idle');
      }
    }
  };

  // Handler for opening crop modal from settings
  const handleOpenCropConfig = () => {
    handleTabSwitch('chat');
    setShowCropModal(true);
  };

  const handleCloseCropModal = () => {
    setShowCropModal(false);
  };

  return (
    <div className="app-container">
      {/* Main Content Area */}
      <main className="app-content">
        {activeTab === 'chat' && (
          <StreamCanvas
            showCropModal={showCropModal}
            onCloseCropModal={handleCloseCropModal}
            viewMode="chat"
          />
        )}
        {activeTab === 'settings' && (
          <SettingsPanel onOpenCropConfig={handleOpenCropConfig} />
        )}
        {activeTab === 'apps' && (
          <AppsPanel />
        )}
        {activeTab === 'console' && (
          <ConsolePanel />
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <button
          className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('chat')}
        >
          <div className="nav-icon"><Icons.MessageSquare /></div>
        </button>

        <button
          className={`nav-item ${activeTab === 'console' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('console')}
        >
          <div className="nav-icon"><Icons.Terminal /></div>
        </button>

        <button
          className={`nav-item ${activeTab === 'apps' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('apps')}
        >
          <div className="nav-icon"><Icons.Grid /></div>
        </button>

        <button
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('settings')}
        >
          <div className="nav-icon"><Icons.Settings /></div>
        </button>
      </nav>
    </div>
  )
}

export default App
