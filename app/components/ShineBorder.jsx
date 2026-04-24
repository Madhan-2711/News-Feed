'use client';

/**
 * ShineBorder — ported from Magic UI to Vanilla CSS/JSX.
 * No Tailwind or shadcn required.
 *
 * Wraps children with an animated radial-gradient border that
 * sweeps around the element using a CSS mask technique.
 */
export default function ShineBorder({
  borderRadius = 8,
  borderWidth = 1,
  duration = 14,
  color = ['#B8860B', '#DAA520', '#D4AF37'],
  className = '',
  style = {},
  children,
}) {
  const colorStr = Array.isArray(color) ? color.join(',') : color;

  return (
    <div
      className={`shine-border-wrapper ${className}`}
      style={{
        '--border-radius': `${borderRadius}px`,
        '--border-width': `${borderWidth}px`,
        '--duration': `${duration}s`,
        '--shine-color': colorStr,
        borderRadius: `${borderRadius}px`,
        position: 'relative',
        ...style,
      }}
    >
      {/* The animated border pseudo-element is applied via CSS */}
      <div className="shine-border-inner" aria-hidden="true" />
      {children}
    </div>
  );
}
