import React from 'react';
import { SvgIconClose } from './SvgIcons';
import './styles/InputTextStyle.css';

interface Props {
  value?: string;
  type?: React.HTMLInputTypeAttribute;
  setValue?: React.Dispatch<any>;
  placeHolder?: string;
  required?: boolean;
  onKeyDown?(): void;
  onKeyUp?(): void;
  onFocus?(): void;
  onScroll?(): void;
  onWheel?(): void;
  onWheelCapture?(): void;
  borderRadius?: string;
  enableClearTextBtn?: boolean;
  enableLeftIcon?: boolean;
  leftIcon?: React.ReactNode;
  maxLength?: number;
  max?: number | string;
  min?: number | string;
}

const InputText = React.forwardRef<HTMLInputElement, Props>((props, ref) => {
  // Funktion zum Leeren des Inputs
  const clearText = () => {
    if (props.setValue) props.setValue('');
  };

  // Linkes Icon, falls aktiviert
  const leftIcon = props.enableLeftIcon ? <div className="input-icon">{props.leftIcon}</div> : null;

  // Clear-Button, falls aktiviert
  const clearBtn = props.enableClearTextBtn ? (
    <div className="clear-text" onClick={clearText}>
      <SvgIconClose size="16" />
    </div>
  ) : null;

  // Setze dynamische CSS-Variablen (z. B. für den Border-Radius) – alternativ kannst du diese global setzen
  const containerStyle: React.CSSProperties = {
    '--border-radius': props.borderRadius || 'var(--app-border-radius)',
    '--border-radius-btn': props.borderRadius
      ? `${parseInt(props.borderRadius) - 2}px`
      : `calc(var(--app-border-radius) - 2px)`,
  } as React.CSSProperties;

  // Für das Input selbst, extra Klassen für Padding falls Clear-Button oder Icon benötigt werden
  const inputClass = `input-text${props.enableClearTextBtn ? ' has-clear' : ''}${
    props.enableLeftIcon ? ' has-icon' : ''
  }`;

  return (
    <div id="input-text-container" className="input-text-container" style={containerStyle}>
      <input
        ref={ref}
        className={inputClass}
        type={props.type}
        value={props.value}
        placeholder={props.placeHolder}
        onKeyDown={props.onKeyDown}
        onKeyUp={props.onKeyUp}
        onFocus={props.onFocus}
        onScroll={props.onScroll}
        onWheel={props.onWheel}
        onWheelCapture={props.onWheelCapture}
        onChange={(e) => {
          const { value, maxLength } = e.target;
          props.setValue && props.setValue((maxLength > 0) ? value.slice(0, maxLength) : value);
        }}
        required={props.required}
        autoComplete="off"
        max={props.max}
        min={props.min}
        maxLength={props.maxLength}
      />
      {clearBtn}
      {leftIcon}
    </div>
  );
});

export default InputText;
