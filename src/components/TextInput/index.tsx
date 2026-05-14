import { Input, Label } from "@/components";
import { useId } from "react";

export const TextInput = ({
  label,
  placeholder,
  value,
  onChange,
  error,
  notes,
}: {
  label?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  notes?: string;
}) => {
  const id = useId();
  const errorId = `${id}-error`;
  const notesId = `${id}-notes`;

  return (
    <div className="space-y-1">
      {label ? (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      ) : null}
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={`${error ? errorId : ""} ${notes ? notesId : ""}`.trim() || undefined}
        className={`h-11 border-1 border-input/50 focus:border-primary/50 transition-colors ${
          error ? "border-destructive" : ""
        }`}
      />
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
      {notes && (
        <p id={notesId} className="text-xs text-muted-foreground">
          {notes}
        </p>
      )}
    </div>
  );
};
