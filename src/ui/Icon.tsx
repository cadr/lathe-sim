import type { CSSProperties } from 'react';
import styles from './common.module.css';

export interface IconProps {
  /** URL of a single-color SVG drawn with currentColor */
  src: string;
  size?: number;
  className?: string;
}

/** Renders a currentColor SVG URL as a CSS mask so it takes the text color. */
export function Icon({ src, size = 24, className }: IconProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    maskImage: `url("${src}")`,
    WebkitMaskImage: `url("${src}")`,
  };
  return <span aria-hidden="true" className={[styles.icon, className].filter(Boolean).join(' ')} style={style} data-icon={src} />;
}
