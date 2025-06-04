import React from 'react';
import './styles/IconRoundedButtonStyle.css';

export interface Props {
  id?: string;
  type?: 'submit' | 'reset' | 'button';
  onClick?(): void;
  isActive?: boolean;
  svgIcon?: React.ReactNode;
  iconSize?: string;
  highlightIcon?: boolean;
  size?: string;
  colorDefault?: string;
  colorHover?: string;
  colorPressed?: string;
  colorActive?: string;
  radius?: string;
  title?: string;
  className?: string;
}

export default function IconRoundedButton({
  id,
  type,
  onClick,
  isActive,
  svgIcon,
  highlightIcon,
  size,
  colorDefault,
  colorHover,
  colorPressed,
  colorActive,
  radius,
  title,
  className,
}: Props) {
  // Berechne den Hintergrund abhängig von isActive
  const computedBg = isActive ? colorActive : colorDefault;

  return (
    (<button
      id={id}
      type={type}
      onClick={onClick}
      title={title}
      className={`icon-rounded-button ${className}`}
      style={
        {
          '--button-size': size,
          '--button-radius': radius,
          '--button-bg': computedBg,
          '--button-hover': colorHover,
          '--button-pressed': colorPressed,
          // Setze Filter je nach Zustand
          '--svg-filter': isActive ? 'brightness(500%)' : 'none',
          '--svg-hover-filter': highlightIcon ? 'brightness(500%)' : 'none',
          '--svg-active-filter': highlightIcon ? 'brightness(500%)' : 'none',
        } as React.CSSProperties
      }
    >
      {svgIcon}
    </button>)
  );
}
