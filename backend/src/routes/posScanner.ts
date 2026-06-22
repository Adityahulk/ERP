import { Router, Request, Response } from 'express';
import os from 'os';

const router = Router();

// Store active desktop connections
const clients = new Map<string, Response>();

// GET /api/pos-scanner/ips - Get local network IP addresses
router.get('/ips', (req: Request, res: Response) => {
  try {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    
    for (const name of Object.keys(interfaces)) {
      const networkInterface = interfaces[name];
      if (!networkInterface) continue;
      
      for (const iface of networkInterface) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    
    res.json({ success: true, data: ips });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/pos-scanner/register/:sessionId - Setup SSE connection for desktop POS screen
router.get('/register/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Bypass Nginx proxy buffering
  });

  // Store client connection
  clients.set(sessionId, res);

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ status: 'connected' })}\n\n`);

  // Periodic keep-alive ping (every 25 seconds) to prevent timeouts
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(pingInterval);
    clients.delete(sessionId);
  });
});

// POST /api/pos-scanner/send/:sessionId - Mobile device sends a scanned barcode
router.post('/send/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { barcode } = req.body;

  if (!barcode || typeof barcode !== 'string') {
    return res.status(400).json({ success: false, error: 'Valid barcode string is required' });
  }

  const client = clients.get(sessionId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'POS desktop session not found or inactive' });
  }

  // Push barcode event to the SSE connection
  client.write(`data: ${JSON.stringify({ barcode: barcode.trim() })}\n\n`);
  
  res.json({ success: true, message: 'Scan forwarded to POS session' });
});

export default router;
