import React, { useState, useCallback } from 'react';
import { Trash2, GripVertical, X } from 'lucide-react';
import { VirtualizedTextArea } from './VirtualizedTextArea';
import CopyButton from '../../components/CopyButton';
import { useTranslation } from 'react-i18next';
import './styles/ResultCombineStyle.css';

interface ResultColumnsProps {
  splitResults: string[][];
  setSplitResults: React.Dispatch<React.SetStateAction<string[][]>>;
  showLineNumbers: boolean;
  fontSize: fontSize;
  isDarkMode: boolean;
}

export function ResultColumns({
  splitResults,
  setSplitResults,
  showLineNumbers,
  fontSize,
  isDarkMode,
}: ResultColumnsProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [modalText, setModalText] = useState<string>('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const { t } = useTranslation();

  const openModal = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setModalText(splitResults[index].join('\n'));
    },
    [splitResults]
  );

  const closeModal = useCallback((save: boolean) => {
    if (editingIndex === null) return;
    if (save)
      setSplitResults((prev) => prev.map((col, i) => (i === editingIndex ? modalText.split('\n') : col)));
    setEditingIndex(null);
  }, [editingIndex, modalText, setSplitResults]);

  const handleDeleteColumn = useCallback(
    (index: number) => {
      setSplitResults((prev) => prev.filter((_, i) => i !== index));
    },
    [setSplitResults]
  );

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
    setDraggedIndex(index);
    setDropIndex(null);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (draggedIndex !== null && draggedIndex !== index) {
        setDropIndex(index);
      }
    },
    [draggedIndex]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (draggedIndex === dropIndex || draggedIndex === null) return;

      setSplitResults((prev) => {
        const newResults = [...prev];
        const [moved] = newResults.splice(draggedIndex, 1);
        newResults.splice(dropIndex, 0, moved);
        return newResults;
      });
    },
    [setSplitResults]
  );

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropIndex(null);
  };

  return (<>
    <div className="result-columns">
      {splitResults.map((column, index) => (
        <div key={index}>
          {dropIndex === index && <div className="drop-indicator" />}
          <div
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            className={`result-column ${draggedIndex === index ? 'dragging' : ''}`}
          >
            <div className="result-header">
              <div className="left">
                <GripVertical size={16} />
                <h2>Part {index + 1}</h2>
                <button className={`${fontSize}`} onClick={() => openModal(index)}>✏ Edit</button>
              </div>
              <div className="right">
                <CopyButton toCopy={column.join('\n')} />
                <button onClick={() => handleDeleteColumn(index)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="result-textarea-wrapper">
              {showLineNumbers && column.length > 0 && (
                <div className="line-numbers">
                  {Array.from({ length: column.length }).map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
              )}

              <VirtualizedTextArea
                lines={column}
                readOnly
                fontSize={fontSize}
                isDarkMode={isDarkMode}
                showLineNumbers={showLineNumbers}
                className={showLineNumbers ? 'pl-8' : ''}
              />
            </div>
          </div>
        </div>
      ))}
      {dropIndex === splitResults.length && <div className="drop-indicator" />}
    </div>
    {editingIndex !== null && (
      <div className="modal-overlay">
        <div className="modal-content">
          <div className="modal-header">
            <h2>
              {t('Edit Column')} {editingIndex + 1}
            </h2>
            <button onClick={() => closeModal(false)}>
              <X size={20} />
            </button>
          </div>
          <textarea value={modalText} onChange={(e) => setModalText(e.target.value)} className="modal-textarea" />
          <div className="modal-footer">
            <button onClick={() => closeModal(true)} className="modal-save-btn">
              Save
            </button>
          </div>
        </div>
      </div>
    )}
  </>);
}
