import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';

export default function DocumentActionsBar({
  onCancel,
  onPreview,
  onSave,
  canPreview,
  canSave,
  saving,
  saveLabel,
  extra,
}: {
  onCancel: () => void;
  onPreview?: () => void;
  onSave: () => void;
  canPreview?: boolean;
  canSave: boolean;
  saving?: boolean;
  saveLabel: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {extra}
      <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      {onPreview && (
        <Button type="button" variant="outline" className="gap-2" disabled={!canPreview} onClick={onPreview}>
          <Eye className="h-4 w-4" /> Preview
        </Button>
      )}
      <Button type="button" loading={saving} disabled={!canSave} onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  );
}
