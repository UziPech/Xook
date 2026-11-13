// Logotipo tipográfico brutalista XOOK (geometría arquitectónica, sin recuadros)
export function XookWordmark({ className = "h-3.5 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 94 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="XOOK"
      className={className}
    >
      {/* X */}
      <path d="M0 0H5.4L20 16H14.6L0 0Z" fill="currentColor" />
      <path d="M14.6 0H20L5.4 16H0L14.6 0Z" fill="currentColor" />
      {/* O */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M26.5 0H41.5L44 2.5V13.5L41.5 16H26.5L24 13.5V2.5L26.5 0ZM28 4V12H40V4H28Z"
        fill="currentColor"
      />
      {/* O */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M51.5 0H66.5L69 2.5V13.5L66.5 16H51.5L49 13.5V2.5L51.5 0ZM53 4V12H65V4H53Z"
        fill="currentColor"
      />
      {/* K */}
      <path
        d="M74 0H78V6.2L86.8 0H94L82.65 8L94 16H86.8L78 9.8V16H74V0Z"
        fill="currentColor"
      />
    </svg>
  );
}
