import { ShieldAlert } from 'lucide-react';

export default function AccessDenied({ moduleName = 'this page' }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Access Denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your user account does not have access to {moduleName}. Contact an administrator if this access is required.
        </p>
      </div>
    </div>
  );
}
