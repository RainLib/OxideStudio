import { Slot } from "@radix-ui/react-slot";
import {
  Children,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EXPLORER_MENU_CONTENT_CLASS } from "./explorerStyles";

interface ExplorerContextMenuRegistration {
  readonly nodeId: string;
  readonly content: ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
}

type PrepareExplorerContextMenu = (
  registration: ExplorerContextMenuRegistration,
) => void;

const ExplorerContextMenuContext =
  createContext<PrepareExplorerContextMenu | null>(null);

interface ExplorerContextMenuHostProps {
  children: ReactElement;
}

/**
 * Owns one Radix context-menu root for an entire explorer subtree. Rows only
 * publish their immutable node identity and menu content when they are
 * actually right-clicked, avoiding hundreds of idle menu roots in large
 * directories.
 */
export function ExplorerContextMenuHost({
  children,
}: ExplorerContextMenuHostProps) {
  const parentPrepare = useContext(ExplorerContextMenuContext);
  if (parentPrepare) return children;
  return <ExplorerContextMenuRoot>{children}</ExplorerContextMenuRoot>;
}

function ExplorerContextMenuRoot({ children }: ExplorerContextMenuHostProps) {
  const [activeMenu, setActiveMenu] =
    useState<ExplorerContextMenuRegistration | null>(null);
  const activeMenuRef = useRef<ExplorerContextMenuRegistration | null>(null);
  const prepare = useCallback<PrepareExplorerContextMenu>((registration) => {
    activeMenuRef.current = registration;
    setActiveMenu(registration);
  }, []);

  return (
    <ExplorerContextMenuContext.Provider value={prepare}>
      <ContextMenu
        onOpenChange={(open) => activeMenuRef.current?.onOpenChange?.(open)}
      >
        <ContextMenuTrigger asChild>
          <div
            className="contents"
            onContextMenuCapture={(event) => {
              const target = event.target as HTMLElement;
              if (!target.closest("[data-explorer-context-menu-trigger]")) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            {children}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className={EXPLORER_MENU_CONTENT_CLASS}
          data-explorer-context-menu-node-id={activeMenu?.nodeId}
        >
          {activeMenu?.content}
        </ContextMenuContent>
      </ContextMenu>
    </ExplorerContextMenuContext.Provider>
  );
}

interface ExplorerContextMenuRowProps {
  readonly nodeId: string;
  readonly menu: ReactNode;
  readonly children: ReactElement;
  readonly onOpenChange?: (open: boolean) => void;
}

/** A layout-neutral row trigger consumed by the nearest shared host. */
export function ExplorerContextMenuRow({
  nodeId,
  menu,
  children,
  onOpenChange,
}: ExplorerContextMenuRowProps) {
  const prepare = useContext(ExplorerContextMenuContext);
  const registration = useMemo(
    () => ({ nodeId, content: menu, onOpenChange }),
    [menu, nodeId, onOpenChange],
  );
  if (!prepare) {
    throw new Error("ExplorerContextMenuRow requires ExplorerContextMenuHost");
  }
  return (
    <Slot
      data-explorer-context-menu-trigger
      onContextMenu={(event) => {
        const closestTrigger = (event.target as HTMLElement).closest(
          "[data-explorer-context-menu-trigger]",
        );
        if (closestTrigger === event.currentTarget) {
          prepare(registration);
        }
      }}
    >
      {children}
    </Slot>
  );
}

interface ExplorerSharedContextMenuProps {
  readonly nodeId: string;
  readonly children: ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * Drop-in migration adapter for existing ContextMenuTrigger/Content pairs.
 * It keeps their call-site menu markup while delegating ownership to the
 * nearest ExplorerContextMenuHost.
 */
export function ExplorerSharedContextMenu({
  nodeId,
  children,
  onOpenChange,
}: ExplorerSharedContextMenuProps) {
  const elements = Children.toArray(children).filter(isValidElement);
  const trigger = elements[0] as ReactElement<{
    children?: ReactNode;
  }> | null;
  const content = elements[1] as ReactElement<{
    children?: ReactNode;
  }> | null;
  if (!trigger || !content || !isValidElement(trigger.props.children)) {
    throw new Error(
      "ExplorerSharedContextMenu requires trigger and content children",
    );
  }
  return (
    <ExplorerContextMenuRow
      nodeId={nodeId}
      menu={content.props.children}
      onOpenChange={onOpenChange}
    >
      {trigger.props.children}
    </ExplorerContextMenuRow>
  );
}
