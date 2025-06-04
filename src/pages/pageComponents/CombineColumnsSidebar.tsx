import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import IconRoundedButton from '../../components/IconRoundedButton';
import './styles/CombineColumnsSidebarStyle.css';

interface SidebarProps {
  splitResults: string[][];
  usedColumns: ColumnSeparator[];
  appendColumnTauri: (columnIndex: number) => void;
}

export default function CombineColumnsSidebar({ splitResults, usedColumns, appendColumnTauri }: SidebarProps) {
  const [showSidebar, setShowSidebar] = useState(false);

  return (
    <>
      <IconRoundedButton
        onClick={() => setShowSidebar(!showSidebar)}
        title={showSidebar ? 'Hide column selector' : 'Show column selector'}
        size="30px"
        svgIcon={showSidebar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        colorDefault="var(--background)"
        colorHover="var(--button-bg-hover)"
        colorPressed="var(--button-bg-pressed)"
        highlightIcon={true}
        radius="8px"
        className="sidebar-toggle"
      />

      <div className={`sidebar-container ${showSidebar ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <h3>Column Selector</h3>
          <IconRoundedButton
            onClick={() => setShowSidebar(false)}
            title="Close"
            size="24px"
            svgIcon={<ChevronLeft size={16} />}
            colorDefault="var(--background)"
            colorHover="var(--button-bg-hover)"
            colorPressed="var(--button-bg-pressed)"
            highlightIcon={true}
            radius="6px"
          />
        </div>

        <div className="sidebar-content">
          <div className="column-buttons">
            {splitResults.map((_, index) => (
              <button
                key={index}
                onClick={() => appendColumnTauri(index)}
                className={`column-button ${usedColumns.some((col) => col.index === index) ? 'column-button-used' : ''}`}
                disabled={usedColumns.some((col) => col.index === index)}
              >
                <span className="column-button-text">Part {index + 1}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {showSidebar && <div className="sidebar-overlay" onClick={() => setShowSidebar(false)} />}
    </>
  );
}