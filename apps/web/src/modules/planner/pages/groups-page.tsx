import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@seta/shared-ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { CreateGroupDialog } from '../components/CreateGroupDialog';
import { useMyGroups } from '../hooks/queries/use-my-groups';

interface Props {
  /** When true, the user can create new groups. Gated by org.admin / tenant.admin / planner.admin. */
  canCreateGroup?: boolean;
}

export function GroupsPage({ canCreateGroup = false }: Props) {
  const q = useMyGroups();
  const [createOpen, setCreateOpen] = useState(false);

  if (q.isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no semantic identity
            key={i}
            data-testid="skeleton-card"
            className="h-32 w-full rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (q.isError) {
    return (
      <div
        role="alert"
        className="m-6 rounded-md border border-destructive/40 bg-destructive/10 p-4"
      >
        <h2 className="text-card-title text-ink">Couldn't load groups</h2>
        <p className="mt-1 text-body-sm text-ink-subtle">
          {q.error instanceof Error ? q.error.message : 'Unknown error.'}
        </p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => q.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (q.data.length === 0) {
    return (
      <>
        {canCreateGroup ? (
          <EmptyState
            title="Create your first group"
            description="Groups hold plans and members. Start one for the team or project you're working with."
            action={{ label: 'Create group', onClick: () => setCreateOpen(true) }}
          />
        ) : (
          <EmptyState
            title="You're not in any groups yet"
            description="Ask your tenant admin to add you to a group."
          />
        )}
        <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  return (
    <div className="p-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-display-md text-ink">Groups</h1>
          <p className="mt-1 text-body-sm text-ink-subtle">
            {q.data.length} {q.data.length === 1 ? 'group' : 'groups'}
          </p>
        </div>
        {canCreateGroup && (
          <Button size="sm" onClick={() => setCreateOpen(true)} aria-label="Create group">
            + Create group
          </Button>
        )}
      </header>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {q.data.map((g) => (
          <li key={g.id}>
            <Link
              to="/planner/groups/$groupId"
              params={{ groupId: g.id }}
              className="block focus-visible:outline-none"
            >
              <Card className="h-full transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-primary">
                <CardHeader className="flex flex-row items-start gap-3 pb-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                    aria-hidden
                  >
                    <span className="font-semibold text-sm uppercase">{g.name.slice(0, 2)}</span>
                  </div>
                  <CardTitle className="truncate text-card-title">{g.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-body-sm text-ink-subtle">
                    Last activity {new Date(g.updated_at).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
