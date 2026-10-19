import { Children, createContext, isValidElement, useContext, type ComponentProps, type ReactNode } from 'react';

export const SettingsSearchContext = createContext('');
export const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase();

export function SettingsSearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <input className="settings-search" type="search" aria-label={label} placeholder={label + '…'} value={value} onChange={event => onChange(event.target.value)} />;
}

function searchableText(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (!isValidElement<{ children?: ReactNode; 'aria-label'?: string }>(child)) return '';
    return `${child.props['aria-label'] ?? ''} ${searchableText(child.props.children)}`;
  }).join(' ');
}

// Keep filtering declarative so device updates and newly added rows are searched too.
export function SettingsCard({ children, ...props }: ComponentProps<'section'>) {
  const query = normalizeSearch(useContext(SettingsSearchContext));
  const items = Children.toArray(children);
  const isRow = (child: ReactNode) => isValidElement<{ className?: string }>(child) && child.props.className?.split(' ').includes('settings-row');
  const heading = items.find(child => isValidElement(child) && child.type === 'h3');
  const sectionMatches = normalizeSearch(searchableText(heading)).includes(query);
  const matches = (child: ReactNode) => sectionMatches || normalizeSearch(searchableText(child)).includes(query);
  const rows = items.filter(isRow);
  if (query && !(rows.length ? rows.some(matches) : items.some(matches))) return null;
  return <section {...props}>{items.filter(child => !isRow(child) || matches(child))}</section>;
}
