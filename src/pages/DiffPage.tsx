import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import { ProcessingStatus } from './pageComponents/ProcessingStatus';
import { useBackendProcessor } from '../hooks/useBackendProcessor';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import CopyButton from '../components/CopyButton';
import { fontSizeToIconSize } from '../utils/helper';
import useSnackbar from '../hooks/useSnackbar';
import { isSuperseded, processingErrorMessage, unwrapResult } from '../services/ProcessingError';
import { usePermanentSetting } from '../hooks/useSettings';
import { getWordDiffs } from '../utils/diff/wordDiffLegacy';
import { toLegacyDiffResults } from '../utils/diff/legacy';
import type { DiffDocument } from '../utils/diff/types';
import './styles/DiffPageStyle.css';

interface DiffPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  visible: boolean;
}

type DiffViewType = 'unified' | 'split';

export default function DiffPage({
  sourceText,
  setSourceText,
  visible,
}: DiffPageProps) {
  const { t } = useTranslation();
  const snackbar = useSnackbar();
  const [newText, setNewText] = useState('');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [diffDocument, setDiffDocument] = useState<DiffDocument | null>(null);
  // Transitional (Paket 7 B1): the views still render the former entry list; moves appear as removed + added
  const diffResults = useMemo(() => (diffDocument ? toLegacyDiffResults(diffDocument) : []), [diffDocument]);
  const [diffViewType, setDiffViewType] = useState<DiffViewType>('unified');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [showWordDiff, setShowWordDiff] = useState(true);

  const { diffText } = useBackendProcessor();
  const fontSize = usePermanentSetting('fontSize');

  // Function to get class name based on diff type
  const getDiffTypeClass = (type: string) => {
    switch (type) {
      case 'added': return 'diff-added';
      case 'removed': return 'diff-removed';
      case 'moved': return 'diff-moved';
      case 'changed': return 'diff-changed';
      case 'unchanged': default: return '';
    }
  };

  // Get icon based on diff type
  const getDiffTypeIcon = (type: string) => {
    switch (type) {
      case 'added': return '+';
      case 'removed': return '-';
      case 'moved': return '↷';
      case 'changed': return '~';
      default: return ' ';
    }
  };

  const handleDiffText = useCallback(async () => {
    // One side may be empty (everything added or removed); comparing two empty texts shows nothing
    if (!sourceText && !newText) {
      snackbar.error(t('errors.textRequired'));
      return;
    }

    try {
      const result = await diffText({
        sourceText,
        mainParam: newText,
        configParams: {
          caseSensitive: true,
          ignoreWhitespace,
        },
      });

      // DiffService delivers the same validated DiffDocument in backend and JS mode; on failure the previous diff stays
      setDiffDocument(unwrapResult(window.myResultConverter(result, 'Diff')));
      snackbar.success(t('textDiff.processed'));
    } catch (error) {
      // A superseded job was replaced by a newer click: nothing to report
      if (!isSuperseded(error)) snackbar.error(processingErrorMessage(error, t));
    }
  }, [sourceText, newText, ignoreWhitespace, diffText, t]);

  // Render word-level diff content for a single line
  const renderWordDiff = (line1: string, line2: string | null) => {
    if (!showWordDiff || !line2) return <span className="diff-line-content">{line1}</span>;
    
    const wordDiffs = getWordDiffs(line1, line2);
    
    return (
      <span className="diff-line-content">
        {wordDiffs.map((word, i) => (
          <span key={i} className={`word-diff ${getDiffTypeClass(word.type)}`}>
            {word.text}
          </span>
        ))}
      </span>
    );
  };

  // Prepare paired diff results for split view
  const pairedDiffResults = (() => {
    if (!diffResults.length) return [];
    
    // Group by type
    const groups = {
      removed: diffResults.filter(r => r.type === 'removed'),
      added: diffResults.filter(r => r.type === 'added'),
      unchanged: diffResults.filter(r => r.type === 'unchanged') 
    };
    
    const pairs: Array<{ left: DiffResult | null, right: DiffResult | null }> = [];
    
    // First add all unchanged lines
    groups.unchanged.forEach(line => pairs.push({ left: line, right: line }));
    
    // Then process removed and added lines, attempting to pair them
    const processedRemoved = new Set<number>();
    const processedAdded = new Set<number>();
    
    // Match lines with similar content
    groups.removed.forEach((removedLine, index) => {
      const matchingAdded = groups.added.find((addedLine, idx) => 
        !processedAdded.has(idx) && 
        getWordDiffs(removedLine.text, addedLine.text).some(w => w.type !== 'unchanged')
      );
      
      if (matchingAdded) {
        pairs.push({ left: removedLine, right: matchingAdded });
        processedRemoved.add(index);
        processedAdded.add(groups.added.indexOf(matchingAdded));
      }
    });
    
    // Add remaining unmatched lines
    groups.removed.forEach((removedLine, index) => {
      if (!processedRemoved.has(index)) {
        pairs.push({ left: removedLine, right: null });
      }
    });
    
    groups.added.forEach((addedLine, index) => {
      if (!processedAdded.has(index)) {
        pairs.push({ left: null, right: addedLine });
      }
    });
    
    // Order of the diff result (line numbers mix old and new positions and are no sort key)
    const position = new Map(diffResults.map((entry, index) => [entry, index]));
    const at = (pair: { left: DiffResult | null; right: DiffResult | null }) =>
      Math.min(pair.left ? position.get(pair.left)! : Infinity, pair.right ? position.get(pair.right)! : Infinity);
    return pairs.sort((a, b) => at(a) - at(b));
  })();

  const renderUnifiedDiffView = () => {
    return (
      <div className="unified-diff-view">
        {diffResults.map((result, index) => (
          <div
            key={index}
            className={`diff-line ${getDiffTypeClass(result.type)}`}
          >
            {showLineNumbers && (
              <span className="diff-line-number">{result.lineNumber}</span>
            )}
            <span className="diff-line-marker">{getDiffTypeIcon(result.type)}</span>
            
            {result.text ? (
              showWordDiff && result.type !== 'unchanged' ? (
                renderWordDiff(
                  result.text,
                  result.type === 'removed' 
                    ? diffResults.find(r => r.type === 'added' && 
                        getWordDiffs(r.text, result.text).some(w => w.type !== 'unchanged'))?.text || null
                    : null
                )
              ) : (
                <span className="diff-line-content">{result.text}</span>
              )
            ) : (
              <em className="diff-line-content empty-line">{t('textDiff.emptyLine')}</em>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderSplitDiffView = () => {
    return (
      <div className="split-diff-view">
        <div className="split-diff-original">
          <div className="split-diff-header">
            <h3>{t('textDiff.oldText')}</h3>
          </div>
          <div className="split-diff-content">
            {pairedDiffResults.map((pair, index) => (
              <div key={`left-${index}`} className={`diff-line ${pair.left ? getDiffTypeClass(pair.left.type) : 'empty-slot'}`}>
                {showLineNumbers && pair.left && (
                  <span className="diff-line-number">
                    {pair.left.lineNumber}
                  </span>
                )}
                
                {pair.left ? (
                  <>
                    <span className="diff-line-marker">
                      {getDiffTypeIcon(pair.left.type)}
                    </span>
                    
                    {pair.left.text ? (
                      showWordDiff && pair.left.type !== 'unchanged' ? (
                        renderWordDiff(
                          pair.left.text,
                          pair.right?.text || null
                        )
                      ) : (
                        <span className="diff-line-content">{pair.left.text}</span>
                      )
                    ) : (
                      <em className="diff-line-content empty-line">{t('textDiff.emptyLine')}</em>
                    )}
                  </>
                ) : (
                  <span className="diff-line-placeholder"></span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="split-diff-new">
          <div className="split-diff-header">
            <h3>{t('textDiff.newText')}</h3>
          </div>
          <div className="split-diff-content">
            {pairedDiffResults.map((pair, index) => (
              <div key={`right-${index}`} className={`diff-line ${pair.right ? getDiffTypeClass(pair.right.type) : 'empty-slot'}`}>
                {showLineNumbers && pair.right && (
                  <span className="diff-line-number">
                    {pair.right.lineNumber}
                  </span>
                )}
                
                {pair.right ? (
                  <>
                    <span className="diff-line-marker">
                      {getDiffTypeIcon(pair.right.type)}
                    </span>
                    
                    {pair.right.text ? (
                      showWordDiff && pair.right.type !== 'unchanged' ? (
                        renderWordDiff(
                          pair.right.text,
                          pair.left?.text || null
                        )
                      ) : (
                        <span className="diff-line-content">{pair.right.text}</span>
                      )
                    ) : (
                      <em className="diff-line-content empty-line">{t('textDiff.emptyLine')}</em>
                    )}
                  </>
                ) : (
                  <span className="diff-line-placeholder"></span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`diff-text app-container-column ${visible ? '' : 'hide-page'}`}>
      <ScrollableContainer>
        <div className="diff-columns">
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">{t('textDiff.oldText')}</span>
              <div className="reset-button">
                <IconRoundedButton
                  highlightIcon={true}
                  size="18px"
                  radius="6px"
                  svgIcon={<SvgIconReload size="16" />}
                  colorDefault="transparent"
                  title="Reset text"
                  onClick={() => setSourceText('')}
                />
              </div>
              <OpenFileButton setFileText={setSourceText} />
            </div>
            <div className="content2 flex-column">
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder={t('textDiff.oldTextPlaceholder')}
              />
            </div>
          </section>

          <section className="app-section flex-1">
            <div className="title">
              <span className="left">{t('textDiff.newText')}</span>
              <div className="reset-button">
                <IconRoundedButton
                  highlightIcon={true}
                  size="18px"
                  radius="6px"
                  svgIcon={<SvgIconReload size="16" />}
                  colorDefault="transparent"
                  title="Reset text"
                  onClick={() => setNewText('')}
                />
              </div>
              <OpenFileButton setFileText={setNewText} />
            </div>
            <div className="content2 flex-column">
              <textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder={t('textDiff.newTextPlaceholder')}
              />
            </div>
          </section>
        </div>

        <section className="app-section">
          <div className="title">
            <span className="left">DIFF OPTIONS</span>
            <span className="right">Configure how the text should be compared</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <Checkbox
                  label={t('textDiff.options.trimWhitespace')}
                  checked={ignoreWhitespace}
                  onChange={setIgnoreWhitespace}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label="Show Line Numbers"
                  checked={showLineNumbers}
                  onChange={setShowLineNumbers}
                />
              </div>
              
              <div className="input-box">
                <Checkbox
                  label="Word-level Highlighting"
                  checked={showWordDiff}
                  onChange={setShowWordDiff}
                />
              </div>
              
              <div className="input-box view-type-selector">
                <span className="view-type-label">View Type:</span>
                <div className="view-type-options">
                  <button 
                    className={`view-option ${diffViewType === 'unified' ? 'active' : ''}`}
                    onClick={() => setDiffViewType('unified')}
                  >
                    Unified
                  </button>
                  <button 
                    className={`view-option ${diffViewType === 'split' ? 'active' : ''}`}
                    onClick={() => setDiffViewType('split')}
                  >
                    Split
                  </button>
                </div>
              </div>

              <div className="input-box">
                <button onClick={handleDiffText} className="diff-button">
                  <ArrowRight size={fontSizeToIconSize[fontSize]} />
                  <span>{t('textDiff.process')}</span>
                </button>
              </div>
            </div>

            <div className="processing-status-container">
              <ProcessingStatus />
            </div>
          </div>
        </section>

        {diffResults.length > 0 && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">{t('textDiff.result')}</span>
              <div className="title-actions">
                <CopyButton toCopy={diffResults.map(r => `${getDiffTypeIcon(r.type)} ${r.text}`).join('\n')} />
                {diffDocument && (
                  <span className="diff-stats">
                    {diffDocument.stats.added} added, {diffDocument.stats.removed} removed
                    {diffDocument.stats.moved > 0 && `, ${diffDocument.stats.moved} moved (shown as - / +)`}
                  </span>
                )}
              </div>
            </div>
            <div className="content flex-column">
              <div className="diff-result-container">
                {diffViewType === 'unified' ? renderUnifiedDiffView() : renderSplitDiffView()}
              </div>
              
              <div className="diff-legend">
                <div className="legend-item">
                  <span className="legend-marker added">+</span>
                  <span>Added</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker removed">-</span>
                  <span>Removed</span>
                </div>
                {showWordDiff && (
                  <div className="legend-item">
                    <span className="legend-marker changed">~</span>
                    <span>Changed</span>
                  </div>
                )}
                <div className="legend-item">
                  <span className="legend-marker moved">↷</span>
                  <span>Moved</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}