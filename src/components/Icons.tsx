import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const defaults = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function CrystalMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M24 3 44 27 24 45 4 27 24 3Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="m24 3 7.5 24L24 45l-7.5-18L24 3Z"
        fill="url(#crystal-fill)"
      />
      <path d="M4 27 24 18l20 9-20 9-20-9Z" stroke="currentColor" />
      <circle cx="24" cy="27" r="2.5" fill="currentColor" />
      <defs>
        <linearGradient
          id="crystal-fill"
          x1="18"
          y1="6"
          x2="34"
          y2="39"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f6ffff" />
          <stop offset=".42" stopColor="#7ee7ff" />
          <stop offset="1" stopColor="#6674ff" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M7 3.5h6l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13 3.5v4h4M9 12h5M9 16h4" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M5 7h14M9 7V4.5h6V7M7 7l.8 13h8.4L17 7" />
      <path d="M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 3.5v12m0 0 4.5-4.5M12 15.5 7.5 11" />
      <path d="M5 17.5v1A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-1" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 3 20 6v5.7c0 4.8-3.4 7.6-8 9.3-4.6-1.7-8-4.5-8-9.3V6l8-3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="m7 9.5 5 5 5-5" />
    </svg>
  );
}

export function MergeIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M5 4.5h2.5c3 0 4.5 1.7 4.5 4.5v6c0 2.8 1.5 4.5 4.5 4.5H19" />
      <path d="M5 19.5h2.5c3 0 4.5-1.7 4.5-4.5V9c0-2.8 1.5-4.5 4.5-4.5H19" />
      <path d="m16 2 3 2.5L16 7m0 10 3 2.5-3 2.5" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
