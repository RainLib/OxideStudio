import { useEffect, useRef, useCallback, useState } from "react";

/**
 * useThrottle Hook
 * 对值进行节流处理,在指定时间间隔内最多更新一次
 *
 * @param value - 要节流的值
 * @param interval - 时间间隔(毫秒)
 * @returns 节流后的值
 *
 * @example
 * ```tsx
 * function ScrollComponent() {
 *   const [scrollY, setScrollY] = useState(0);
 *   const throttledScrollY = useThrottle(scrollY, 100);
 *
 *   useEffect(() => {
 *     const handleScroll = () => setScrollY(window.scrollY);
 *     window.addEventListener('scroll', handleScroll);
 *     return () => window.removeEventListener('scroll', handleScroll);
 *   }, []);
 *
 *   return <div>Scroll position: {throttledScrollY}</div>;
 * }
 * ```
 */
export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastExecutedRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastExecution = now - lastExecutedRef.current;

    if (timeSinceLastExecution >= interval) {
      // 如果已经超过间隔时间,立即更新
      lastExecutedRef.current = now;
      setThrottledValue(value);
    } else {
      // 否则设置定时器在剩余时间后更新
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        lastExecutedRef.current = Date.now();
        setThrottledValue(value);
      }, interval - timeSinceLastExecution);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, interval]);

  return throttledValue;
}

/**
 * useThrottledCallback Hook
 * 对回调函数进行节流处理
 *
 * @param callback - 要节流的回调函数
 * @param interval - 时间间隔(毫秒)
 * @returns 节流后的回调函数
 *
 * @example
 * ```tsx
 * function ResizableComponent() {
 *   const throttledResize = useThrottledCallback(() => {
 *     console.log('Resize handled');
 *   }, 200);
 *
 *   useEffect(() => {
 *     window.addEventListener('resize', throttledResize);
 *     return () => window.removeEventListener('resize', throttledResize);
 *   }, [throttledResize]);
 *
 *   return <div>Resize me</div>;
 * }
 * ```
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  interval: number
): (...args: Parameters<T>) => void {
  const lastExecutedRef = useRef<number>(0);
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

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastExecution = now - lastExecutedRef.current;

      if (timeSinceLastExecution >= interval) {
        lastExecutedRef.current = now;
        callbackRef.current(...args);
      } else {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
          lastExecutedRef.current = Date.now();
          callbackRef.current(...args);
        }, interval - timeSinceLastExecution);
      }
    },
    [interval]
  );
}
