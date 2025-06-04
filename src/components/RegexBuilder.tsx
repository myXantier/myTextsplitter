import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PackagePlus, Minus, Check, X, RefreshCw, Save, AlignJustify, Hash, ALargeSmall, Space } from 'lucide-react';
import './styles/RegexBuilderStyle.css';

interface RegexBuilderProps {
  pattern: string;
  onPatternChange: (pattern: string) => void;
  onSavePattern: (pattern: string) => void;
  isDarkMode: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

interface PatternBlock {
  type: 'text' | 'any' | 'digit' | 'word' | 'space' | 'custom';
  value: string;
  quantifier: '' | '?' | '*' | '+' | '{n}' | '{n,}' | '{n,m}';
  quantifierValues: { min?: number; max?: number };
}

export function RegexBuilder({ pattern, onPatternChange, onSavePattern, isDarkMode, isExpanded = false, onToggleExpand }: RegexBuilderProps) {
  const { t } = useTranslation();
  const [blocks, setBlocks] = useState<PatternBlock[]>([]);
  const [showPreview, setShowPreview] = useState(true);

  // Calculate the complete pattern based on all blocks
  const regexPattern = useMemo(() => {
    return blocks.map(block => block.value).join('');
  }, [blocks]);

  // Block type definitions
  const blockTypes = [
    { type: 'text', icon: AlignJustify, label: t('regex.builder.text') },
    { type: 'digit', icon: Hash, label: t('regex.builder.digit') },
    { type: 'word', icon: ALargeSmall, label: t('regex.builder.word') },
    { type: 'space', icon: Space, label: t('regex.builder.space') },
    { type: 'custom', icon: PackagePlus, label: t('regex.builder.custom') },
  ];

  // Quantifier options
  const quantifiers = [
    { value: '', label: t('regex.builder.exactly') },
    { value: '?', label: t('regex.builder.optional') },
    { value: '*', label: t('regex.builder.zeroOrMore') },
    { value: '+', label: t('regex.builder.oneOrMore') },
    { value: '{n}', label: t('regex.builder.exactlyN') },
    { value: '{n,}', label: t('regex.builder.nOrMore') },
    { value: '{n,m}', label: t('regex.builder.between') },
  ];

  // Helper function to get the pattern string for a given type
  const getPatternForType = (type: string): string => {
    switch (type) {
      case 'digit':
        return '\\d';
      case 'word':
        return '\\w';
      case 'space':
        return '\\s';
      case 'any':
        return '.';
      default:
        return '';
    }
  };

  // Build the complete regex pattern from all blocks
  const buildPattern = useCallback(() => {
    let result = '';
    blocks.forEach((block) => {
      let part = block.type === 'text' || block.type === 'custom' ? block.value : getPatternForType(block.type);

      if (block.quantifier) {
        if (['?', '*', '+'].includes(block.quantifier)) {
          part += block.quantifier;
        } else {
          const { min, max } = block.quantifierValues;
          if (block.quantifier === '{n}' && min !== undefined) {
            part += `{${min}}`;
          } else if (block.quantifier === '{n,}' && min !== undefined) {
            part += `{${min},}`;
          } else if (block.quantifier === '{n,m}' && min !== undefined && max !== undefined) {
            part += `{${min},${max}}`;
          }
        }
      }
      result += part;
    });
    return result;
  }, [blocks]);

  // Add a new pattern block
  const addBlock = (type: PatternBlock['type']) => {
    setBlocks((prev) => [
      ...prev,
      {
        type,
        value: type === 'text' || type === 'custom' ? '' : getPatternForType(type),
        quantifier: '',
        quantifierValues: {},
      },
    ]);
  };

  // Update an existing block
  const updateBlock = (index: number, updates: Partial<PatternBlock>) => {
    setBlocks((prev) => prev.map((block, i) => {
      if (i === index) {
        const updatedBlock = { ...block, ...updates };
        // Update the value if type changes
        if (updates.type && updates.type !== block.type) {
          updatedBlock.value = 
            updates.type === 'text' || updates.type === 'custom' 
              ? '' 
              : getPatternForType(updates.type);
        }
        return updatedBlock;
      }
      return block;
    }));
  };

  // Remove a block
  const removeBlock = (index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  };

  // Apply the built pattern to the parent component
  const applyPattern = () => {
    const newPattern = buildPattern();
    onPatternChange(newPattern);
  };

  return (
    <div className="regex-builder">
      <div className="regex-builder-header">
        <div className="regex-builder-header-title">
          <h3>{t('regex.builder.title')}</h3>
          <button 
            onClick={onToggleExpand} 
            className="toggle-expand-btn" 
            title={isExpanded ? t('regex.builder.hidePreview') : t('regex.builder.showPreview')}
          >
            <RefreshCw size={16} className={isExpanded ? 'rotate' : ''} />
          </button>
        </div>
        <div className="regex-builder-header-actions">
          <button 
            onClick={() => onSavePattern(buildPattern())} 
            className="save-pattern-btn" 
            title={t('regex.builder.savePattern')}
          >
            <Save size={16} />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="regex-builder-content">
          {/* Block Type Buttons */}
          <div className="block-type-buttons">
            {blockTypes.map(({ type, icon: Icon, label }) => (
              <button 
                key={type} 
                onClick={() => addBlock(type as PatternBlock['type'])} 
                className="block-type-btn"
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Pattern Blocks */}
          <div className="pattern-blocks">
            {blocks.map((block, index) => (
              <div key={index} className="pattern-block">
                {/* Block Type Icon */}
                <div className="block-type-icon">
                  {(() => {
                    const Icon = blockTypes.find((t) => t.type === block.type)?.icon;
                    return Icon ? <Icon size={16} /> : null;
                  })()}
                </div>

                {/* Block Value Input */}
                {(block.type === 'text' || block.type === 'custom') && (
                  <input
                    type="text"
                    value={block.value}
                    onChange={(e) => updateBlock(index, { value: e.target.value })}
                    className="block-value-input"
                    placeholder={t('regex.builder.enterValue')}
                  />
                )}

                {/* Quantifier Selection */}
                <select
                  value={block.quantifier}
                  onChange={(e) =>
                    updateBlock(index, {
                      quantifier: e.target.value as PatternBlock['quantifier'],
                    })
                  }
                  className="quantifier-select"
                >
                  {quantifiers.map((q) => (
                    <option key={q.value} value={q.value}>
                      {q.label}
                    </option>
                  ))}
                </select>

                {/* Quantifier Values */}
                {block.quantifier.includes('n') && (
                  <div className="quantifier-values">
                    <input
                      type="number"
                      min="0"
                      value={block.quantifierValues.min || ''}
                      onChange={(e) =>
                        updateBlock(index, {
                          quantifierValues: {
                            ...block.quantifierValues,
                            min: parseInt(e.target.value) || 0,
                          },
                        })
                      }
                      className="quantifier-input"
                      placeholder="min"
                    />
                    {block.quantifier === '{n,m}' && (
                      <>
                        <span className="quantifier-separator">-</span>
                        <input
                          type="number"
                          min={block.quantifierValues.min || 0}
                          value={block.quantifierValues.max || ''}
                          onChange={(e) =>
                            updateBlock(index, {
                              quantifierValues: {
                                ...block.quantifierValues,
                                max: parseInt(e.target.value) || 0,
                              },
                            })
                          }
                          className="quantifier-input"
                          placeholder="max"
                        />
                      </>
                    )}
                  </div>
                )}

                {/* Remove Block Button */}
                <button 
                  onClick={() => removeBlock(index)} 
                  className="remove-block-btn" 
                  title={t('regex.builder.removeBlock')}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>

          {/* Preview and Apply */}
          {showPreview && (
            <div className="pattern-preview">
              <div className="pattern-preview-text">/
                <span className="pattern-text">{buildPattern()}</span>
                /
              </div>
              <button 
                onClick={applyPattern} 
                className="apply-pattern-btn"
              >
                <Check size={16} />
                <span>{t('regex.builder.applyPattern')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}