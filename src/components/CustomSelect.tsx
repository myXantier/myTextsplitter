import React, { useState, useRef, useEffect, useCallback } from 'react';
import './styles/CustomSelectStyle.css';

interface CustomSelectProps<T extends string> {
  label?: string;
  items: Item<T>[];
  value?: T;
  onChange?: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function CustomSelect<T extends string>({
  label,
  items,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number>(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [isPositioned, setIsPositioned] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const dummyTextRef = useRef<HTMLSpanElement>(null);
  const selected = items.find((opt) => opt.value === value);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setHoverIndex(-1);
    setIsPositioned(false);
  }, []);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeDropdown]);

  // Calculate width based on longest text
  useEffect(() => {
    if (containerRef.current && dummyTextRef.current) {
      const longestLabel = items.reduce(
        (longest, item) => (item.label.length > longest.length ? item.label : longest),
        ''
      );
      dummyTextRef.current.innerText = longestLabel;
      dummyTextRef.current.style.fontSize = '0.9rem';
      containerRef.current.style.width = dummyTextRef.current.getBoundingClientRect().width + 45 + 'px';
    }
  }, [items]);

  // Position dropdown
  const positionDropdown = useCallback(() => {
    if (!containerRef.current || !dropdownRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const dropdownRect = dropdownRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    const spaceBelow = viewportHeight - containerRect.bottom;
    const spaceAbove = containerRect.top;
    const dropdownHeight = dropdownRect.height;

    // Check if dropdown should open upward
    const shouldOpenUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    // Calculate position and set style
    const style: React.CSSProperties = {
      position: 'fixed',
      width: containerRect.width,
      left: containerRect.left,
      maxHeight: Math.min(200, shouldOpenUp ? spaceAbove - 10 : spaceBelow - 10),
      opacity: 1,
    };

    if (shouldOpenUp) {
      style.bottom = viewportHeight - containerRect.top;
    } else {
      style.top = containerRect.bottom;
    }

    setDropdownStyle(style);
    setIsPositioned(true);
  }, []);

  // Update position on scroll or resize
  useEffect(() => {
    if (!isOpen) return;

    const handleUpdate = () => {
      requestAnimationFrame(positionDropdown);
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
    };
  }, [isOpen, positionDropdown]);

  // Initial positioning
  useEffect(() => {
    if (isOpen && !isPositioned) {
      requestAnimationFrame(positionDropdown);
    }
  }, [isOpen, isPositioned, positionDropdown]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (isOpen) {
          setHoverIndex((prev) => (prev + 1) % items.length);
        } else {
          setIsOpen(true);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          setHoverIndex((prev) => (prev - 1 + items.length) % items.length);
        } else {
          setIsOpen(true);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen && hoverIndex >= 0) {
          onChange?.(items[hoverIndex].value);
          closeDropdown();
        }
        break;
      case 'Escape':
        e.stopPropagation();
        e.preventDefault();
        closeDropdown();
        break;
    }
  };

  return (
    <div className="custom-select-wrapper">
      {label && <label className="select-label">{label}</label>}
      <div
        className={`custom-select ${disabled ? 'disabled' : ''}`}
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <span ref={dummyTextRef} className="hidden-span-helper" />
        <div className="select-box">
          <span className="select-text">{selected?.label || placeholder}</span>
          <span className="arrow">{isOpen ? '▲' : '▼'}</span>
        </div>

        {isOpen && (
          <ul 
            ref={dropdownRef}
            className="select-dropdown"
            style={{
              ...dropdownStyle,
              opacity: isPositioned ? 1 : 0,
              transition: 'opacity 0.15s ease-out',
            }}
          >
            {items.map((opt, idx) => (
              <li
                key={opt.value}
                className={`${opt.value === value ? 'selected' : ''} ${idx === hoverIndex ? 'hovered' : ''}`}
                onMouseEnter={() => setHoverIndex(idx)}
                onClick={() => {
                  onChange?.(opt.value);
                  closeDropdown();
                }}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}