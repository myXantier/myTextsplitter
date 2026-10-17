import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { FileImport } from '../hooks/useFileImport';
import './styles/OpenFileButtonStyle.css';


interface OpenFileProps {
  /** Import state of the text the file is loaded into (useFileImport). */
  fileImport: FileImport;
}

export default function OpenFileButton({ fileImport }: OpenFileProps) {
  const { t } = useTranslation();
  const handleFileOpen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset after taking the file, so choosing the same file again fires a new change (a cancelled dialog fires none)
    event.target.value = '';
    if (!file) return;
    fileImport.importFile(file);
  };

  return (
    <div className="file-upload">
      {fileImport.loading && (
        <span className="file-loading" role="status">
          {t('notifications.fileLoading')}
        </span>
      )}
      <label className="file-label">
        <FileText size={16} />
        <span>{t('actions.openFile')}</span>
        <input className="hidden" type="file" accept=".txt" onChange={handleFileOpen} />
      </label>
    </div>
  );
}
