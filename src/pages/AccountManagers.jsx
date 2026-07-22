import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

const PAGE_SIZE = 100;
const UNASSIGNED_FILTER = '__unassigned__';
const ROLE_LABELS = {
  buyer: 'Buyer',
  buyer_supplier: 'Buyer & Supplier',
  broker: 'Broker',
};

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' });
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function sameIds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function SummaryMetric({ label, value }) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
    </div>
  );
}

function ManagerCoverage({ managers, assignmentSource, inheritedFromGroupName }) {
  if (!managers.length) {
    return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Unassigned</Badge>;
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {managers.map((manager, index) => (
          <Badge key={manager.id} variant="outline" className={manager.active ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-red-200 bg-red-50 text-red-700'}>
            <span className="mr-1 font-semibold tabular-nums">{index + 1}.</span>
            {manager.fullName}{manager.active ? '' : ' (inactive)'}
          </Badge>
        ))}
      </div>
      {assignmentSource === 'group' && inheritedFromGroupName && (
        <div className="mt-1.5 text-xs text-muted-foreground">Inherited from {inheritedFromGroupName}</div>
      )}
    </div>
  );
}

function RoleBadges({ roles, isGroupAccount }) {
  if (isGroupAccount) {
    return <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-800">Group</Badge>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {(roles || []).map((role) => (
        <Badge key={role} variant="outline" className={role === 'broker'
          ? 'border-violet-200 bg-violet-50 text-violet-800'
          : role === 'buyer_supplier'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-sky-200 bg-sky-50 text-sky-800'}>
          {ROLE_LABELS[role] || role}
        </Badge>
      ))}
    </div>
  );
}

