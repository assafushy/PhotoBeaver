import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { buttonStyles } from './Modal';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonStyles;
  testId?: string;
}

/**
 * A button in one of the app's styles; `type` defaults to "button".
 *
 * @param props - Style, test id and the usual button attributes.
 */
export function Button({ variant = 'secondary', testId, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonStyles[variant]} data-testid={testId} {...rest} />;
}

/**
 * The right-aligned row of buttons at the bottom of a form or dialog.
 *
 * @param props - The buttons.
 */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2">{children}</div>;
}
