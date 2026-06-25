import { Router, Request, Response } from 'express';
import bwipjs from 'bwip-js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const text = req.query.text as string;
  if (!text) {
    return res.status(400).send('Text query parameter is required');
  }

  const includeText = req.query.includetext !== 'false';

  try {
    const options: any = {
      bcid: 'code128',
      text,
      scale: 3,
      height: 10,
      includetext: includeText,
      textxalign: 'center',
    };
    // Barcode is ALWAYS horizontal — never rotated. Vertical label mode
    // only changes the text layout CSS, not the barcode image itself.

    const png = await bwipjs.toBuffer(options);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(png);
  } catch (err: any) {
    console.error('Barcode generation error:', err);
    res.status(500).send('Barcode generation failed');
  }
});

export default router;
