import { forwardRef } from 'react';
import { useSettings } from '../hooks/useSettings';

export interface SvgProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  width?: number | string;
  height?: number | string;
  color?: string;
}

export const MyAppLogo = forwardRef<SVGSVGElement, SvgProps>(({ width, height, color, ...props }, ref) => {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? "auto"}
      height={height ?? "100%"}
      viewBox="0 0 320 64"
      preserveAspectRatio="xMidYMid meet"
      // fill={color}
      {...props}
    >
      <g transform="translate(0,64) scale(0.1,-0.1)" fill={color} stroke="none">
        <path d="M72 538 c-9 -9 -12 -73 -12 -225 l0 -213 27 -11 c14 -5 69 -8 122 -7 l96 3 3 163 2 162 -85 0 c-78 0 -85 2 -85 20 0 17 8 19 83 22 l82 3 3 48 3 47 -113 0 c-75 0 -118 -4 -126 -12z m188 -218 c0 -18 -7 -20 -60 -20 -53 0 -60 2 -60 20 0 18 7 20 60 20 53 0 60 -2 60 -20z m0 -115 c0 -24 -3 -25 -54 -25 -56 0 -72 9 -62 35 4 11 22 15 61 15 52 0 55 -1 55 -25z" />
        <path d="M350 390 l0 -160 80 0 c79 0 80 0 80 -25 0 -25 -1 -25 -80 -25 l-80 0 0 -50 0 -50 103 0 c155 0 147 -14 147 239 0 148 -3 210 -12 219 -8 8 -50 12 -125 12 l-113 0 0 -160z m160 40 c0 -18 -7 -20 -60 -20 -53 0 -60 2 -60 20 0 18 7 20 60 20 53 0 60 -2 60 -20z m0 -110 c0 -18 -7 -20 -60 -20 -53 0 -60 2 -60 20 0 18 7 20 60 20 53 0 60 -2 60 -20z" />
        <path d="M2443 459 c-16 -16 -5 -39 18 -39 24 0 37 29 18 41 -18 11 -23 11 -36 -2z" />
        <path d="M1217 454 c-4 -4 -7 -16 -7 -26 0 -14 8 -18 35 -18 l35 0 0 -100 0 -100 25 0 c25 0 25 0 25 99 l0 100 38 3 c29 2 37 7 37 23 0 18 -8 20 -90 23 -50 1 -94 0 -98 -4z" />
        <path d="M2350 335 c0 -118 1 -125 20 -125 19 0 20 7 20 125 0 118 -1 125 -20 125 -19 0 -20 -7 -20 -125z" />
        <path d="M1820 420 c0 -11 -7 -23 -15 -26 -8 -4 -15 -12 -15 -19 0 -7 7 -15 15 -19 11 -4 15 -22 15 -71 0 -62 2 -66 27 -76 48 -18 75 13 33 39 -16 9 -20 23 -20 62 0 43 3 50 20 50 11 0 20 6 20 14 0 7 -9 16 -20 19 -12 3 -20 14 -20 26 0 14 -6 21 -20 21 -13 0 -20 -7 -20 -20z" />
        <path d="M2540 415 c0 -16 -6 -25 -15 -25 -8 0 -15 -7 -15 -15 0 -8 7 -15 15 -15 12 0 15 -13 15 -58 0 -68 14 -92 55 -95 35 -2 48 27 15 36 -17 4 -20 13 -20 61 0 49 2 56 20 56 11 0 20 7 20 15 0 8 -9 15 -20 15 -15 0 -20 7 -20 25 0 20 -5 25 -25 25 -20 0 -25 -5 -25 -25z" />
        <path d="M2680 420 c0 -11 -7 -23 -15 -26 -8 -4 -15 -12 -15 -20 0 -8 7 -14 15 -14 12 0 15 -14 15 -65 0 -57 3 -66 25 -81 26 -17 65 -11 65 11 0 7 -9 15 -20 18 -17 4 -20 14 -20 61 0 49 2 56 20 56 11 0 20 7 20 15 0 8 -9 15 -20 15 -15 0 -20 7 -20 25 0 20 -5 25 -25 25 -18 0 -25 -5 -25 -20z" />
        <path d="M792 384 c-12 -8 -22 -10 -22 -5 0 6 -11 11 -25 11 -25 0 -25 -1 -25 -90 0 -89 0 -90 25 -90 24 0 25 3 25 59 0 63 17 95 45 85 11 -5 15 -24 15 -75 0 -67 1 -69 25 -69 24 0 25 3 25 59 0 57 15 91 40 91 18 0 30 -39 30 -94 0 -49 2 -56 20 -56 18 0 20 7 20 80 0 74 -2 81 -25 96 -28 18 -72 12 -81 -11 -4 -11 -9 -10 -25 6 -23 23 -38 24 -67 3z" />
        <path d="M1429 371 c-38 -38 -40 -97 -5 -138 33 -38 98 -39 128 -3 19 23 19 25 3 28 -10 2 -29 -2 -42 -9 -27 -15 -56 -3 -61 25 -3 13 6 16 57 16 33 0 62 3 64 8 10 16 -19 77 -43 89 -40 20 -69 15 -101 -16z m89 -23 c21 -21 13 -28 -28 -28 -22 0 -40 4 -40 8 0 14 23 32 40 32 9 0 21 -5 28 -12z" />
        <path d="M1980 393 c-26 -10 -50 -35 -50 -53 0 -24 25 -43 74 -55 24 -7 41 -17 41 -25 0 -18 -43 -26 -58 -11 -13 13 -57 15 -57 2 0 -16 30 -41 56 -47 14 -4 42 0 62 8 29 11 38 20 40 41 5 38 -10 53 -63 66 -53 13 -63 41 -15 41 17 0 30 -4 30 -10 0 -5 9 -10 20 -10 27 0 25 25 -2 44 -23 16 -50 19 -78 9z" />
        <path d="M2191 381 c-16 -16 -21 -17 -21 -6 0 8 -9 15 -20 15 -19 0 -20 -7 -20 -125 l0 -125 25 0 c22 0 25 4 25 39 l0 39 30 -11 c74 -28 131 94 78 165 -21 29 -72 34 -97 9z m53 -37 c31 -31 11 -104 -28 -104 -34 0 -52 74 -26 105 16 19 34 19 54 -1z" />
        <path d="M2840 387 c-50 -25 -63 -90 -31 -144 32 -51 114 -54 141 -3 9 17 8 20 -10 20 -11 0 -29 -6 -40 -12 -23 -15 -53 -2 -58 26 -3 13 7 16 63 16 l67 0 -7 33 c-8 38 -47 77 -78 77 -12 0 -33 -6 -47 -13z m68 -39 c21 -21 13 -28 -28 -28 -22 0 -40 4 -40 8 0 14 23 32 40 32 9 0 21 -5 28 -12z" />
        <path d="M3066 384 c-9 -8 -16 -11 -16 -5 0 6 -11 11 -25 11 -25 0 -25 -1 -25 -90 0 -89 0 -90 25 -90 24 0 25 3 25 54 0 70 7 86 36 86 19 0 24 5 24 25 0 29 -21 33 -44 9z" />
        <path d="M1042 308 c44 -120 44 -116 14 -128 -14 -5 -26 -16 -26 -25 0 -22 53 -19 74 4 15 17 86 199 86 221 0 6 -10 10 -23 10 -20 0 -26 -9 -43 -67 l-20 -68 -18 68 c-18 62 -21 67 -47 67 l-28 0 31 -82z" />
        <path d="M1600 384 c0 -3 10 -23 23 -45 l22 -39 -22 -39 c-28 -49 -28 -51 -3 -51 12 0 28 13 39 31 l19 31 16 -31 c12 -22 24 -31 42 -31 l26 0 -27 45 -26 46 26 44 26 45 -25 0 c-19 0 -30 -9 -42 -32 l-17 -33 -15 33 c-11 22 -22 32 -39 32 -13 0 -23 -2 -23 -6z" />
        <path d="M2440 300 c0 -89 0 -90 25 -90 25 0 25 1 25 90 0 89 0 90 -25 90 -25 0 -25 -1 -25 -90z" />
      </g>
    </svg>
  );
});

