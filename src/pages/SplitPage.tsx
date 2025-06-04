import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SplitSquareHorizontal, TextIcon } from 'lucide-react';
import InputText from '../components/InputText';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { ResultColumns } from './pageComponents/ResultColumns';
import { CombineColumns } from './pageComponents/CombineColumns';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import { useRuntimeSetting, usePermanentSetting, setRuntimeSetting, setPermanentSetting } from '../hooks/useSettings';
import { useCombineHistoryStore } from '../hooks/useCombineHistoryStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { validateRegexPattern } from '../utils/regex';
import { BaseService } from '../services/BaseService';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import useSnackbar from '../hooks/useSnackbar';
import './styles/SplitPageStyle.css';

interface SplitPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  splitResults: string[][];
  setSplitResults: Dispatch<SetStateAction<string[][]>>;
  visible?: boolean;
}

const TEST_RUN = false;

export default function SplitPage({
  sourceText,
  setSourceText,
  splitResults,
  setSplitResults,
  visible,
}: SplitPageProps) {
  const { t } = useTranslation();
  const { splitText } = useBackendProcessor();
  const [isLoading, setIsLoading] = useState(false);
  const [currentWorkerAbort, setCurrentWorkerAbort] = useState<(() => void) | null>(null);
  const snackbar = useSnackbar();

  // const { runtime, setRuntime, permanent, setPermanent } = useSettings();
  const showLineNumbers = usePermanentSetting('showLineNumbers');
  const trimLine = usePermanentSetting('trimLine');
  const trimParts = usePermanentSetting('trimParts');
  const isDarkMode = usePermanentSetting('isDarkMode');
  const fontSize = usePermanentSetting('fontSize');

  const separator = useRuntimeSetting('separator');
  const useRegex = useRuntimeSetting('useRegex');

  // const { undoCombine, redoCombine, canUndo, canRedo } = useCombineHistoryStore();
  const canUndo = useCombineHistoryStore((state) => state.canUndo());
  const undoCombine = useCombineHistoryStore((state) => state.undoCombine);
  const canRedo = useCombineHistoryStore((state) => state.canRedo());
  const redoCombine = useCombineHistoryStore((state) => state.redoCombine);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        if (!navigator.clipboard) {
          throw new Error('Clipboard API nicht verfügbar');
        }
        await navigator.clipboard.writeText(text);
        snackbar.success(t('notifications.copied'));
      } catch (error) {
        window.logger.error('Clipboard Fehler:', error);
        snackbar.error('Fehler beim Kopieren');
      }
    },
    [snackbar, t]
  );

  useKeyboardShortcuts({
    onSplit: () => {},
    onUndo: () => {
      if (canUndo) undoCombine();
    },
    onRedo: () => {
      if (canRedo) redoCombine();
    },
    onCopy: () => {
      const selection = window.getSelection()?.toString();
      if (selection) {
        copyToClipboard(selection);
      }
    },
  });

  const handleSplit = useCallback(async () => {
    if (TEST_RUN) {
      const testResult = [['test'], ['text']];
      setSplitResults(testResult);
      snackbar.info('Set test-result.');
      return;
    }

    if (!sourceText) return;

    if (currentWorkerAbort) {
      window.logger.warn('⏳ Abbruch des vorherigen Splitting-Prozesses...');
      currentWorkerAbort();
    }

    setIsLoading(true);

    try {
      const delimiter = separator;

      if (useRegex && !validateRegexPattern(delimiter)) {
        snackbar.error('⚠ Ungültiges Regex-Pattern!');
        setIsLoading(false);
        return;
      }

      const result = await splitText({
        sourceText,
        mainParam: delimiter,
        configParams: {
          trimParts: trimParts,
          useRegex: useRegex,
        },
      });

      const convertedRes = window.myResultConverter<string[][]>(result);

      if (convertedRes.status === 'ok') {
        setSplitResults(convertedRes.data);
      } else {
        snackbar.error(convertedRes.error.message);
      }
    } catch (error) {
      console.error(error);
      snackbar.error('❌ Fehler beim Verarbeiten!');
    } finally {
      setIsLoading(false);
    }
  }, [sourceText, useRegex, separator, splitText, setSplitResults, currentWorkerAbort]);

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      BaseService.cleanupWorkers();
    }, 60_000);
    return () => clearInterval(cleanupInterval);
  }, []);

  return (
    <div className={`split-text app-container-column ${visible ? '' : 'hide-page'}`}>
      <ScrollableContainer>
        <section className="app-section flex-1">
          <div className="title">
            <span className="left">{t('removeLines.sourceText')}</span>
            <div className="reset-button">
              <IconRoundedButton
                highlightIcon={true}
                size="18px"
                radius="6px"
                svgIcon={<SvgIconReload size="16" />}
                colorDefault="transparent"
                title="Reset all fields to default"
                onClick={() => setSourceText('')}
              />
            </div>
            <OpenFileButton setFileText={setSourceText} />
          </div>
          <div className="content2 flex-column">
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={t('sourceText.placeholder')}
            />
          </div>
        </section>
        <section className="app-section">
          <div className="title">
            <span className="left">SPLIT OPTIONS</span>
            <span className="right">Configure how the text should be split</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <Checkbox
                  label={t('options.trimLines')}
                  checked={trimLine}
                  onChange={(val) => setPermanentSetting('trimLine', val)}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('options.trimparts')}
                  checked={trimParts}
                  onChange={(val) => setPermanentSetting('trimParts', val)}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('regex.useRegex')}
                  checked={useRegex}
                  onChange={(val) => setRuntimeSetting('useRegex', val)}
                />
              </div>
            </div>

            <div className="row box-write-name">
              <div className="form-add-render">
                <InputText
                  value={separator}
                  setValue={(val) => setRuntimeSetting('separator', val)}
                  placeHolder="Enter split delim or pattern ..."
                  enableClearTextBtn={true}
                  enableLeftIcon={true}
                  leftIcon={<TextIcon size={20} />}
                  required
                />

                <IconRoundedButton
                  highlightIcon={true}
                  size="30px"
                  svgIcon={<SplitSquareHorizontal size={20} />}
                  title="Split text"
                  onClick={handleSplit}
                />
              </div>
            </div>

            <div className="processing-status-container">
              <ProcessingStatus />
            </div>
          </div>
        </section>
        {splitResults.length > 0 && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">SPLIT RESULT</span>
              <span className="right">Split text result</span>
            </div>
            <div className="content flex-column">
              <ResultColumns
                splitResults={splitResults}
                setSplitResults={setSplitResults}
                showLineNumbers={showLineNumbers}
                fontSize={fontSize}
                isDarkMode={isDarkMode}
              />
              <CombineColumns />
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}
