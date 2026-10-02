import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type RegisteredPartyDetails = {
  gstin: string;
  legal_name: string | null;
  trade_name: string | null;
  status: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  source: 'provider' | 'local';
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onDetails: (details: RegisteredPartyDetails) => void;
  initialGstin?: string;
  disabled?: boolean;
  id?: string;
};

export function PartyGstinLookup({ value, onChange, onDetails, initialGstin = '', disabled = false, id }: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const requestId = useRef(0);
  const onDetailsRef = useRef(onDetails);
  onDetailsRef.current = onDetails;
  const gstin = value.replace(/\s+/g, '').toUpperCase();

  const lookup = async (candidate: string) => {
    const current = ++requestId.current;
    setLoading(true);
    setMessage('');
    try {
      const response = await api.get(`/company/gstin/${encodeURIComponent(candidate)}`);
      if (current !== requestId.current) return;
      const details = response.data?.data as RegisteredPartyDetails;
      if (details.source !== 'provider') {
        setMessage('GSTIN format is valid, but registered details are unavailable. Enter party details manually.');
        setIsError(false);
      } else if (!details.legal_name && !details.trade_name) {
        setMessage('The registry returned no business name. Enter party details manually.');
        setIsError(true);
      } else if (details.status && !/^active$/i.test(details.status.trim())) {
        setMessage(`GST registration status: ${details.status}. Details were not applied; verify before saving.`);
        setIsError(true);
      } else {
        onDetailsRef.current(details);
        setMessage('Registered details filled. Review and edit them before saving.');
        setIsError(false);
      }
    } catch (error: any) {
      if (current !== requestId.current) return;
      setMessage(error.response?.data?.error || 'GSTIN lookup is unavailable. You can enter details manually.');
      setIsError(true);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    setMessage('');
    ++requestId.current;
    setLoading(false);
    if (disabled || gstin.length !== 15 || gstin === initialGstin.replace(/\s+/g, '').toUpperCase()) return;
    const timer = window.setTimeout(() => { void lookup(gstin); }, 500);
    return () => window.clearTimeout(timer);
  }, [gstin, initialGstin, disabled]);

  return (
    <div>
      <div className="mt-1 flex gap-2">
        <Input id={id} className="font-mono uppercase" maxLength={15} value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())} placeholder="15-character GSTIN" disabled={disabled} />
        <Button type="button" size="icon" variant="outline" title="Fetch registered GSTIN details"
          aria-label="Fetch registered GSTIN details" disabled={disabled || gstin.length !== 15 || loading}
          onClick={() => { void lookup(gstin); }}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>
      {message && <p role="status" className={`mt-1 text-xs ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>}
    </div>
  );
}
