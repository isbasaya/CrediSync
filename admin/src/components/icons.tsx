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

export const HomeIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </>,
  );

export const UsersIcon = (props: IconProps) =>
  base(
    props,
    <>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M2.75 19.5a6.25 6.25 0 0 1 12.5 0" />
      <path d="M16 4.8a3.25 3.25 0 0 1 0 6.4" />
      <path d="M18.5 13.5a6.2 6.2 0 0 1 3.75 6" />
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

export const InboxIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="M3 12h4.5l1.5 3h6l1.5-3H21" />
      <path d="M5.5 5h13l2.5 7v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7l2.5-7Z" />
    </>,
  );

export const LogoutIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>,
  );

export const MenuIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </>,
  );

export const XIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>,
  );

export const MailIcon = (props: IconProps) =>
  base(
    props,
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="m3 6.5 9 6.25L21 6.5" />
    </>,
  );

export const LockIcon = (props: IconProps) =>
  base(
    props,
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
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

export const ChevronLeftIcon = (props: IconProps) => base(props, <path d="m15 6-6 6 6 6" />);
export const ChevronRightIcon = (props: IconProps) => base(props, <path d="m9 6 6 6-6 6" />);

export const AlertTriangleIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
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

export const PulseIcon = (props: IconProps) =>
  base(
    props,
    <>
      <path d="M2.5 12h4l2-6 4 12 2-8 2 2h5" />
    </>,
  );
