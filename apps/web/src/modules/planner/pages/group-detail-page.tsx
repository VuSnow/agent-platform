import {
  AvatarStack,
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@seta/shared-ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { CreatePlanDialog } from '../components/CreatePlanDialog';
import { RenameGroupDialog } from '../components/RenameGroupDialog';
import { useGroup } from '../hooks/queries/use-group';
import { useGroupMembers } from '../hooks/queries/use-group-members';
import { useGroupPlans } from '../hooks/queries/use-group-plans';

export type GroupDetailTab = 'plans' | 'members' | 'settings';

export interface GroupDetailSession {
  role_summary: { roles: string[]; cross_tenant_read: boolean };
  accessible_group_ids: ReadonlyArray<string>;
}

interface Props {
  groupId: string;
  tab: GroupDetailTab;
  onTabChange: (tab: GroupDetailTab) => void;
  session: GroupDetailSession;
}

function canManageGroup(session: GroupDetailSession, groupId: string): boolean {
  const roles = session.role_summary.roles;
  if (roles.includes('org.admin') || roles.includes('tenant.admin')) return true;
  return roles.includes('planner.admin') && session.accessible_group_ids.includes(groupId);
}

export function GroupDetailPage({ groupId, tab, onTabChange, session }: Props) {
  const groupQ = useGroup(groupId);
  const plansQ = useGroupPlans(groupId);
  const membersQ = useGroupMembers(groupId);
  const canManage = canManageGroup(session, groupId);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  if (groupQ.isPending) {
    return <Skeleton data-testid="skeleton-detail" className="m-6 h-24 w-full" />;
  }
  if (groupQ.isError) {
    return (
      <div role="alert" className="m-6">
        Couldn't load this group.
      </div>
    );
  }

  const group = groupQ.data;
  const planCount = plansQ.data?.length ?? 0;
  const memberCount = membersQ.data?.length ?? 0;

  return (
    <div className="p-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
            aria-hidden
          >
            <span className="font-semibold text-base uppercase">{group.name.slice(0, 2)}</span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-display-md text-ink">{group.name}</h1>
            <p className="mt-1 text-body-sm text-ink-subtle">
              {memberCount} {memberCount === 1 ? 'member' : 'members'} · {planCount}{' '}
              {planCount === 1 ? 'plan' : 'plans'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {membersQ.data && membersQ.data.length > 0 && (
            <AvatarStack
              max={5}
              assignees={membersQ.data.map((m) => ({
                user_id: m.user_id,
                display_name: m.display_name,
              }))}
            />
          )}
          {canManage && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRenameOpen(true)}
              aria-label="Rename group"
            >
              Rename
            </Button>
          )}
        </div>
      </header>
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as GroupDetailTab)}>
        <TabsList>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          {canManage && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>

        <TabsContent value="plans">
          {plansQ.isPending && (
            <Skeleton data-testid="skeleton-plans" className="mt-4 h-16 w-full" />
          )}
          {plansQ.data && plansQ.data.length > 0 && (
            <>
              <div className="mt-4 mb-3 flex items-center justify-between">
                <p className="text-body-sm text-ink-subtle">
                  {plansQ.data.length} {plansQ.data.length === 1 ? 'plan' : 'plans'}
                </p>
                {canManage && (
                  <Button size="sm" onClick={() => setCreatePlanOpen(true)}>
                    + New plan
                  </Button>
                )}
              </div>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {plansQ.data.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/planner/plans/$planId"
                      params={{ planId: p.id }}
                      className="block rounded-md border border-surface-3 bg-surface-1 p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary/10 text-primary"
                          aria-hidden
                        >
                          <span className="font-medium text-xs uppercase">
                            {p.name.slice(0, 2)}
                          </span>
                        </span>
                        <span className="truncate font-medium text-ink">{p.name}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {plansQ.data?.length === 0 && (
            <EmptyState
              title="Create your first plan"
              description="A plan groups buckets and tasks for one stream of work."
              action={
                canManage
                  ? { label: 'Create plan', onClick: () => setCreatePlanOpen(true) }
                  : undefined
              }
            />
          )}
        </TabsContent>

        <TabsContent value="members">
          {membersQ.isPending && (
            <Skeleton data-testid="skeleton-members" className="mt-4 h-16 w-full" />
          )}
          {membersQ.data && (
            <table className="mt-4 w-full text-left text-body-sm">
              <thead className="text-ink-subtle">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2">Added</th>
                </tr>
              </thead>
              <tbody>
                {membersQ.data.map((m) => (
                  <tr key={m.user_id} className="border-t border-surface-3">
                    <td className="py-2 pr-4">{m.display_name}</td>
                    <td className="py-2 pr-4">{m.email}</td>
                    <td className="py-2">{new Date(m.added_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabsContent>

        {canManage && (
          <TabsContent value="settings">
            <p className="mt-4 text-ink-subtle">Group settings — rename, archive — coming soon.</p>
          </TabsContent>
        )}
      </Tabs>

      <CreatePlanDialog groupId={groupId} open={createPlanOpen} onOpenChange={setCreatePlanOpen} />
      <RenameGroupDialog
        groupId={groupId}
        currentName={group.name}
        version={group.version}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
    </div>
  );
}
