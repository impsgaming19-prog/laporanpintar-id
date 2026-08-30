import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const menuItems = [
  { icon: '📊', label: 'Dashboard', path: '/' },
  { icon: '💬', label: 'Chat', path: '/chat' },
  { icon: '💰', label: 'Transaksi', path: '/transactions' },
  { icon: '📹', label: 'Video Call', path: '/video-call' },
  { icon: '📞', label: 'Voice Call', path: '/voice-call' },
  { icon: '📈', label: 'Statistik', path: '/statistics' },
  { icon: '⚙️', label: 'Pengaturan', path: '/settings' },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />}
      <div className={`fixed top-0 left-0 h-full w-72 bg-white dark:bg-gray-800 z-50 transition-transform ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b">
          <h2 className="text-xl font-bold">LaporanPintarID</h2>
        </div>
        <nav className="p-4">
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); onClose(); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-2 ${
                location.pathname === item.path ? 'bg-green-500 text-white' : 'hover:bg-gray-100'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
};

export default Sidebar;
