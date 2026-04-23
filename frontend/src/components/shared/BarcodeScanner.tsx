import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { X, Camera } from 'lucide-react';
import toast from 'react-hot-toast';

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcodeValue: string) => void;
}

export function BarcodeScanner({ isOpen, onClose, onScan }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [manualInput, setManualInput] = useState('');
  const codeReader = useRef(new BrowserMultiFormatReader());

  useEffect(() => {
    if (isOpen && videoRef.current) {
      codeReader.current
        .decodeFromVideoDevice(null, videoRef.current, (result, err) => {
          if (result) {
            onScan(result.getText());
            codeReader.current.reset();
            onClose();
          }
          if (err && !(err instanceof NotFoundException)) {
            console.error(err);
          }
        })
        .catch((e) => {
          console.error(e);
          toast.error('Failed to access camera');
        });
    }

    return () => {
      codeReader.current.reset();
    };
  }, [isOpen, onScan, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div 
        ref={containerRef}
        className="relative w-full max-w-md overflow-hidden rounded-xl bg-background shadow-2xl transition-all"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Camera className="h-5 w-5" /> Camera Scanner
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Scanner Body */}
        <div className="relative aspect-square w-full bg-black overflow-hidden">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
          />
          {/* Target Overlay UI */}
          <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
            <div className="relative w-full aspect-video border-2 border-primary/60 rounded-lg">
              <div className="absolute inset-0 border-primary rounded-lg border-2 animate-pulse [clip-path:polygon(0%_0%,20%_0%,20%_10%,10%_10%,10%_20%,0%_20%,0%_0%,80%_0%,100%_0%,100%_20%,90%_20%,90%_10%,80%_10%,80%_0%,100%_80%,100%_100%,80%_100%,80%_90%,90%_90%,90%_80%,100%_80%,0%_100%,20%_100%,20%_90%,10%_90%,10%_80%,0%_80%,0%_100%)]"></div>
              {/* Sweeping Laser Line representing scan */}
              <div className="absolute left-0 top-0 h-[2px] w-full bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.8)] animate-[scanning_2s_ease-in-out_infinite_alternate]" />
            </div>
          </div>
          <div className="absolute bottom-4 left-0 right-0 text-center text-xs font-medium text-white/80 bg-black/50 py-1 mx-8 rounded backdrop-blur">
            Point camera at barcode or QR code
          </div>
        </div>

        {/* Manual Fallback */}
        <div className="p-4 bg-muted/50">
          <div className="flex gap-2">
            <Input 
              placeholder="Or enter barcode manually..." 
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => {
                if(e.key === 'Enter' && manualInput) {
                  onScan(manualInput);
                  onClose();
                }
              }}
            />
            <Button onClick={() => {
              if(manualInput) {
                onScan(manualInput);
                onClose();
              }
            }}>Go</Button>
          </div>
        </div>
      </div>
      
      <style>{`
        @keyframes scanning {
          0% { transform: translateY(0); }
          100% { transform: translateY(calc(100% + 150px)); /* Assuming aspect video ratio ~150px height inside */ }
        }
      `}</style>
    </div>
  );
}
