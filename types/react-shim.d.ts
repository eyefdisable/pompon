/* Минимальные типы React для офлайн-проверки (без @types/react). */
declare namespace React {
  type ReactNode = any; type ReactElement = any; type Key = string | number;
  interface FormEvent<T = any> { preventDefault(): void; target: T; currentTarget: T }
  interface MutableRefObject<T> { current: T }
  type SetState<S> = (v: S | ((prev: S) => S)) => void;
  function useState<S>(init: S | (() => S)): [S, SetState<S>];
  function useEffect(fn: () => void | (() => void), deps?: readonly any[]): void;
  function useLayoutEffect(fn: () => void | (() => void), deps?: readonly any[]): void;
  function useRef<T>(init: T): MutableRefObject<T>;
  function useRef<T>(init: T | null): MutableRefObject<T | null>;
  function useMemo<T>(fn: () => T, deps: readonly any[]): T;
  function useCallback<T extends (...a: any[]) => any>(fn: T, deps: readonly any[]): T;
  function useImperativeHandle<T>(ref: any, init: () => T, deps?: readonly any[]): void;
  function forwardRef<T, P = {}>(render: (props: P, ref: any) => any): (props: P & { ref?: MutableRefObject<T | null> | ((v: T | null) => void) }) => any;
  const Fragment: any;
}
declare module 'react' { export = React; }
declare module 'react/jsx-runtime' {
  export namespace JSX {
    interface Element {} interface ElementClass {}
    interface IntrinsicAttributes { key?: React.Key }
    interface ElementChildrenAttribute { children: {} }
    interface Handlers { onChange?(e: { target: any; currentTarget: any }): void; onClick?(e: any): void; onSubmit?(e: any): void; onFocus?(e: { target: any }): void; onKeyDown?(e: any): void; [prop: string]: any }
    interface IntrinsicElements { [name: string]: Handlers }
  }
  export const jsx: any; export const jsxs: any; export const Fragment: any;
}
declare module 'react-dom/client' { export function createRoot(el: Element): { render(node: any): void; unmount(): void }; }
declare module 'react-dom/server' { export function renderToString(node: any): string; }
