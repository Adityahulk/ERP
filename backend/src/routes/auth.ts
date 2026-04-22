import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/authController';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const forgotSchema = z.object({
  email: z.string().email('Valid email is required'),
});

const resetSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

router.post('/login', validateBody(loginSchema), ctrl.login);
router.post('/refresh', validateBody(refreshSchema), ctrl.refresh);
router.post('/logout', verifyToken, ctrl.logout);
router.get('/me', verifyToken, ctrl.getMe);
router.post('/forgot-password', validateBody(forgotSchema), ctrl.forgotPassword);
router.post('/reset-password', validateBody(resetSchema), ctrl.resetPassword);

export default router;
