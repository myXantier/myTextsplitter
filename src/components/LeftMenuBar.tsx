import React, { useRef, useState, useCallback } from 'react';
import { Combine } from 'lucide-react';
import IconRoundedButton from './IconRoundedButton';
import { shadeColor } from '../utils/helper';
import { MyAppLogo, SvgIconMenuClosed, SvgIconMenuOpened } from './SvgIcons';
import { pages, PageKey } from '../config/pages';
import { useSettings, useRuntimeSetting } from '../hooks/useSettings';
import { useCombineHistoryStore } from '../hooks/useCombineHistoryStore';
import PageList from './PageList';
import './styles/LeftMenuBarStyle.css';

interface LeftMenuBarProps {
  setPageName: React.Dispatch<React.SetStateAction<PageKey>>;
}

export default function LeftMenuBar({ setPageName }: LeftMenuBarProps) {
  const processingMode = useRuntimeSetting('processingMode');
  const combineSeparator = useRuntimeSetting('combineSeparator');
  const ui = useSettings((state) => state.ui);
  const theme = useSettings((state) => state.theme);
  
  const containerStyle: React.CSSProperties = {
    '--width-closed': ui.leftMenuWidthClosed || '56px',
    '--icon-left-padding': ui.leftMenuIconLeftPadding || '13px',
    '--text-left-padding': ui.leftMenuTextLeftPadding || '16px',
  } as React.CSSProperties;

  // useRef
  const menu = useRef<HTMLElement>(null);
  const logoImg = useRef<SVGSVGElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [isOpened, setIsOpened] = useState<boolean>(false);
  const [showCombineInterface, setShowCombineInterface] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<PageKey>(ui.appDefaultPage);
  
  const [splitResults, setSplitResults] = useState<string[][]>([]);

  const combinedText = useCombineHistoryStore(state => state.getText());
  const usedColumns = useCombineHistoryStore(state => state.getColumns());
  const setCombineState = useCombineHistoryStore(state => state.setCombineState);

  // Toggle Open/Close menu bar
  function toggleMenu() {
    if (isOpened) {
      if (menu.current) menu.current.style.width = ui.leftMenuWidthClosed || '56px';
      if (logoImg.current)
        logoImg.current.style.cssText = `
                opacity: 0;
                left: -${ui.leftMenuWidthOpened || '240px'};
                transition: 0.75s;
            `;
      setIsOpened(false);
      setShowCombineInterface(false);
    } else {
      if (menu.current) menu.current.style.width = '240px';
      if (logoImg.current)
        logoImg.current.style.cssText = `
                opacity: 1;
                left: 0;
                transition: 1.2s;
            `;
      setIsOpened(true);
    }
  }

  // Toggle between normal menu and combine interface
  const toggleCombineInterface = useCallback(() => {
    console.log("Toggle combine interface called. Split results length:", splitResults.length);
    if (!isOpened) {
      toggleMenu(); // Expand the menu first if it's closed
    }
    if (splitResults.length > 0) {
      setShowCombineInterface(!showCombineInterface);
    } else {
      setShowCombineInterface(false);
    }
  }, [isOpened, toggleMenu, splitResults, showCombineInterface]);

  // Change Page
  function changePage(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) {
    const target = event.currentTarget;
    const page = target.getAttribute('page-name') as PageKey;
    const isActivated = target.getAttribute('is-ctivated') === 'true';

    // Remove selection
    if (menu.current && isActivated) {
      const btns = menu.current.querySelectorAll('a');
      btns.forEach((btn) => {
        btn.classList.remove('menu-active');
      });
    }

    // Select clicked btn
    if (isActivated) {
      target.setAttribute('class', 'menu-active');
    }

    // Close menu if opened
    if (isOpened && !showCombineInterface) toggleMenu();

    // Close combine interface if open
    if (showCombineInterface) {
      setShowCombineInterface(false);
    }

    // Update current page
    if (page) {
      setCurrentPage(page);
      setPageName(page);
    }
  }

  const appendColumnTauri = useCallback(
    async (columnIndex: number) => {
      if (!splitResults[columnIndex]) return;

      try {

        if (processingMode === 'fallback') {
          appendColumnFrontend([...usedColumns, { index: columnIndex, separator: combineSeparator }]);
          return;
        }

        const { invokeUNSAFE } = await import('../services/tauriInvoke');

        const textToAdd = splitResults[columnIndex].join('\n');
        const newText = await invokeUNSAFE<string>('connect_texts', {
          text1: combinedText,
          text2: textToAdd,
          separator: combinedText ? combineSeparator : '',
        });

        console.log("newText:", newText);

        if (newText && newText !== combinedText) {
          setCombineState({
            text: newText,
            columns: [...usedColumns, { index: columnIndex, separator: combineSeparator }],
          });
        }
      } catch (error) {
        window.logger.error('Error combining texts:', error);
      }
    },
    [splitResults, combineSeparator, combinedText, usedColumns, setCombineState]
  );

  const appendColumnFrontend = useCallback(
    (newUsedColumns: ColumnSeparator[]) => {
      const newCombinedLines = splitResults[0].map((_, lineIndex) => {
        const parts = newUsedColumns.map((col, i) => {
          const value = splitResults[col.index]?.[lineIndex] ?? '';
          return i === 0 ? value : `${col.separator}${value}`;
        });
        return parts.join('');
      });

      setCombineState({
        text: newCombinedLines.join('\n'),
        columns: newUsedColumns,
      });
    },
    [splitResults, setCombineState]
  );

  return (
    <div className="app-layout">
      <aside ref={menu} className="left-menu-bar" style={containerStyle} data-tauri-drag-region>
        <div className="toogle-menu">
          <IconRoundedButton
            onClick={toggleMenu}
            title={isOpened ? 'Close menu' : 'Open menu'}
            isActive={isOpened}
            size="52px"
            svgIcon={isOpened ? <SvgIconMenuOpened size={ui.leftMenuToggleIconSize} /> : <SvgIconMenuClosed size={ui.leftMenuToggleIconSize} />}
            colorDefault={theme.colors.background}
            colorHover={theme.colors.buttonBgHover}
            colorPressed={theme.colors.buttonBgPressed}
            colorActive={shadeColor(0.2, theme.colors.accentColor)}
            highlightIcon={true}
            radius="8px"
          />
          <div data-tauri-drag-region>
            <MyAppLogo data-tauri-drag-region ref={logoImg} color={theme.colors.color} height={'32'} />
          </div>
        </div>

        <nav className="nav-menus">
          <div className="div-line"></div>

          {/* Show either normal navigation or combine interface */}
          {splitResults.length > 0 && showCombineInterface ? (
            <div className="combine-interface">
              <div className="combine-header">
                <h3>Column Selector</h3>
                <button 
                  onClick={toggleCombineInterface} 
                  className="close-combine-btn"
                >
                  ← Back
                </button>
              </div>
              <div className="combine-content">
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
          ) : (
            <>
              <ul className="flex-1">
                {pages
                  .filter((_, v) => v.showInMenu ?? false)
                  .map((item) => (
                    <li key={item[0]}>
                      <a
                        className={currentPage === item[0] ? 'menu-active' : ''}
                        is-ctivated="true"
                        href="#"
                        onClick={changePage}
                        title={item[1].title}
                        page-name={item[0]}
                      >
                        {item[1].icon}
                        <span>{item[1].title}</span>
                      </a>
                    </li>
                  ))}
              </ul>

              <ul className="bottom-menus">
                {/* Combine icon - only shown when splitResults has data */}
                {splitResults.length > 0 && (
                  <li>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        toggleCombineInterface();
                      }}
                      title="Combine Columns"
                      className="combine-icon-link"
                    >
                      <Combine size={ui.leftMenuButtonsIconSize} />
                      <span>Combine Columns</span>
                    </a>
                  </li>
                )}

                {pages
                  .filter((_, v) => v.bottomMenu ?? false)
                  .map((item) => (
                    <li key={item[0]}>
                      <a
                        className={currentPage === item[0] ? 'menu-active' : ''}
                        is-ctivated="true"
                        href="#"
                        onClick={changePage}
                        title={item[1].title}
                        page-name={item[0]}
                      >
                        {item[1].icon}
                        <span>{item[1].title}</span>
                      </a>
                    </li>
                  ))}
              </ul>
            </>
          )}

          <div className="div-line"></div>
        </nav>
      </aside>

      <div className="content-area" ref={contentRef}>
        <PageList 
          setPage={currentPage} 
          splitResults={splitResults} 
          setSplitResults={setSplitResults}
        />
      </div>
    </div>
  );
}
