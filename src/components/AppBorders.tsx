import React from 'react';
import './styles/AppBordersStyle.css';

interface Props {
  children?: React.ReactNode;
  borderRadius: string;
  margin: string;
  isMaximized: boolean;
  focus: boolean;
  className?: string;
  isVisible: boolean;
}

export default function AppBorders({
  children,
  borderRadius,
  margin,
  isMaximized,
  focus,
  className,
  isVisible,
}: Props) {
  // Wenn maximiert, soll kein Rahmen angezeigt werden, sonst 1px.
  const borderWidth = isMaximized ? '0px' : '1px';
  const borderColor = focus ? 'var(--app-border-color)' : 'var(--background)';
  // Box-shadow-Farbe: #000000E6 bei Fokus, sonst #00000066
  const boxShadowColor = focus ? '#000000E6' : '#00000066';

  return (
    <div
      className={`${className || ''} border ${isVisible ? '' : 'hide-app-window'}`}
      style={
        {
          '--border-margin': margin,
          '--border-radius': borderRadius,
          '--border-width': borderWidth,
          '--border-color': borderColor,
          '--box-shadow-color': boxShadowColor,
        } as React.CSSProperties
      }
    >
      <div className="childrens">{children}</div>
    </div>
  );
}