export function SvgIconMenuOpened({ size, width, height, color, ...props }: SvgProps) {
  if (!color) {
    color = useSettings((state) => state.theme.colors.appIconColor);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 24 24"
      {...props}
    >
      <path fill={color} d="m5 13l4 4l-1.4 1.42L1.18 12L7.6 5.58L9 7l-4 4h16v2H5m16-7v2H11V6h10m0 10v2H11v-2h10Z" />
    </svg>
  );
}

export function SvgIconMenuClosed({ size, width, height, color, ...props }: SvgProps) {
  if (!color) {
    color = useSettings((state) => state.theme.colors.appIconColor);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 24 24"
      {...props}
    >
      <path fill={color} d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
    </svg>
  );
}

export function SvgIconMinimize({ size, width, height, color, ...props }: SvgProps) {
  if (!color) {
    color = useSettings((state) => state.theme.colors.appIconColor);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 512 512"
      {...props}
    >
      <path fill={color} d="M48 448h416v32H48z" />
    </svg>
  );
}

export function SvgIconMaximize({ size, width, height, color, ...props }: SvgProps) {
  if (!color) {
    color = useSettings((state) => state.theme.colors.appIconColor);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 512 512"
      {...props}
    >
      <path
        fill={color}
        d="M472 48H40.335a24.027 24.027 0 0 0-24 24v384a24.027 24.027 0 0 0 24 24H472a24.027 24.027 0 0 0 24-24V72a24.027 24.027 0 0 0-24-24Zm-8 32v71.981l-415.665-.491V80ZM48.335 448V183.49l415.665.491V448Z"
      />
    </svg>
  );
}

