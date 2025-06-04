import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownUp } from 'lucide-react';
import IconRoundedButton from '../components/IconRoundedButton';
import { SvgIconReload } from '../components/SvgIcons';
import Checkbox from '../components/Checkbox';
import CustomSelect from '../components/CustomSelect';
import CopyButton from '../components/CopyButton';
import ScrollableContainer from '../components/ScrollableContainer';
import OpenFileButton from '../components/OpenFileButton';
import natsort from '../utils/sortNatural';
import useSnackbar from '../hooks/useSnackbar';
import './styles/SortPageStyle.css';

interface SortPageProps {
  sourceText: string;
  setSourceText: (text: string) => void;
  visible?: boolean;
}

type SortMethod = 'alphabetical' | 'alphabeticalReverse' | 'natural' | 'naturalReverse' | 'lengthAsc' | 'lengthDesc' | 'random';

const sortItems: Item<SortMethod>[] = [
  { label: 'Alphabetical (A to Z)', value: 'alphabetical', index: 0 },
  { label: 'Alphabetical (Z to A)', value: 'alphabeticalReverse', index: 1 },
  { label: 'Natural Sort', value: 'natural', index: 2 },
  { label: 'Natural Sort Reverse', value: 'naturalReverse', index: 3 },
  { label: 'Line Length (Shortest First)', value: 'lengthAsc', index: 4 },
  { label: 'Line Length (Longest First)', value: 'lengthDesc', index: 5 },
  { label: 'Random/Shuffle', value: 'random', index: 6 },
];

export default function SortPage({ sourceText, setSourceText, visible }: SortPageProps) {
  const { t } = useTranslation();
  const [sortMethod, setSortMethod] = useState<SortMethod>('alphabetical');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [resultText, setResultText] = useState('');
  const [showResult, setShowResult] = useState(false);
  const snackbar = useSnackbar();

  const handleSort = useCallback(() => {
    if (!sourceText.trim()) {
      snackbar.warning('Please enter some text to sort');
      return;
    }

    const lines = sourceText.split('\n').filter(line => line.trim() !== '');
    let sortedLines: string[];

    try {
      switch (sortMethod) {
        case 'alphabetical':
          sortedLines = lines.sort((a, b) => 
            caseSensitive ? a.localeCompare(b) : a.toLowerCase().localeCompare(b.toLowerCase())
          );
          break;

        case 'alphabeticalReverse':
          sortedLines = lines.sort((a, b) => 
            caseSensitive ? b.localeCompare(a) : b.toLowerCase().localeCompare(a.toLowerCase())
          );
          break;

        case 'natural':
          sortedLines = lines.sort(natsort({ insensitive: !caseSensitive }));
          break;

        case 'naturalReverse':
          sortedLines = lines.sort(natsort({ insensitive: !caseSensitive, desc: true }));
          break;

        case 'lengthAsc':
          sortedLines = lines.sort((a, b) => a.length - b.length);
          break;

        case 'lengthDesc':
          sortedLines = lines.sort((a, b) => b.length - a.length);
          break;

        case 'random':
          sortedLines = lines.sort(() => Math.random() - 0.5);
          break;

        default:
          sortedLines = lines;
      }

      setResultText(sortedLines.join('\n'));
      setShowResult(true);
      snackbar.success('Text sorted successfully');
    } catch (error) {
      snackbar.error('Error sorting text');
      console.error('Sorting error:', error);
    }
  }, [sourceText, sortMethod, caseSensitive]);

  return (
    <div className={`sort-text app-container-column ${visible ? '' : 'hide-page'}`}>
      <ScrollableContainer>
        <section className="app-section flex-1">
          <div className="title">
            <span className="left">{t('sourceText.label')}</span>
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
              placeholder={t('sourceText.placeholder')}
            />
          </div>
        </section>

        <section className="app-section">
          <div className="title">
            <span className="left">SORT OPTIONS</span>
            <span className="right">Configure how the text should be sorted</span>
          </div>
          <div className="content flex-column">
            <div className="input-options-container">
              <div className="input-box">
                <CustomSelect
                  label="Sort Method"
                  items={sortItems}
                  value={sortMethod}
                  onChange={(value) => setSortMethod(value)}
                />
              </div>

              <div className="input-box">
                <Checkbox
                  label="Case Sensitive"
                  checked={caseSensitive}
                  onChange={setCaseSensitive}
                />
              </div>
            </div>

            <div className="sort-actions">
              <button onClick={handleSort} className="sort-button">
                <ArrowDownUp size={20} />
                <span>Sort Text</span>
              </button>
            </div>
          </div>
        </section>

        {showResult && (
          <section className="app-section flex-1">
            <div className="title">
              <span className="left">SORT RESULT</span>
            </div>
            <div className="content flex-column">
              <div className="result-header">
                <CopyButton toCopy={resultText} />
              </div>
              <div className="scroll-box">
                <textarea
                  value={resultText}
                  readOnly
                  className="result"
                  placeholder="Sorted text will appear here..."
                />
              </div>
            </div>
          </section>
        )}
      </ScrollableContainer>
    </div>
  );
}
