import {
  NotificationListItem,
  type NotificationListItemNotification,
  NotificationPopover,
} from '@seta/shared-ui';
import { Bell } from 'lucide-react';
import type * as React from 'react';
import { useResolvePlannerNotification } from '../../planner/notifications/renderers';
import { useDismiss, useMarkAllRead, useMarkRead } from '../hooks/mutations';
import { useNotifications } from '../hooks/useNotifications';
import { useUnreadCount } from '../hooks/useUnreadCount';

export function NotificationPopoverContainer(): React.ReactElement {
  const { items, hasNextPage, fetchNextPage, isFetchingNextPage } = useNotifications({
    unread: false,
  });
  const { count } = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const dismiss = useDismiss();

  const trigger = (
    <button
      type="button"
      className="relative inline-flex size-6 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      aria-label={count > 0 ? `Notifications (${count})` : 'Notifications'}
      title="Notifications"
    >
      <Bell className="size-3.5" aria-hidden />
      {count > 0 && (
        <span
          className="absolute right-0.5 top-0.5 inline-block size-1.5 rounded-full bg-primary"
          aria-hidden
        />
      )}
    </button>
  );

  return (
    <NotificationPopover
      trigger={trigger}
      items={items}
      hasMore={hasNextPage}
      isLoadingMore={isFetchingNextPage}
      unreadCount={count}
      onMarkAll={() => markAll.mutate()}
      onLoadMore={() => {
        void fetchNextPage();
      }}
      onMarkRead={(id) => markRead.mutate(id)}
      onDismiss={(id) => dismiss.mutate(id)}
      renderItem={(n) => (
        <PopoverRow
          notification={n}
          onMarkRead={(id) => markRead.mutate(id)}
          onDismiss={(id) => dismiss.mutate(id)}
        />
      )}
    />
  );
}

function PopoverRow({
  notification,
  onMarkRead,
  onDismiss,
}: {
  notification: NotificationListItemNotification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}): React.ReactElement {
  const { icon, onClick } = useResolvePlannerNotification(notification);
  return (
    <NotificationListItem
      notification={notification}
      onMarkRead={onMarkRead}
      onDismiss={onDismiss}
      icon={icon}
      onClick={onClick}
    />
  );
}