export function SvgIconRestore({ size, width, height, color, ...props }: SvgProps) {
  if (!color) {
    color = useSettings((state) => state.theme.colors.appIconColor);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 512 512"
      {...props}
    >
      <path
        fill={color}
        d="M352 153H40.247a24.028 24.028 0 0 0-24 24v281a24.028 24.028 0 0 0 24 24H352a24.028 24.028 0 0 0 24-24V177a24.028 24.028 0 0 0-24-24Zm-8 32v45.22H48.247V185ZM48.247 450V262.22H344V450Z"
      />
      <path
        fill={color}
        d="M472 32H152a24.028 24.028 0 0 0-24 24v65h32V64h304v275.143h-56v32h64a24.028 24.028 0 0 0 24-24V56a24.028 24.028 0 0 0-24-24Z"
      />
    </svg>
  );
}

export function SvgIconClose({ size, width, height, color, ...props }: SvgProps) {
  if (!color) {
    color = useSettings((state) => state.theme.colors.appIconColor);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        fill={color}
        d="M13.46 12L19 17.54V19h-1.46L12 13.46L6.46 19H5v-1.46L10.54 12L5 6.46V5h1.46L12 10.54L17.54 5H19v1.46L13.46 12Z"
      />
    </svg>
  );
}

export function SvgIconSettings({ size, width, height, color, ...props }: SvgProps): JSX.Element {
  if (!color) {
    color = useSettings((state) => state.theme.colors.appIconColor);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        fill={color}
        d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.6.6 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1q.09.03.18.03c.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64zm-1.98-1.71c.04.31.05.52.05.73s-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2"
      />
    </svg>
  );
}

export function SvgIconReload({ size, width, height, color, ...props }: SvgProps) {
  if (!color) {
    color = useSettings((state) => state.theme.colors.appIconColor);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        fill={color}
        d="M12 21q-3.45 0-6.013-2.288T3.05 13H5.1q.35 2.6 2.313 4.3T12 19q2.925 0 4.963-2.038T19 12q0-2.925-2.038-4.963T12 5q-1.725 0-3.225.8T6.25 8H9v2H3V4h2v2.35q1.275-1.6 3.113-2.475T12 3q1.875 0 3.513.713t2.85 1.924q1.212 1.213 1.925 2.85T21 12q0 1.875-.713 3.513t-1.924 2.85q-1.213 1.212-2.85 1.925T12 21Zm2.8-4.8L11 12.4V7h2v4.6l3.2 3.2l-1.4 1.4Z"
      />
    </svg>
  );
}
