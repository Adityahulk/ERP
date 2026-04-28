import { useRef, useState } from 'react';
import { ScanLine, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import toast from 'react-hot-toast';

export interface OcrExtractedData {
  invoice_number: string | null;
  bill_date: string | null;         // YYYY-MM-DD
  party_name: string | null;
  supplier_gstin: string | null;
  buyer_gstin: string | null;
  total_amount_paise: number | null;
  raw_lines: string[];
}

interface Props {
  /** Called once OCR succeeds — fill your form fields from the result */
  onExtracted: (data: OcrExtractedData) => void;
  label?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function OcrUploadButton({
  onExtracted,
  label = 'Scan Bill',
  className,
  variant = 'outline',
  size = 'sm',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be selected again
    e.target.value = '';

    setLoading(true);
    const toastId = toast.loading('Reading bill…');
    try {
      const form = new FormData();
      form.append('file', file);
      const { data: res } = await api.post('/ocr/extract', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.dismiss(toastId);
      if (res.data) {
        onExtracted(res.data as OcrExtractedData);
        toast.success('Bill scanned — please verify the details');
      } else {
        toast.error('Could not read bill. Try a clearer image.');
      }
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err?.response?.data?.error ?? 'OCR failed. Try a clearer scan.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={handleFile}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={loading}
        onClick={() => inputRef.current?.click()}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
        ) : (
          <ScanLine className="w-4 h-4 mr-1.5" />
        )}
        {loading ? 'Scanning…' : label}
      </Button>
    </>
  );
}
