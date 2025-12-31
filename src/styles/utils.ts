import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn() - 智能合并 Tailwind CSS 类名
 *
 * 结合了 clsx 和 tailwind-merge 的能力：
 * - clsx: 条件类名组合
 * - tailwind-merge: 智能去重和冲突解决
 *
 * @example
 * cn('px-2 py-1', 'px-4') // => 'py-1 px-4' (px-2 被 px-4 覆盖)
 * cn('text-red-500', condition && 'text-blue-500') // 条件类名
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
