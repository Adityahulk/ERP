export type ImportGodown = {
  id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
};

function key(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveStockImportGodown(
  godowns: ImportGodown[],
  selectedId: string,
  rowName: string,
  rowCode: string,
): { godown?: ImportGodown; error?: string } {
  const selected = selectedId ? godowns.find((godown) => godown.id === selectedId) : undefined;
  if (selectedId && !selected) return { error: 'Selected godown was not found in this company' };
  if (selected && !selected.is_active) return { error: `Selected godown "${selected.name}" is inactive` };

  const findUnique = (field: 'name' | 'code', value: string) => {
    const matches = godowns.filter((godown) => key(godown[field]) === key(value));
    return matches;
  };
  const nameMatches = rowName ? findUnique('name', rowName) : [];
  const codeMatches = rowCode ? findUnique('code', rowCode) : [];
  if (rowName && nameMatches.length === 0) return { error: `Godown Name "${rowName}" was not found; create or correct it before importing` };
  if (rowCode && codeMatches.length === 0) return { error: `Godown Code "${rowCode}" was not found; create or correct it before importing` };
  if (nameMatches.length > 1 || codeMatches.length > 1) return { error: 'Godown name or code matches multiple records; resolve duplicates before importing' };
  const byName = nameMatches[0];
  const byCode = codeMatches[0];
  if (byName && byCode && byName.id !== byCode.id) {
    return { error: `Godown Name "${rowName}" and Code "${rowCode}" refer to different godowns` };
  }
  const fromRow = byCode || byName;
  if (selected && fromRow && selected.id !== fromRow.id) {
    return { error: `File godown "${fromRow.name}" does not match selected godown "${selected.name}"` };
  }
  const godown = selected || fromRow;
  if (!godown) return { error: 'Select a godown or provide Godown Name/Code in this row' };
  if (!godown.is_active) return { error: `Godown "${godown.name}" is inactive; enable it before importing` };
  return { godown };
}
