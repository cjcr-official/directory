/**
 * The church's mark. White artwork on transparency, so it only reads on a dark
 * ground — every use below puts one behind it.
 */
export function Logo({ className, width }: { className?: string; width?: number }) {
  return (
    <img
      className={className}
      src="/alliance-logo.webp"
      alt="The Alliance"
      width={width}
      // 1600x390 in the source; declaring the ratio stops the layout jumping
      // while it loads.
      style={{ aspectRatio: "1600 / 390" }}
    />
  );
}
