import type * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import {
  NotificationListItem,
  type NotificationListItemNotification,
} from './notification-list-item';

export interface NotificationPopoverProps {
  /** The element that triggers the popover (e.g. the bell button). */
  trigger: React.ReactNode;
  items: NotificationListItemNotification[];
  hasMore: boolean;
  unreadCount: number;
  onMarkAll: () => void;
  onLoadMore: () => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  isLoadingMore?: boolean;
  renderItem?: (n: NotificationListItemNotification) => React.ReactNode;
}

export function NotificationPopover({
  trigger,
  items,
  hasMore,
  unreadCount,
  onMarkAll,
  onLoadMore,
  onMarkRead,
  onDismiss,
  isLoadingMore = false,
  renderItem,
}: NotificationPopoverProps): React.ReactElement {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="flex w-[calc(100vw-16px)] flex-col p-0 sm:w-[400px]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
          <span className="text-body-sm font-semibold text-ink">Notifications</span>
          <button
            type="button"
            disabled={unreadCount === 0}
            onClick={onMarkAll}
            className="text-caption text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:text-ink-subtle"
          >
            Mark all as read
          </button>
        </div>
        <div
          className="min-h-[160px] overflow-y-auto overscroll-contain"
          style={{ maxHeight: 'min(480px, 60svh)' }}
        >
          {items.length === 0 ? (
            <div className="flex h-[160px] items-center justify-center text-caption text-ink-muted">
              No notifications yet.
            </div>
          ) : (
            <>
              {items.map((n) => (
                <article key={n.id}>
                  {renderItem ? (
                    renderItem(n)
                  ) : (
                    <NotificationListItem
                      notification={n}
                      onMarkRead={onMarkRead}
                      onDismiss={onDismiss}
                    />
                  )}
                </article>
              ))}
              {hasMore && (
                <div className="flex justify-center p-3">
                  <button
                    type="button"
                    onClick={onLoadMore}
                    disabled={isLoadingMore}
                    className="text-caption text-ink-muted hover:text-ink disabled:text-ink-subtle"
                  >
                    {isLoadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
