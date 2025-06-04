import { useTranslation } from 'react-i18next';
import './styles/RegexTesterStyle.css';

interface RegexTesterProps {
  useCustomTestText: boolean;
  setUseCustomTestText: (value: boolean) => void;
  testText: string;
  setTestText: (value: string) => void;
  regexMatches: Array<{ text: string; isMatch: boolean }>;
  sourceText: string;
  testRegexPattern: () => void;
  regexTestResult: string[];
  isDarkMode: boolean;
}

export function RegexTester({ 
  useCustomTestText, 
  setUseCustomTestText, 
  testText, 
  setTestText, 
  regexMatches, 
  sourceText, 
  testRegexPattern, 
  regexTestResult, 
  isDarkMode 
}: RegexTesterProps) {
  const { t } = useTranslation();

  return (
    <div className="regex-tester">
      <div className="regex-tester-header">
        <h3>{t('regex.tester.title')}</h3>
        <div className="regex-tester-actions">
          <span className="matches-count">
            {regexTestResult.length > 0 ? t('regex.tester.matchesFound', { count: regexTestResult.length }) : ''}
          </span>
          <button 
            onClick={testRegexPattern} 
            className="test-pattern-btn"
          >
            {t('regex.tester.testPattern')}
          </button>
        </div>
      </div>

      <div className="custom-text-container">
        <div className="custom-text-option">
          <label className="custom-text-label">
            <input 
              type="checkbox" 
              checked={useCustomTestText} 
              onChange={(e) => setUseCustomTestText(e.target.checked)} 
              className="custom-text-checkbox" 
            />
            <span>{t('regex.tester.useCustomText')}</span>
          </label>

          {useCustomTestText && (
            <input
              type="text"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="custom-text-input"
              placeholder="Enter test text for regex pattern..."
            />
          )}
        </div>

        {!useCustomTestText && (
          <div className="preview-container">
            <div className="preview-label">{t('regex.tester.firstLinePreview')}</div>
            <div className="preview-content">
              {regexMatches.length > 0
                ? regexMatches.map((part, idx) => (
                    <span 
                      key={idx} 
                      className={part.isMatch ? 'match-highlight' : 'match-text'}
                    >
                      {part.text || <em className="empty-text">{t('regex.tester.empty')}</em>}
                    </span>
                  ))
                : (sourceText += '\n').substring(0, sourceText.indexOf('\n')) || '(no text available)'}
            </div>
          </div>
        )}
      </div>

      {regexTestResult.length > 0 && (
        <div className="result-container">
          <div className="result-label">{t('regex.tester.splitResult')}</div>
          <div className="result-content">
            {regexTestResult.map((part, index) => (
              <span key={index} className="result-part">
                {part || <em className="empty-text">{t('regex.tester.empty')}</em>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}