import type { ComponentProps } from 'react';
import './slider.css';

export type SliderProps = ComponentProps<'input'> & {
  handleSize?: 'regular' | 'small';
  orientation?: 'horizontal' | 'vertical';
};

export function Slider({ className = '', handleSize = 'regular', orientation = 'horizontal', ...props }: SliderProps) {
  return <input {...props} type="range" className={`vira-slider vira-slider--${orientation}${handleSize === 'small' ? ' vira-slider--small' : ''} ${className}`.trim()} />;
}