export default function AccountManagers() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedManagerKeys, setSelectedManagerKeys] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingKey, setEditingKey] = useState('');
  const [draftManagers, setDraftManagers] = useState([]);
  const [managerPropagateToChildren, setManagerPropagateToChildren] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [retryingKey, setRetryingKey] = useState('');
  const [noteEditingKey, setNoteEditingKey] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [notePropagateToChildren, setNotePropagateToChildren] = useState(false);
  const [noteSavingKey, setNoteSavingKey] = useState('');
  const [groupEditAccount, setGroupEditAccount] = useState(null);
  const [groupNoteEditAccount, setGroupNoteEditAccount] = useState(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const nextDraftKey = useRef(0);

  const loadAccounts = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('accountManagersList', {}, { force: true });
    if (response.data?.error) {
      setError(response.data.error);
    } else {
      setAccounts(response.data?.accounts || []);
      setUsers(response.data?.users || []);
      if (!background) {
        setCurrentPage(1);
        setSelectedManagerKeys(null);
        setEditingKey('');
        setDraftManagers([]);
        setManagerPropagateToChildren(false);
        setNoteEditingKey('');
        setNoteDraft('');
        setNotePropagateToChildren(false);
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const draftManagerIds = useMemo(() => draftManagers.map((manager) => manager.userId), [draftManagers]);
  const activeUsers = useMemo(() => users
    .filter((user) => user.active)
    .sort((left, right) => compareText(left.fullName || left.email, right.fullName || right.email)), [users]);

  const managerFilterOptions = useMemo(() => {
    const assignedIds = new Set(accounts.flatMap((account) => account.managers.map((manager) => manager.id)));
    const assignedUsers = users
      .filter((user) => assignedIds.has(user.id))
      .sort((left, right) => compareText(left.fullName || left.email, right.fullName || right.email));
    return [
      { key: UNASSIGNED_FILTER, label: 'Unassigned' },
      ...assignedUsers.map((user) => ({ key: user.id, label: user.fullName || user.email })),
    ];
  }, [accounts, users]);
  const allManagerFilterKeys = useMemo(() => managerFilterOptions.map((option) => option.key), [managerFilterOptions]);
  const effectiveManagerKeys = selectedManagerKeys === null ? allManagerFilterKeys : selectedManagerKeys;
  const allManagersSelected = effectiveManagerKeys.length === allManagerFilterKeys.length;

  const stats = useMemo(() => ({
    total: accounts.length,
    unassigned: accounts.filter((account) => account.managerCount === 0).length,
    assigned: accounts.filter((account) => account.managerCount > 0).length,
    syncIssues: accounts.filter((account) => account.salesforceSyncStatus !== 'synced').length,
  }), [accounts]);

  const filteredAccounts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const selected = new Set(effectiveManagerKeys);
    const filterActive = effectiveManagerKeys.length !== allManagerFilterKeys.length;
    return accounts.filter((account) => {
      if (filterActive) {
        if (!account.managers.length && !selected.has(UNASSIGNED_FILTER)) return false;
        if (account.managers.length && !account.managers.some((manager) => selected.has(manager.id))) return false;
      }
      if (!keyword) return true;
      const searchable = [
        account.accountName,
        account.isGroupAccount ? 'Group' : '',
        ...(account.parentGroupNames || []),
        ...(account.childAccountNames || []),
        ...(account.roles || []).map((role) => ROLE_LABELS[role] || role),
        ...account.managers.flatMap((manager) => [manager.fullName, manager.email]),
        account.accountNote,
      ].join(' ').toLowerCase();
      return searchable.includes(keyword);
    });
  }, [accounts, allManagerFilterKeys.length, effectiveManagerKeys, search]);

  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const visiblePage = Math.min(currentPage, pageCount);
  const paginatedAccounts = useMemo(() => {
    const start = (visiblePage - 1) * PAGE_SIZE;
    return filteredAccounts.slice(start, start + PAGE_SIZE);
  }, [filteredAccounts, visiblePage]);

  const replaceAccount = (savedAccount) => {
    setAccounts((current) => current.map((account) => account.accountNameKey === savedAccount.accountNameKey
      ? { ...account, ...savedAccount }
      : account));
  };

  const beginEdit = (account, { propagateToChildren = false } = {}) => {
    setEditingKey(account.accountNameKey);
    setDraftManagers(account.managers.map((manager) => ({ key: `manager-${manager.id}`, userId: manager.id })));
    setManagerPropagateToChildren(account.isGroupAccount && propagateToChildren);
  };

  const requestEdit = (account) => {
    if (account.isGroupAccount) {
      setGroupEditAccount(account);
      return;
    }
    beginEdit(account);
  };

  const cancelEdit = () => {
    if (savingKey) return;
    setEditingKey('');
    setDraftManagers([]);
    setManagerPropagateToChildren(false);
  };

  const addManager = () => {
    if (draftManagerIds.length >= 3 || draftManagerIds.some((userId) => !userId)) return;
    nextDraftKey.current += 1;
    setDraftManagers((current) => [...current, { key: `draft-${nextDraftKey.current}`, userId: '' }]);
  };

  const changeManager = (index, userId) => {
    setDraftManagers((current) => current.map((manager, itemIndex) => itemIndex === index
      ? { ...manager, userId }
      : manager));
  };

  const removeManager = (index) => {
    setDraftManagers((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const reorderManagers = ({ source, destination }) => {
    if (!destination || source.index === destination.index) return;
    setDraftManagers((current) => {
      const reordered = current.slice();
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, moved);
      return reordered;
    });
  };

  const saveAccount = async (account) => {
    const invalid = draftManagerIds.some((userId) => !userId || !usersById.get(userId)?.active);
    if (invalid) return;
    setSavingKey(account.accountNameKey);
    const response = await appClient.functions.invoke('accountManagersSave', {
      accountNameKey: account.accountNameKey,
      accountName: account.accountName,
      managerUserIds: draftManagerIds,
      expectedRevision: account.revision,
      propagateToChildren: account.isGroupAccount && managerPropagateToChildren,
    });
    setSavingKey('');

    if (response.data?.error) {
      toast({ title: 'Account managers not saved', description: response.data.error, variant: 'destructive' });
      return;
    }

    replaceAccount(response.data.account);
    setEditingKey('');
    setDraftManagers([]);
    setManagerPropagateToChildren(false);
    if (account.isGroupAccount) await loadAccounts({ background: true });
    if (response.data.syncError) {
      toast({ title: 'Saved with a Salesforce sync issue', description: response.data.syncError, variant: 'destructive' });
    } else {
      toast({
        title: 'Account managers updated',
        description: draftManagerIds.length
          ? `${account.accountName}: ${draftManagerIds.length} manager${draftManagerIds.length === 1 ? '' : 's'}`
          : `${account.accountName}: unassigned`,
      });
    }
  };

  const retrySync = async (account) => {
    setRetryingKey(account.accountNameKey);
    const response = await appClient.functions.invoke('accountManagersRetrySync', {
      accountNameKey: account.accountNameKey,
    });
    setRetryingKey('');
    if (response.data?.error) {
      toast({ title: 'Salesforce sync not completed', description: response.data.error, variant: 'destructive' });
      return;
    }
    replaceAccount(response.data.account);
    if (account.isGroupAccount) await loadAccounts({ background: true });
    if (response.data.syncError) {
      toast({ title: 'Salesforce sync not completed', description: response.data.syncError, variant: 'destructive' });
    } else {
      toast({ title: 'Salesforce synchronized', description: account.accountName });
    }
  };

  const beginNoteEdit = (account, { propagateToChildren = false } = {}) => {
    setNoteEditingKey(account.accountNameKey);
    setNoteDraft(account.accountNote || '');
    setNotePropagateToChildren(account.isGroupAccount && propagateToChildren);
  };

  const requestNoteEdit = (account) => {
    if (account.isGroupAccount) {
      setGroupNoteEditAccount(account);
      return;
    }
    beginNoteEdit(account);
  };

  const cancelNoteEdit = () => {
    if (noteSavingKey) return;
    setNoteEditingKey('');
    setNoteDraft('');
    setNotePropagateToChildren(false);
  };

  const saveNote = async (account) => {
    const accountNote = noteDraft.trim();
    if (Array.from(accountNote).length > 255) return;
    setNoteSavingKey(account.accountNameKey);
    const response = await appClient.functions.invoke('accountManagersSaveNote', {
      accountNameKey: account.accountNameKey,
      accountName: account.accountName,
      accountNote,
      expectedRevision: account.noteRevision,
      propagateToChildren: account.isGroupAccount && notePropagateToChildren,
    });
    setNoteSavingKey('');

    if (response.data?.error) {
      toast({ title: 'Account note not saved', description: response.data.error, variant: 'destructive' });
      return;
    }

    replaceAccount(response.data.note);
    setNoteEditingKey('');
    setNoteDraft('');
    setNotePropagateToChildren(false);
    if (account.isGroupAccount && notePropagateToChildren) await loadAccounts({ background: true });
    toast({
      title: 'Account note updated',
      description: response.data.propagatedChildCount
        ? `${account.accountName} and ${response.data.propagatedChildCount} child Account name${response.data.propagatedChildCount === 1 ? '' : 's'}`
        : accountNote ? account.accountName : `${account.accountName}: note cleared`,
    });
  };

  const toggleManagerFilter = (key) => {
    setSelectedManagerKeys((current) => {
      const selected = current === null ? allManagerFilterKeys : current;
      return selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key];
    });
    setCurrentPage(1);
  };

  return (
    <div className="min-w-0 pb-8">
      <PageHeader
        icon={UsersRound}
        title="Account Managers"
        meta={`${stats.total.toLocaleString()} active Account names`}
        actions={(
          <>
            <Button variant="outline" onClick={() => setMethodologyOpen(true)}>
              <CircleHelp />
              Methodology
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => loadAccounts({ background: true })}
              disabled={loading || refreshing}
              aria-label="Refresh Accounts"
              title="Refresh Accounts"
            >
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            </Button>
          </>
        )}
      />

      <div className="mb-5 grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <SummaryMetric label="Account names" value={stats.total} />
        <SummaryMetric label="Unassigned" value={stats.unassigned} />
        <SummaryMetric label="With managers" value={stats.assigned} />
        <SummaryMetric label="Sync issues" value={stats.syncIssues} />
      </div>

      <TableShell
        title="Account Ownership"
        meta={`${filteredAccounts.length.toLocaleString()} of ${accounts.length.toLocaleString()} names`}
        bodyClassName="p-0"
        actions={(
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
              placeholder="Search Accounts, groups or managers"
              aria-label="Search Accounts, groups or managers"
            />
          </div>
        )}
      >
        {!loading && !error && accounts.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Account Manager</Label>
              <button
                type="button"
                onClick={() => {
                  setSelectedManagerKeys(allManagersSelected ? [] : null);
                  setCurrentPage(1);
                }}
                className="text-xs text-primary hover:underline"
              >
                {allManagersSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {managerFilterOptions.map((option) => {
                const selected = effectiveManagerKeys.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => toggleManagerFilter(option.key)}
                    className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/50'}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <StateBlock icon={Loader2} title="Loading Accounts..." description="Reading active Accounts and manager assignments." />
        ) : error ? (
          <StateBlock
            icon={CircleAlert}
            title="Accounts could not be loaded"
            description={error}
            action={<Button variant="outline" onClick={() => loadAccounts()}>Try again</Button>}
          />
        ) : filteredAccounts.length ? (
          <>
            <Table className="min-w-[1400px]">
              <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Account Type</TableHead>
                  <TableHead>Account Managers</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedAccounts.map((account) => {
                  const editing = editingKey === account.accountNameKey;
                  const saving = savingKey === account.accountNameKey;
                  const noteEditing = noteEditingKey === account.accountNameKey;
                  const noteSaving = noteSavingKey === account.accountNameKey;
                  const invalidSelection = draftManagerIds.some((userId) => !userId || !usersById.get(userId)?.active);
                  const managerScopeDirty = account.isGroupAccount
                    && managerPropagateToChildren !== account.propagateToChildren;
                  const dirty = editing && (
                    !sameIds(draftManagerIds, account.managers.map((manager) => manager.id))
                    || managerScopeDirty
                  );
                  const normalizedNoteDraft = noteDraft.trim();
                  const noteDirty = noteEditing && (
                    normalizedNoteDraft !== (account.accountNote || '')
                    || account.isGroupAccount && notePropagateToChildren
                  );
                  const noteLength = Array.from(noteDraft).length;
                  const noMoreUsers = draftManagerIds.length >= 3
                    || draftManagerIds.some((userId) => !userId)
                    || !activeUsers.some((user) => !draftManagerIds.includes(user.id));
                  return (
                    <TableRow key={account.accountNameKey} className={editing || noteEditing ? 'bg-muted/25' : undefined}>
                      <TableCell className="min-w-[250px] align-top">
                        <div className="font-medium text-foreground">{account.accountName}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {account.salesforceAccountCount} active Salesforce Account{account.salesforceAccountCount === 1 ? '' : 's'}
                        </div>
                        {account.isGroupAccount ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {account.childAccountCount} active listed child Account{account.childAccountCount === 1 ? '' : 's'}
                          </div>
                        ) : account.parentGroupNames?.length ? (
                          <div className="mt-1 text-xs text-muted-foreground">Group: {account.parentGroupNames.join(', ')}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-[190px] align-top">
                        <RoleBadges roles={account.roles} isGroupAccount={account.isGroupAccount} />
                      </TableCell>
                      <TableCell className="min-w-[390px] align-top">
                        {editing ? (
                          <div className="space-y-2">
                            {draftManagers.length ? (
                              <DragDropContext onDragEnd={reorderManagers}>
                                <Droppable droppableId={`account-manager-priority-${account.accountNameKey}`}>
                                  {(droppableProvided) => (
                                    <div ref={droppableProvided.innerRef} {...droppableProvided.droppableProps} className="space-y-2">
                                      {draftManagers.map((draftManager, index) => {
                                        const selectedUser = usersById.get(draftManager.userId);
                                        return (
                                          <Draggable key={draftManager.key} draggableId={draftManager.key} index={index} isDragDisabled={saving}>
                                            {(draggableProvided, draggableSnapshot) => (
                                              <div
                                                ref={draggableProvided.innerRef}
                                                {...draggableProvided.draggableProps}
                                                className={`flex min-w-0 items-center gap-2 rounded-md border bg-background p-1 ${draggableSnapshot.isDragging ? 'border-primary shadow-lg' : 'border-border'}`}
                                              >
                                                <button
                                                  type="button"
                                                  {...draggableProvided.dragHandleProps}
                                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                                  aria-label={`Move priority ${index + 1}`}
                                                  title="Drag to change priority"
                                                >
                                                  <GripVertical className="h-4 w-4" />
                                                </button>
                                                <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                                                <Select value={draftManager.userId || undefined} onValueChange={(value) => changeManager(index, value)} disabled={saving}>
                                                  <SelectTrigger className="h-9 min-w-0 flex-1" aria-label={`Account manager priority ${index + 1}`}>
                                                    <SelectValue placeholder="Select a manager" />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {users
                                                      .slice()
                                                      .sort((left, right) => compareText(left.fullName || left.email, right.fullName || right.email))
                                                      .map((user) => (
                                                        <SelectItem
                                                          key={user.id}
                                                          value={user.id}
                                                          disabled={!user.active || draftManagerIds.some((selectedId, selectedIndex) => selectedIndex !== index && selectedId === user.id)}
                                                        >
                                                          {user.fullName || user.email}{user.active ? '' : ' · Inactive'}
                                                        </SelectItem>
                                                      ))}
                                                  </SelectContent>
                                                </Select>
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="icon"
                                                  onClick={() => removeManager(index)}
                                                  disabled={saving}
                                                  aria-label={`Remove ${selectedUser?.fullName || selectedUser?.email || 'manager'}`}
                                                  title="Remove manager"
                                                >
                                                  <Trash2 />
                                                </Button>
                                              </div>
                                            )}
                                          </Draggable>
                                        );
                                      })}
                                      {droppableProvided.placeholder}
                                    </div>
                                  )}
                                </Droppable>
                              </DragDropContext>
                            ) : (
                              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Unassigned</Badge>
                            )}
                            <Button type="button" variant="outline" size="sm" onClick={addManager} disabled={saving || noMoreUsers}>
                              <Plus />
                              Add manager
                            </Button>
                            {account.isGroupAccount && (
                              <div className="text-xs font-medium text-muted-foreground">
                                Save scope: {managerPropagateToChildren ? 'GROUP + children' : 'GROUP only'}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <ManagerCoverage
                              managers={account.managers}
                              assignmentSource={account.assignmentSource}
                              inheritedFromGroupName={account.inheritedFromGroupName}
                            />
                            {account.isGroupAccount && account.propagateToChildren && (
                              <div className="mt-1.5 text-xs text-muted-foreground">Child Accounts inherit this priority.</div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[320px] max-w-[420px] align-top">
                        {noteEditing ? (
                          <div className="space-y-2">
                            <Textarea
                              value={noteDraft}
                              onChange={(event) => setNoteDraft(event.target.value)}
                              maxLength={255}
                              rows={3}
                              disabled={noteSaving}
                              className="min-h-20 resize-y"
                              aria-label={`Note for ${account.accountName}`}
                              placeholder="Add an internal Account note"
                            />
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs text-muted-foreground">
                                <span className="tabular-nums">{noteLength}/255</span>
                                {account.isGroupAccount && (
                                  <span className="ml-2 font-medium">Save scope: {notePropagateToChildren ? 'GROUP + children' : 'GROUP only'}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={cancelNoteEdit}
                                  disabled={noteSaving}
                                  aria-label="Cancel note changes"
                                  title="Cancel note changes"
                                >
                                  <X />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  onClick={() => saveNote(account)}
                                  disabled={noteSaving || !noteDirty || noteLength > 255}
                                  aria-label="Save Account note"
                                  title="Save Account note"
                                >
                                  {noteSaving ? <Loader2 className="animate-spin" /> : <Check />}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className={`max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm ${account.accountNote ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {account.accountNote || 'No note'}
                              </div>
                              {account.noteUpdatedAt && (
                                <div className="mt-1.5 text-xs text-muted-foreground">
                                  Updated {formatDateTime(account.noteUpdatedAt)}
                                  {account.noteUpdatedByEmail ? ` by ${account.noteUpdatedByEmail}` : ''}
                                </div>
                              )}
                              {account.noteSourceGroupAccountName && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Applied from {account.noteSourceGroupAccountName}
                                </div>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => requestNoteEdit(account)}
                              disabled={Boolean(noteEditingKey || editingKey || retryingKey || savingKey || noteSavingKey)}
                              aria-label={`Edit note for ${account.accountName}`}
                              title="Edit Account note"
                              className="shrink-0"
                            >
                              <Pencil />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[190px] align-top text-xs">
                        <div>{formatDateTime(account.updatedAt)}</div>
                        {account.updatedByEmail && <div className="mt-0.5 truncate text-muted-foreground">{account.updatedByEmail}</div>}
                        {account.salesforceSyncStatus !== 'synced' && (
                          <Badge
                            variant="outline"
                            className={`mt-2 ${account.salesforceSyncStatus === 'failed'
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-amber-300 bg-amber-50 text-amber-800'}`}
                            title={account.salesforceSyncError || 'Salesforce differs from FCOS'}
                          >
                            {account.salesforceSyncStatus === 'failed' ? 'Sync failed' : 'Needs sync'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex justify-end gap-1">
                          {editing ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={cancelEdit}
                                disabled={saving}
                                aria-label="Cancel changes"
                                title="Cancel changes"
                              >
                                <X />
                              </Button>
                              <Button
                                size="icon"
                                onClick={() => saveAccount(account)}
                                disabled={saving || invalidSelection || !dirty}
                                aria-label="Save Account managers"
                                title="Save Account managers"
                              >
                                {saving ? <Loader2 className="animate-spin" /> : <Check />}
                              </Button>
                            </>
                          ) : (
                            <>
                              {account.salesforceSyncStatus !== 'synced' && account.revision > 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => retrySync(account)}
                                  disabled={Boolean(retryingKey || savingKey || noteEditingKey || noteSavingKey)}
                                  aria-label="Retry Salesforce sync"
                                  title="Retry Salesforce sync"
                                >
                                  <RotateCcw className={retryingKey === account.accountNameKey ? 'animate-spin' : ''} />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => requestEdit(account)}
                                disabled={Boolean(editingKey || retryingKey || savingKey || noteEditingKey || noteSavingKey)}
                                aria-label={`Edit managers for ${account.accountName}`}
                                title="Edit Account managers"
                              >
                                <Pencil />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <div className="text-xs text-muted-foreground">
                Showing {((visiblePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(visiblePage * PAGE_SIZE, filteredAccounts.length).toLocaleString()} of {filteredAccounts.length.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={visiblePage <= 1}
                  aria-label="Previous page"
                  title="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <span className="min-w-24 text-center text-xs font-medium text-foreground">Page {visiblePage} of {pageCount}</span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                  disabled={visiblePage >= pageCount}
                  aria-label="Next page"
                  title="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <StateBlock title="No Accounts found" description="No active Account names match the current filters." />
        )}
      </TableShell>

      <Dialog open={methodologyOpen} onOpenChange={setMethodologyOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Account Managers Methodology</DialogTitle>
            <DialogDescription>How Account coverage, manager priority, GROUP propagation, and synchronization work.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 text-sm text-foreground">
            <section>
              <h3 className="font-semibold">Account coverage</h3>
              <p className="mt-1 text-muted-foreground">
                The directory shows active Buyer, Buyer &amp; Supplier, Broker, and GROUP Account names. GROUP Accounts appear first. Same-name Salesforce Account records are managed together; inactive and supplier-only Accounts are not listed.
              </p>
            </section>
            <section>
              <h3 className="font-semibold">Manager priority</h3>
              <p className="mt-1 text-muted-foreground">
                Each Account can have up to three managers. Priority 1 is highest. Drag the handle to reorder managers, then use Save to apply the ordered list.
              </p>
            </section>
            <section>
              <h3 className="font-semibold">GROUP Accounts</h3>
              <p className="mt-1 text-muted-foreground">
                Every GROUP manager edit asks for a scope. GROUP only updates the GROUP Account in FCOS and Salesforce, turns off child inheritance, and leaves existing child Salesforce values and direct FCOS assignments unchanged. GROUP + children writes the ordered list to the GROUP and every direct child Salesforce Account, turns on inheritance, and replaces direct child FCOS manager overrides.
              </p>
            </section>
            <section>
              <h3 className="font-semibold">Salesforce synchronization</h3>
              <p className="mt-1 text-muted-foreground">
                FCOS stores the ordered users and writes their display names to Salesforce Account Manager. GROUP families are written all-or-none; failed or mismatched rows remain visible as sync issues for retry.
              </p>
            </section>
            <section>
              <h3 className="font-semibold">Account notes</h3>
              <p className="mt-1 text-muted-foreground">
                Each Account name has an FCOS note of up to 255 characters. A GROUP note edit can update the GROUP only or copy the note to every direct child Account name. GROUP + children replaces existing child notes at that time; each child note remains independently editable afterward. Notes never write to Salesforce.
              </p>
            </section>
            <section>
              <h3 className="font-semibold">Search and filters</h3>
              <p className="mt-1 text-muted-foreground">
                Search matches Account names, parent GROUP names, GROUP child names, Account type, manager name, manager email, and note text. The manager filter includes inherited assignments and Unassigned Accounts.
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(groupEditAccount)} onOpenChange={(open) => {
        if (!open) setGroupEditAccount(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit GROUP Account managers?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose whether this edit applies only to the GROUP Account or also to every direct child Account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {groupEditAccount && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-medium">{groupEditAccount.accountName}</div>
              <div className="mt-1">
                This directory currently shows {groupEditAccount.childAccountCount} active child Account{groupEditAccount.childAccountCount === 1 ? '' : 's'}. GROUP only stops inheritance without changing existing child Salesforce values. GROUP + children replaces child manager assignments and Salesforce values.
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="border border-input bg-background text-foreground hover:bg-accent" onClick={() => {
              const account = groupEditAccount;
              setGroupEditAccount(null);
              if (account) beginEdit(account, { propagateToChildren: false });
            }}>
              GROUP only
            </AlertDialogAction>
            <AlertDialogAction onClick={() => {
              const account = groupEditAccount;
              setGroupEditAccount(null);
              if (account) beginEdit(account, { propagateToChildren: true });
            }}>
              GROUP + children
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(groupNoteEditAccount)} onOpenChange={(open) => {
        if (!open) setGroupNoteEditAccount(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit GROUP Account note?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose whether this note applies only to the GROUP Account or is copied to every direct child Account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {groupNoteEditAccount && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-medium">{groupNoteEditAccount.accountName}</div>
              <div className="mt-1">
                GROUP only leaves child notes unchanged. GROUP + children replaces every direct child note with the saved GROUP note. Child notes can be edited independently afterward.
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="border border-input bg-background text-foreground hover:bg-accent" onClick={() => {
              const account = groupNoteEditAccount;
              setGroupNoteEditAccount(null);
              if (account) beginNoteEdit(account, { propagateToChildren: false });
            }}>
              GROUP only
            </AlertDialogAction>
            <AlertDialogAction onClick={() => {
              const account = groupNoteEditAccount;
              setGroupNoteEditAccount(null);
              if (account) beginNoteEdit(account, { propagateToChildren: true });
            }}>
              GROUP + children
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
