import React from 'react';
import './styles/CircularProgressBarStyle.css';

interface CircularProgressBarProps {
  value: number;
  endValue?: number;
  ref?: any;
  rotate?: string;
  strokeLinecap?: 'butt' | 'round' | 'square' | 'inherit' | undefined;
  dropShadow?: string;
  viewBoxSize?: number;
  strokeWidth?: number;
  strokeColor?: string;
  bgStrokeWidth?: number;
  bgStrokeColor?: string;
  text?: string;
  textColor?: string;
  textSize?: string;
  textPrefix?: string;
  textSuffix?: string;
  transitionTime?: string;
  children?: React.ReactNode;
}

export default function CircularProgressBar({
  value,
  endValue = 100,
  ref,
  rotate = '-90deg',
  strokeLinecap = 'round',
  dropShadow = 'none',
  viewBoxSize = 210,
  strokeWidth = 6,
  strokeColor = 'deepskyblue',
  bgStrokeWidth = 10,
  bgStrokeColor = '#f0f0f0',
  text,
  textSize = '2em',
  textColor = '#333',
  textPrefix,
  textSuffix,
  transitionTime = '0.3s',
  children,
}: CircularProgressBarProps) {
  // Berechne den Stroke-Dashoffset für den Fortschritt
  const computedDashoffset = 625 - (625 * value) / endValue;

  return (
    <div
      ref={ref}
      className="circular-progress-bar"
      style={
        {
          '--rotate': rotate,
          '--drop-shadow': dropShadow,
          '--text-color': textColor,
          '--text-size': textSize,
          '--transition-time': transitionTime,
          '--stroke-dashoffset': computedDashoffset,
        } as React.CSSProperties
      }
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      >
        <circle
          cx="50%"
          cy="50%"
          r="100"
          stroke={bgStrokeColor}
          strokeWidth={bgStrokeWidth}
        />
        <circle
          cx="50%"
          cy="50%"
          r="100"
          stroke={value ? strokeColor : 'transparent'}
          strokeLinecap={strokeLinecap}
          strokeWidth={strokeWidth}
          strokeDasharray={625}
          strokeDashoffset={625 - (625 * (value || 50)) / endValue}
        />
      </svg>
      <div className="children">{children}</div>
      {text ? (
        <div className="text-inside">
          {textPrefix}
          {text}
          {textSuffix}
        </div>
      ) : (
        ''
      )}
    </div>
  );
}
