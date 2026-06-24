export default function StateBlock({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
      {Icon && <Icon className="h-9 w-9 opacity-25" />}
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
