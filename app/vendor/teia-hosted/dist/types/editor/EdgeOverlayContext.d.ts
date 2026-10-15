import { type ReactNode } from 'react';
interface EdgeOverlayProviderProps {
    target: HTMLElement | null;
    children: ReactNode;
}
export declare function EdgeOverlayProvider({ target, children }: EdgeOverlayProviderProps): import("react").JSX.Element;
export declare function useEdgeOverlayTarget(): HTMLElement | null;
export {};
