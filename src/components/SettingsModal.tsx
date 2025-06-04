import { useEffect, useRef } from 'react';
import Checkbox from './Checkbox';
import CustomSelect from './CustomSelect';
import {
  useSettings,
  useRuntimeSetting,
  usePermanentSetting,
  setRuntimeSetting,
  setPermanentSetting,
} from '../hooks/useSettings';
import { convertTextCase } from '../utils/ConvertTextCase';
import './styles/SettingsModalStyle.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function createItems<T extends string>(...items: T[]): Item<T>[] {
  let i = 0;
  return items.map((item) => ({ label: convertTextCase(item, 'TitleCasePlus'), value: item, index: i++ }));
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const fontSize = usePermanentSetting('fontSize');
  const showLineNumbers = usePermanentSetting('showLineNumbers');
  const showEmptyLines = usePermanentSetting('showEmptyLines');
  const language = usePermanentSetting('language');

  const separator = useRuntimeSetting('separator');
  const processingMode = useRuntimeSetting('processingMode');
  const combineSeparator = useRuntimeSetting('combineSeparator');

  const theme = useSettings((state) => state.theme);
  const setTheme = useSettings((state) => state.setTheme);

  const modalRef = useRef<HTMLDivElement>(null);

  const itemsFontsize: Item<fontSize>[] = [
    { label: 'Small', value: 'text-xs', index: 0 },
    { label: 'Medium', value: 'text-sm', index: 1 },
    { label: 'Large', value: 'text-base', index: 2 },
    { label: 'XL', value: 'text-lg', index: 3 },
  ];

  const itemsProcessMode: Item<processModes>[] = createItems('fallback', 'backend');

  const itemsLanguage: Item<language>[] = [
    { label: 'English', value: 'en', index: 0 },
    { label: 'Deutsch', value: 'de', index: 1 },
  ];

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.classList.add('no-scroll'); // document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('no-scroll'); // document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) onClose();
  };

  return (
    <div
      ref={modalRef}
      className={`settings-modal-overlay ${isOpen ? 'visible' : 'hidden'}`}
      onClick={handleOverlayClick}
      >
      <div className="settings-modal">
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-modal-content">
          <section className="settings-section">
            <h3>Appearance</h3>
            <div className="settings-group">
              <Checkbox checked={theme.isDark} onChange={() => setTheme(theme.getNextTheme())} label="Dark Mode" />

              <CustomSelect
                label="Font Size"
                items={itemsFontsize}
                value={fontSize}
                onChange={(val) => setPermanentSetting('fontSize', val)}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>Editor</h3>
            <div className="settings-group">
              <Checkbox
                checked={showLineNumbers}
                onChange={(val) => setPermanentSetting('showLineNumbers', val)}
                label="Show Line Numbers"
              />

              <Checkbox
                checked={showEmptyLines}
                onChange={(val) => setPermanentSetting('showEmptyLines', val)}
                label="Show Empty Lines"
              />
            </div>
          </section>

          <section className="settings-section">
            <h3>Processing</h3>
            <div className="settings-group">
              <CustomSelect
                label="Processing Mode"
                items={itemsProcessMode}
                value={processingMode}
                onChange={(val) => setRuntimeSetting('processingMode', val)}
              />

              <label className="settings-label">
                <span>Default Separator</span>
                <input type="text" value={separator} onChange={(e) => setRuntimeSetting('separator', e.target.value)} />
              </label>

              <label className="settings-label">
                <span>Combine Separator</span>
                <input
                  type="text"
                  value={combineSeparator}
                  onChange={(e) => setRuntimeSetting('combineSeparator', e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3>Language</h3>
            <div className="settings-group">
              <CustomSelect
                label="Language"
                items={itemsLanguage}
                value={language}
                onChange={(val) => setPermanentSetting('language', val)}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
