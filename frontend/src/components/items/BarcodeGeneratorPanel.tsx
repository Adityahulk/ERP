/**
 * BarcodeGeneratorPanel
 * Previously hosted a "Bulk Print" tab + "Label Editor" tab.
 * Now redirects directly to the Label Editor for a simpler user flow.
 * Bulk Print UI has been hidden (visual-only removal — backend unchanged).
 */
import { LabelEditorPanel } from './LabelEditorPanel';

export function BarcodeGeneratorPanel() {
  return <LabelEditorPanel />;
}
