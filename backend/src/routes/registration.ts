import { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { verifyRegistrantToken } from '../middleware/registrantAuth';
import {
  register,
  registrantLogin,
  getRegistrantMe,
  registrantForgotPassword,
  registrantResetPassword,
  launchOwnedCompany,
  verifySignup,
  resendSignupOtp,
  getVerificationStatus,
} from '../controllers/registrationController';
import { z } from 'zod';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2).max(200),
  email: z.string().email(),
  phone: z.string().max(20).optional(),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(100),
});

const verifySchema = z.object({
  verification_token: z.string().min(1),
  code: z.string().min(4).max(10),
});

const resendSchema = z.object({
  verification_token: z.string().min(1).optional(),
  email: z.string().email().optional(),
}).refine((d) => Boolean(d.verification_token || d.email), {
  message: 'Provide a verification_token or email',
});

// Public routes
router.post('/', validateBody(registerSchema), register);
router.post('/login', validateBody(loginSchema), registrantLogin);
router.post('/verify', validateBody(verifySchema), verifySignup);
router.post('/resend-verification', validateBody(resendSchema), resendSignupOtp);
router.get('/verification-status', getVerificationStatus);
router.post('/forgot-password', validateBody(forgotSchema), registrantForgotPassword);
router.post('/reset-password', validateBody(resetSchema), registrantResetPassword);

// Authenticated registrant routes
router.get('/me', verifyRegistrantToken, getRegistrantMe);
router.post('/licenses/:id/launch', verifyRegistrantToken, launchOwnedCompany);

export default router;
