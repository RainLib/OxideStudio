import { useEffect, useRef, useState } from "react";

/**
 * useDebounce Hook
 * 对值进行防抖处理,在指定延迟后返回最新值
 *
 * @param value - 要防抖的值
 * @param delay - 延迟时间(毫秒)
 * @returns 防抖后的值
 *
 * @example
 * ```tsx
 * function SearchComponent() {
 *   const [searchTerm, setSearchTerm] = useState('');
 *   const debouncedSearch = useDebounce(searchTerm, 500);
 *
 *   useEffect(() => {
 *     if (debouncedSearch) {
 *       performSearch(debouncedSearch);
 *     }
 *   }, [debouncedSearch]);
 *
 *   return <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />;
 * }
 * ```
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * useDebouncedCallback Hook
 * 对回调函数进行防抖处理
 *
 * @param callback - 要防抖的回调函数
 * @param delay - 延迟时间(毫秒)
 * @returns 防抖后的回调函数
 *
 * @example
 * ```tsx
 * function AutoSaveComponent() {
 *   const debouncedSave = useDebouncedCallback((data) => {
 *     saveToServer(data);
 *   }, 1000);
 *
 *   return <input onChange={(e) => debouncedSave(e.target.value)} />;
 * }
 * ```
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  };
}
