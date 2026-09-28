import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

import { cx } from '../utils/cx'

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Accessible name; also shown as tooltip unless `tip` is false. */
  label: string
  tip?: string | false
  tipPos?: 'top' | 'bottom'
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
  iconSize?: number
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tip, tipPos = 'top', size = 'md', active, iconSize, className, ...rest },
  ref,
) {
  const dims = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      data-tip={tip === false ? undefined : (tip ?? label)}
      data-tip-pos={tipPos}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150',
        'text-ink-soft hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        dims,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize ?? (size === 'lg' ? 22 : size === 'sm' ? 16 : 18)} />
    </button>
  )
})

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: IconName
  size?: 'sm' | 'md' | 'lg'
}

export function Button({ variant = 'secondary', icon, size = 'md', className, children, ...rest }: ButtonProps) {
  const sizes = size === 'lg' ? 'h-12 px-6 text-[15px]' : size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm'
  const variants = {
    primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-sm',
    secondary: 'bg-paper-2 text-ink hover:bg-hover border border-line',
    ghost: 'text-ink-soft hover:bg-hover hover:text-ink',
    danger: 'text-danger hover:bg-hover border border-line',
  }[variant]
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-45',
        sizes,
        variants,
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
      {children}
    </button>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  id?: string
  hideLabel?: boolean
  className?: string
  /** Show -/+ buttons around the slider. */
  steppers?: boolean
  onStep?: (dir: 1 | -1) => void
}

export function Slider({ label, value, min, max, step, onChange, format, id, hideLabel, className, steppers, onStep }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  const inputId = id ?? `slider-${label.replace(/\W+/g, '-').toLowerCase()}`
  const stepBy = (dir: 1 | -1) => {
    if (onStep) return onStep(dir)
    const next = Math.min(max, Math.max(min, +(value + dir * step).toFixed(4)))
    onChange(next)
  }
  return (
    <div className={className}>
      {!hideLabel && (
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor={inputId} className="text-[13px] font-medium text-ink-soft">
            {label}
          </label>
          <span className="text-[12px] tabular-nums text-ink-faint">{format ? format(value) : value}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        {steppers && <IconButton icon="minus" label={`Decrease ${label.toLowerCase()}`} tip={false} size="sm" onClick={() => stepBy(-1)} />}
        <input
          id={inputId}
          type="range"
          className="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={hideLabel ? label : undefined}
          aria-valuetext={format ? format(value) : undefined}
          style={{ ['--pct' as string]: `${pct}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {steppers && <IconButton icon="plus" label={`Increase ${label.toLowerCase()}`} tip={false} size="sm" onClick={() => stepBy(1)} />}
      </div>
    </div>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  className?: string
}

export function Segmented<T extends string>({ label, value, options, onChange, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex rounded-full border border-line bg-paper-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-150',
            value === o.value ? 'bg-paper text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-[13px] font-medium text-ink-soft">{label}</span>
        {description && <span className="block text-[12px] text-ink-faint">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={cx('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
      </button>
    </label>
  )
}

export function ProgressBar({ value, className, striped }: { value: number; className?: string; striped?: boolean }) {
  return (
    <div
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <div
        className={cx('h-full rounded-full bg-accent transition-[width] duration-300 ease-out', striped && 'progress-stripes')}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.6em] items-center justify-center rounded-md border border-line-strong bg-paper-2 px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-soft">
      {children}
    </kbd>
  )
}
