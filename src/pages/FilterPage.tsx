import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, SearchCode } from 'lucide-react';
import InputText from '../components/InputText';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { MatchPreview } from '../components/MatchPreview';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import useSnackbar from '../hooks/useSnackbar';
import './styles/FilterPageStyle.css';

interface FilterPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  visible: boolean;
}

export default function FilterPage({
  sourceText,
  setSourceText,
  visible,
}: FilterPageProps) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const [showResult, setShowResult] = useState(false);
  const [resultText, setResultText] = useState('');
  const [options, setOptions] = useState({
    caseSensitive: true,
    pattern: '',
    splitMatches: false,
    showMatched: false,
  });

  const { filterText } = useBackendProcessor();

  const handleProcessText = useCallback(
    async (action: 'remove' | 'keep') => {
      if (!sourceText || !options.pattern) {
        snackbar.error(t('errors.textAndPatternRequired'));
        return;
      }

      setShowResult(true);
      setResultText('');

      try {
        const result = await filterText({
          sourceText,
          mainParam: options.pattern,
          configParams: {
            caseSensitive: options.caseSensitive,
            filterMode: action,
            splitMatches: action === 'keep' ? options.splitMatches : false,
          },
        });

        const convertedRes = window.myResultConverter<string>(result);

        if (convertedRes.status === 'ok') {
          setResultText(convertedRes.data);
          snackbar.success(t('textFilter.processed'));
        } else {
          throw convertedRes.error;
        }
      } catch (error) {
        window.logger.error('Error filtering text:', error);
        snackbar.error(t('errors.processingError'));
      }
    },
    [sourceText, options, filterText, t]
  );

  return (
    <div className={`filter-text app-container-column ${visible ? '' : 'hide-page'}`}>
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
              placeholder={t('textFilter.sourcePlaceholder')}
            />
          </div>
        </section>

        <section className="app-section">
          <div className="title">
            <span className="left">FILTER OPTIONS</span>
            <span className="right">Configure how the text should be filtered</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <Checkbox
                  label={t('textFilter.options.caseSensitive')}
                  checked={options.caseSensitive}
                  onChange={(val) => setOptions((prev) => ({ ...prev, caseSensitive: val }))}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label={t('textFilter.options.splitMatches')}
                  checked={options.splitMatches}
                  onChange={(val) => setOptions((prev) => ({ ...prev, splitMatches: val }))}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label="Show pattern matches"
                  checked={options.showMatched}
                  onChange={(val) => setOptions((prev) => ({ ...prev, showMatched: val }))}
                />
              </div>
            </div>

            <div className="row box-write-name">
              <div className="form-add-render">
                <InputText
                  value={options.pattern}
                  setValue={(val) => setOptions((prev) => ({ ...prev, pattern: val }))}
                  placeHolder={t('textFilter.patternPlaceholder')}
                  enableClearTextBtn={true}
                  enableLeftIcon={true}
                  leftIcon={<SearchCode size={20} />}
                  required
                />

                <div className="filter-actions">
                  <IconRoundedButton
                    onClick={() => handleProcessText('remove')}
                    title={t('textFilter.modes.remove')}
                    size="30px"
                    svgIcon={<Filter size={20} />}
                    colorDefault="var(--app-color-red)"
                  />
                  <IconRoundedButton
                    onClick={() => handleProcessText('keep')}
                    title={t('textFilter.modes.keep')}
                    size="30px"
                    svgIcon={<Filter size={20} />}
                    colorDefault="var(--app-color-green)"
                  />
                </div>
              </div>
            </div>

            {options.showMatched && options.pattern && sourceText && (
              <MatchPreview
                sourceText={sourceText}
                pattern={options.pattern}
                caseSensitive={options.caseSensitive}
              />
            )}

            <div className="processing-status-container">
              <ProcessingStatus />
            </div>
          </div>
        </section>

        {showResult && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">FILTER RESULT</span>
              <span className="right">Filter text result</span>
            </div>
            <div className="content flex-column">
              <div className="scroll-box">
                <textarea
                  value={resultText}
                  readOnly
                  className="result"
                  placeholder={t('textFilter.resultPlaceholder')}
                />
              </div>
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}