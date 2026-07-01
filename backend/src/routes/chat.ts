import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { processChatMessage } from '../services/chatService';

const router = Router();
router.use(verifyToken);

const chatSchema = z.object({
  message: z.string().min(1, 'Message is required'),
});

router.post('/', validateBody(chatSchema), async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(403).json({ error: 'Company ID not found in token' });
    }

    const reply = await processChatMessage(message, companyId);
    
    res.json({ reply });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

export default router;
