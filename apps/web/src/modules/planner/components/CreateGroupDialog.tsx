import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@seta/shared-ui';
import { useState } from 'react';
import { useCreateGroup } from '../hooks/mutations/create-group';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (groupName: string) => void;
}

export function CreateGroupDialog({ open, onOpenChange, onCreated }: Props) {
  const createGroup = useCreateGroup();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setError(null);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    createGroup.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          onCreated?.(trimmed);
          reset();
          onOpenChange(false);
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create group.'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a group</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-body-sm text-ink-subtle">
            Groups hold plans and members. Use one per team, project, or initiative.
          </p>
          <div className="space-y-1">
            <Label htmlFor="create-group-name">Name</Label>
            <Input
              id="create-group-name"
              // biome-ignore lint/a11y/noAutofocus: dialog opens explicitly on user action
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="e.g. Engineering"
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!name.trim()}>
              Create group
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
