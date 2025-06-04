import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import useSnackbar from '../hooks/useSnackbar';
import './styles/OpenFileButtonStyle.css';


interface OpenFileProps {
  setFileText: (text: string) => void;
}

export default function OpenFileButton({ setFileText }: OpenFileProps) {
  const { t } = useTranslation();
  const handleFileOpen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setFileText(content);
      }
    };
    reader.onerror = () => {useSnackbar().error(t('notifications.readError'))};
    reader.readAsText(file);
  };

  return (
    <div className="file-upload">
      <label className="file-label">
        <FileText size={16} />
        <span>{t('actions.openFile')}</span>
        <input className="hidden" type="file" accept=".txt" onChange={handleFileOpen} />
      </label>
    </div>
  );
}