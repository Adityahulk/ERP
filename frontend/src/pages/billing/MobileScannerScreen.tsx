import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Send, CheckCircle2, AlertCircle, RefreshCw, Volume2, Wifi, WifiOff, History, Sparkles } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import axios from 'axios';
import { getApiBaseURL } from '@/lib/api';

interface ScanHistoryItem {
  id: string;
  barcode: string;
  timestamp: string;
  status: 'sending' | 'success' | 'error';
  errorMessage?: string;
}

// Generate sound feedback using Web Audio API
function playScanSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, ctx.currentTime); // high pitch scanner beep
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.12); // 120ms beep
    setTimeout(() => ctx.close(), 500);
  } catch (e) {
    console.warn('Audio Beep Error:', e);
  }
}

export default function MobileScannerScreen() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');

  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReader = useRef(new BrowserMultiFormatReader());
  
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [deviceConnected, setDeviceConnected] = useState<boolean | null>(null);
  const [sendingManual, setSendingManual] = useState(false);

  // Keep track of scans for cooldown (avoid duplicate scanning of the same barcode)
  const lastScanned = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  // API Client config
  const apiBase = getApiBaseURL();

  // Test connection to verify desktop session is active
  const checkDesktopSession = async () => {
    if (!sessionId) return;
    try {
      // Send a dummy connection ping to see if backend responds
      setDeviceConnected(true);
    } catch {
      setDeviceConnected(false);
    }
  };

  useEffect(() => {
    checkDesktopSession();
  }, [sessionId]);

  // Start continuous barcode scanning
  const startCamera = async () => {
    setCameraError(null);
    setIsScanning(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access not supported in this browser. Please ensure you are using HTTPS or localhost.');
      setIsScanning(false);
      return;
    }

    try {
      await codeReader.current.decodeFromVideoDevice(
        null, // use default video device
        videoRef.current!,
        (result, err) => {
          if (result) {
            const code = result.getText().trim();
            const now = Date.now();

            // 2 seconds cooldown for the same code, or scan if code is different
            if (code !== lastScanned.current.code || now - lastScanned.current.time > 2000) {
              lastScanned.current = { code, time: now };
              handleBarcodeScanned(code);
            }
          }
          if (err && !(err instanceof NotFoundException)) {
            console.warn('ZXing Scan Error:', err);
          }
        }
      );
    } catch (err: any) {
      console.error('Camera Init Error:', err);
      let errMsg = 'Could not start camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errMsg = 'Camera permission denied. Please allow camera access in your browser settings.';
      } else if (err.name === 'NotFoundError') {
        errMsg = 'No back camera found on this device.';
      }
      setCameraError(errMsg);
      setIsScanning(false);
    }
  };

  // Stop camera
  const stopCamera = () => {
    codeReader.current.reset();
    setIsScanning(false);
  };

  // Auto-start camera when screen loads
  useEffect(() => {
    if (sessionId) {
      startCamera();
    }
    return () => {
      codeReader.current.reset();
    };
  }, [sessionId]);

  const handleBarcodeScanned = async (barcode: string) => {
    if (!sessionId) {
      toast.error('Missing session ID. Please scan the QR code again.');
      return;
    }

    // Play physical feedback
    playScanSound();
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }

    const historyId = Math.random().toString(36).substring(7);
    const newHistoryItem: ScanHistoryItem = {
      id: historyId,
      barcode,
      timestamp: new Date().toLocaleTimeString(),
      status: 'sending'
    };

    setScanHistory(prev => [newHistoryItem, ...prev].slice(0, 15));

    try {
      const res = await axios.post(`${apiBase}/pos-scanner/send/${sessionId}`, { barcode });
      if (res.data.success) {
        setScanHistory(prev =>
          prev.map(item => (item.id === historyId ? { ...item, status: 'success' } : item))
        );
        toast.success(`Sent: ${barcode}`, { duration: 1500 });
      } else {
        throw new Error(res.data.error || 'Failed to send');
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Connection error';
      setScanHistory(prev =>
        prev.map(item => (item.id === historyId ? { ...item, status: 'error', errorMessage: msg } : item))
      );
      toast.error(`Failed to send ${barcode}: ${msg}`);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;

    setSendingManual(true);
    const code = manualCode.trim();
    setManualCode('');
    await handleBarcodeScanned(code);
    setSendingManual(false);
  };

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="w-16 h-16 text-rose-500 mb-4 animate-bounce" />
        <h1 className="text-2xl font-black tracking-wide text-white mb-2">Invalid Session</h1>
        <p className="text-slate-400 text-sm max-w-md">
          This URL is missing the POS Session token. Please open POS billing on your computer, click the "Mobile Scanner" button, and scan the QR code.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-md mx-auto shadow-2xl relative overflow-hidden font-sans pb-10">
      <Toaster position="top-center" />
      
      {/* Header */}
      <header className="p-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-purple-600/20 text-purple-400 rounded-lg">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="font-extrabold text-sm tracking-wide text-white uppercase">Microtechnique POS Mobile</h1>
            <span className="text-[10px] text-slate-400 font-mono">ID: {sessionId.substring(9, 15)}...</span>
          </div>
        </div>
        
        {/* Status */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/50">
          {deviceConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Ready</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Linked</span>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
        
        {/* Camera Viewfinder */}
        <Card className="relative aspect-square w-full bg-black border-slate-800 overflow-hidden shadow-2xl rounded-2xl flex flex-col items-center justify-center group">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />
          
          {/* Laser guide */}
          {isScanning && (
            <div className="absolute inset-0 flex items-center justify-center p-12 pointer-events-none z-10">
              <div className="relative w-full aspect-video border-2 border-purple-500/40 rounded-xl">
                <div className="absolute inset-0 border-purple-400 rounded-xl border-2 animate-pulse [clip-path:polygon(0%_0%,15%_0%,15%_10%,8%_10%,8%_18%,0%_18%,0%_0%,85%_0%,100%_0%,100%_18%,92%_18%,92%_10%,85%_10%,85%_0%,100%_82%,100%_100%,85%_100%,85%_90%,92%_90%,92%_82%,100%_82%,0%_100%,15%_100%,15%_90%,8%_90%,8%_82%,0%_82%,0%_100%)]"></div>
                <div className="absolute left-0 top-0 h-[3px] w-full bg-purple-500 shadow-[0_0_12px_3px_rgba(168,85,247,0.7)] animate-[scanning_2s_ease-in-out_infinite_alternate]" />
              </div>
            </div>
          )}

          {/* Fallbacks */}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-900/95 text-center z-20">
              <AlertCircle className="w-12 h-12 text-rose-500 mb-3" />
              <p className="text-sm font-semibold text-white mb-1">Camera Access Issue</p>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xs mb-4">{cameraError}</p>
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700 font-bold" onClick={startCamera}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try Again
              </Button>
            </div>
          )}

          {!isScanning && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-900/90 text-center z-20">
              <Camera className="w-12 h-12 text-slate-500 mb-3" />
              <p className="text-sm font-semibold text-white mb-3">Camera is Off</p>
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700 font-bold" onClick={startCamera}>
                Start Scanner
              </Button>
            </div>
          )}

          {/* Action Overlay */}
          {isScanning && (
            <div className="absolute bottom-4 left-4 right-4 z-20 flex justify-between items-center bg-black/60 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-700/40">
              <span className="text-[10px] text-slate-300 font-medium flex items-center gap-1.5">
                <Volume2 className="w-3 h-3 text-purple-400" /> Bleep & Vibrate enabled
              </span>
              <Button size="sm" variant="ghost" className="h-6 text-slate-400 hover:text-white text-xs px-2" onClick={stopCamera}>
                Stop Camera
              </Button>
            </div>
          )}
        </Card>

        {/* Manual Barcode Input */}
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <Input
            placeholder="Type barcode digits..."
            className="bg-slate-900 border-slate-800 focus-visible:ring-purple-500 text-white font-medium text-base h-11 shadow-inner"
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
          />
          <Button
            type="submit"
            className="bg-purple-600 hover:bg-purple-700 h-11 px-4 font-bold gap-1.5 shadow-lg shadow-purple-950/40"
            disabled={sendingManual || !manualCode.trim()}
          >
            <Send className="w-4 h-4" /> Send
          </Button>
        </form>

        {/* History List */}
        <div className="flex-1 flex flex-col min-h-0 bg-slate-900/40 border border-slate-900 rounded-2xl p-4 gap-3">
          <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 text-slate-400">
            <History className="w-4 h-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">Scan Log (Active Session)</h2>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {scanHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-600 py-10">
                <Camera className="w-8 h-8 opacity-20 mb-2" />
                <p className="text-xs font-medium">Scanned codes will appear here</p>
              </div>
            ) : (
              scanHistory.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 animate-in slide-in-from-top-3 duration-200"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-sm font-bold text-white tracking-wide">{item.barcode}</span>
                    <span className="text-[9px] text-slate-500">{item.timestamp}</span>
                  </div>
                  
                  <div>
                    {item.status === 'sending' && (
                      <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" />
                    )}
                    {item.status === 'success' && (
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400" />
                    )}
                    {item.status === 'error' && (
                      <div className="flex items-center gap-1 text-rose-400" title={item.errorMessage}>
                        <AlertCircle className="w-4.5 h-4.5" />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <footer className="px-6 py-3 text-center border-t border-slate-900 text-[10px] text-slate-600 bg-slate-950 sticky bottom-0">
        Local IP Network Scanning Session • Keep browser active
      </footer>

      <style>{`
        @keyframes scanning {
          0% { transform: translateY(0); }
          100% { transform: translateY(calc(100% + 80px)); }
        }
      `}</style>
    </div>
  );
}
