/**
 * Minimal inline SVG icon set (24x24, stroke-based, Heroicons-style).
 * Kept local to avoid pulling in an icon package for a handful of glyphs.
 */
import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps, children: React.ReactNode) {
  const { className, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-4 w-4'}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const RefreshIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
      <path d="M3 21v-5h5" />
    </>,
  );

export const WalletIcon = (props: IconProps) =>
  base(
    props,
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M16.5 14.5h2" />
    </>,
  );

export const LayersIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>,
  );

export const AlertTriangleIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>,
  );

export const GavelIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="m14 9-9.5 9.5" />
      <path d="m9.5 4.5 5 5" />
      <path d="M17 3l4 4" />
      <path d="m12.5 8.5 4-4" />
      <path d="M3 21h9" />
    </>,
  );

export const SearchIcon = (props: IconProps) =>
  base(
    props,
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3-3" />
    </>,
  );

export const BuildingIcon = (props: IconProps) =>
  base(
    props,
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01" />
    </>,
  );

export const ClockIcon = (props: IconProps) =>
  base(
    props,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>,
  );

export const CheckCircleIcon = (props: IconProps) =>
  base(
    props,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-5" />
    </>,
  );

export const ChevronDownIcon = (props: IconProps) => base(props, <path d="m6 9 6 6 6-6" />);

export const InboxIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="M3 12h4.5l1.5 3h6l1.5-3H21" />
      <path d="M5.5 5h13l2.5 7v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7l2.5-7Z" />
    </>,
  );

export const LogoMark = (props: IconProps) =>
  base(
    props,
    <>
      <path
        d="M12 2 3 6.5v6c0 5.1 3.8 9.4 9 10.5 5.2-1.1 9-5.4 9-10.5v-6L12 2Z"
        fill="currentColor"
        stroke="none"
        opacity={0.14}
      />
      <path d="M12 2 3 6.5v6c0 5.1 3.8 9.4 9 10.5 5.2-1.1 9-5.4 9-10.5v-6L12 2Z" />
      <path d="m8.2 12.2 2.6 2.6 5-5.2" />
    </>,
  );
