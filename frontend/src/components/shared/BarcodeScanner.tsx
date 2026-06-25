import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

function cameraErrorMessage(e: unknown): string {
  const err = e as { name?: string; message?: string };
  const name = err?.name || '';
  const msg = String(err?.message || e || '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was denied. Click the lock/camera icon in the address bar and allow the camera for this site.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The camera is already in use or could not be started. Close other apps using the camera and try again.';
  }
  if (name === 'SecurityError' || msg.toLowerCase().includes('secure context')) {
    return 'Camera requires a secure page: use https:// or open the app on http://localhost (plain http:// on a LAN IP will not show a camera prompt).';
  }
  if (msg) return `Camera: ${msg}`;
  return 'Could not start the camera.';
}

export function BarcodeScanner({ isOpen, onClose, onScan }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [manualInput, setManualInput] = useState('');
  const codeReader = useRef(new BrowserMultiFormatReader());
  /** Keep latest handlers without re-running the camera effect every parent render */
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  }, [onScan, onClose]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const openCamera = (video: HTMLVideoElement) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error(
          window.isSecureContext
            ? 'This browser does not expose a camera (mediaDevices).'
            : 'Camera is not available on this URL. Use https:// or http://localhost — http on a LAN IP cannot use the camera.',
        );
        return;
      }

      if (!window.isSecureContext) {
        toast.error(
          'Camera needs a secure context. Use https://, or open the app as http://localhost / http://127.0.0.1 (not http://192.168.x.x).',
        );
        return;
      }

      void codeReader.current
        .decodeFromVideoDevice(null, video, (result, err) => {
          if (cancelled) return;
          if (result) {
            onScanRef.current(result.getText());
            void codeReader.current.reset();
            onCloseRef.current();
          }
          if (err && !(err instanceof NotFoundException)) {
            console.error(err);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          console.error(e);
          toast.error(cameraErrorMessage(e));
        });
    };

    const start = () => {
      const v = videoRef.current;
      if (v) openCamera(v);
      else requestAnimationFrame(() => !cancelled && videoRef.current && openCamera(videoRef.current!));
    };

    // Defer so <video> ref is committed after paint (Strict Mode / first open).
    const t = window.setTimeout(start, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      codeReader.current.reset();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div
        ref={containerRef}
        className="relative w-full max-w-md overflow-hidden rounded-xl bg-background shadow-2xl transition-all"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Camera className="h-5 w-5" /> Camera Scanner
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="relative aspect-square w-full bg-black overflow-hidden">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
            <div className="relative w-full aspect-video border-2 border-primary/60 rounded-lg">
              <div className="absolute inset-0 border-primary rounded-lg border-2 animate-pulse [clip-path:polygon(0%_0%,20%_0%,20%_10%,10%_10%,10%_20%,0%_20%,0%_0%,80%_0%,100%_0%,100%_20%,90%_20%,90%_10%,80%_10%,80%_0%,100%_80%,100%_100%,80%_100%,80%_90%,90%_90%,90%_80%,100%_80%,0%_100%,20%_100%,20%_90%,10%_90%,10%_80%,0%_80%,0%_100%)]"></div>
              <div className="absolute left-0 top-0 h-[2px] w-full bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.8)] animate-[scanning_2s_ease-in-out_infinite_alternate]" />
            </div>
          </div>
          <div className="absolute bottom-4 left-0 right-0 text-center text-xs font-medium text-white/80 bg-black/50 py-1 mx-8 rounded backdrop-blur">
            Point camera at barcode or QR code
          </div>
        </div>

        <div className="p-4 bg-muted/50">
          <div className="flex gap-2">
            <Input
              placeholder="Or enter barcode manually..."
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manualInput) {
                  onScan(manualInput);
                  onClose();
                }
              }}
            />
            <Button
              onClick={() => {
                if (manualInput) {
                  onScan(manualInput);
                  onClose();
                }
              }}
            >
              Go
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scanning {
          0% { transform: translateY(0); }
          100% { transform: translateY(calc(100% + 150px)); }
        }
      `}</style>
    </div>
  );
}
